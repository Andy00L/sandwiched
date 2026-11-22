use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use ephemeral_rollups_sdk::anchor::ephemeral;
use ephemeral_rollups_sdk::consts::ASSOCIATED_TOKEN_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_randomness_ix_const, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use sandwich_rules::constants::{CHIPS_PER_ANTE, MAX_BOXES};
use sandwich_rules::{
    can_start_round, pick_default_box, pick_whale, MoveOutcome, PeckOutcome, Pigeon, Round,
    RuleError, Timing,
};
use session_keys::{session_auth_or, SessionError};

pub mod constants;
pub mod contexts;
pub mod error;
pub mod game;
pub mod state;
#[cfg(feature = "faucet")]
pub mod test_usdc;

pub use constants::*;
pub use contexts::*;
pub use error::SandwichError;
pub use state::*;
#[cfg(feature = "faucet")]
pub use test_usdc::*;

use game::{
    anted_index, count_anted, count_seated, current_tick, is_anted, is_seat_anted, live_round,
    load_anted_seats, nth_anted_seat, read_table_data, seat_bit, seated_index, RosterCoverage,
};

declare_id!("CvPa7U3XSH6QHGkG2PoPokuUAQd2xJqYSTupmKYank2n");

#[ephemeral]
#[program]
pub mod sandwich {
    use super::*;

    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        ante_units: u64,
        box_count: u8,
        validator: Pubkey,
    ) -> Result<()> {
        require!(
            box_count > 0 && usize::from(box_count) <= MAX_BOXES,
            SandwichError::BadBoxCount
        );
        require!(
            ante_units > 0 && ante_units.is_multiple_of(CHIPS_PER_ANTE),
            SandwichError::BadAnte
        );
        let table_key = ctx.accounts.table.key();
        let mint_key = ctx.accounts.mint.key();
        let (custody, custody_bump) =
            Pubkey::find_program_address(&[CUSTODY_SEED, table_key.as_ref()], &crate::ID);
        let (escrow, _) = Pubkey::find_program_address(
            &[custody.as_ref(), token::ID.as_ref(), mint_key.as_ref()],
            &ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        ctx.accounts.table.set_inner(Table {
            bump: ctx.bumps.table,
            custody_bump,
            table_id,
            validator,
            mint: mint_key,
            escrow,
            ante_units,
            chip_units: ante_units / CHIPS_PER_ANTE,
            box_count,
            round_number: 0,
            seats: [Pubkey::default(); sandwich_rules::constants::MAX_SEATS],
            anted: 0,
            phase: Phase::Lobby { first_ante_tick: 0 },
            round: StoredRound::EMPTY,
            last_result: None,
        });
        msg!("[create_table] table {} validator {}", table_id, validator);
        Ok(())
    }

    pub fn delegate_table(ctx: Context<DelegateTable>) -> Result<()> {
        let table = read_table_data(&ctx.accounts.table)?;
        ctx.accounts.delegate_table(
            &ctx.accounts.payer,
            &[TABLE_SEED, &table.table_id.to_le_bytes()],
            DelegateConfig { validator: Some(table.validator), ..Default::default() },
        )?;
        Ok(())
    }

    pub fn sit(ctx: Context<Sit>) -> Result<()> {
        read_table_data(&ctx.accounts.table)?;
        ctx.accounts.seat.set_inner(Seat {
            bump: ctx.bumps.seat,
            wallet: ctx.accounts.wallet.key(),
            seat_index: None,
            chips: 0,
            pigeon: Pigeon::at_round_start().into(),
        });
        Ok(())
    }

    pub fn delegate_seat(ctx: Context<DelegateSeat>) -> Result<()> {
        let table = read_table_data(&ctx.accounts.table)?;
        let table_key = ctx.accounts.table.key();
        let wallet_key = ctx.accounts.wallet.key();
        ctx.accounts.delegate_seat(
            &ctx.accounts.payer,
            &[SEAT_SEED, table_key.as_ref(), wallet_key.as_ref()],
            DelegateConfig { validator: Some(table.validator), ..Default::default() },
        )?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn join(ctx: Context<SeatAction>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let seat = &mut ctx.accounts.seat;
        require!(seat.seat_index.is_none(), SandwichError::AlreadySeated);
        let free_index = table
            .seats
            .iter()
            .position(|wallet| *wallet == Pubkey::default())
            .ok_or(SandwichError::TableFull)?;
        let free_slot = table.seats.get_mut(free_index).ok_or(SandwichError::TableFull)?;
        *free_slot = seat.wallet;
        seat.seat_index = Some(u8::try_from(free_index).map_err(|_| SandwichError::TableFull)?);
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn leave(ctx: Context<SeatAction>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let seat = &mut ctx.accounts.seat;
        let seat_index = seated_index(table, seat)?;
        require!(!is_anted(table.anted, seat_index), SandwichError::StillInRound);
        require_eq!(seat.chips, 0, SandwichError::ChipsRemaining);
        let listed = table
            .seats
            .get_mut(usize::from(seat_index))
            .ok_or(SandwichError::NotSeated)?;
        *listed = Pubkey::default();
        seat.seat_index = None;
        Ok(())
    }

    pub fn buy_in(ctx: Context<BuyIn>, chips: u64) -> Result<()> {
        require!(chips > 0, SandwichError::ZeroChips);
        let units = chips
            .checked_mul(ctx.accounts.table.chip_units)
            .ok_or(SandwichError::MathOverflow)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.wallet_token.to_account_info(),
                    to: ctx.accounts.escrow_token.to_account_info(),
                    authority: ctx.accounts.wallet.to_account_info(),
                },
            ),
            units,
        )?;
        let seat = &mut ctx.accounts.seat;
        seat.chips = seat.chips.checked_add(chips).ok_or(SandwichError::MathOverflow)?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn cash_out(ctx: Context<CashOut>, chips: u64) -> Result<()> {
        require!(chips > 0, SandwichError::ZeroChips);
        require!(
            !is_seat_anted(&ctx.accounts.table, &ctx.accounts.seat),
            SandwichError::StillInRound
        );
        let units = chips
            .checked_mul(ctx.accounts.table.chip_units)
            .ok_or(SandwichError::MathOverflow)?;
        let seat = &mut ctx.accounts.seat;
        seat.chips = seat.chips.checked_sub(chips).ok_or(SandwichError::NotEnoughChips)?;
        let table_key = ctx.accounts.table.key();
        let custody_seeds: &[&[u8]] =
            &[CUSTODY_SEED, table_key.as_ref(), &[ctx.accounts.table.custody_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_token.to_account_info(),
                    to: ctx.accounts.wallet_token.to_account_info(),
                    authority: ctx.accounts.custody.to_account_info(),
                },
                &[custody_seeds],
            ),
            units,
        )
    }

    /// Anyone may clear a seat that sat out the round in progress: its chips go back to the
    /// owner's token account and its place opens, so a table never fills with absent guests.
    pub fn evict_seat(ctx: Context<EvictSeat>) -> Result<()> {
        require!(matches!(ctx.accounts.table.phase, Phase::Live { .. }), SandwichError::WrongPhase);
        let seat_index = seated_index(&ctx.accounts.table, &ctx.accounts.seat)?;
        require!(!is_anted(ctx.accounts.table.anted, seat_index), SandwichError::StillInRound);
        let chips = ctx.accounts.seat.chips;
        if chips > 0 {
            let wallet_token = ctx.accounts.wallet_token.as_ref().ok_or(SandwichError::WrongTokenAccount)?;
            let units = chips
                .checked_mul(ctx.accounts.table.chip_units)
                .ok_or(SandwichError::MathOverflow)?;
            let table_key = ctx.accounts.table.key();
            let custody_seeds: &[&[u8]] =
                &[CUSTODY_SEED, table_key.as_ref(), &[ctx.accounts.table.custody_bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_token.to_account_info(),
                        to: wallet_token.to_account_info(),
                        authority: ctx.accounts.custody.to_account_info(),
                    },
                    &[custody_seeds],
                ),
                units,
            )?;
        }
        let listed = ctx
            .accounts
            .table
            .seats
            .get_mut(usize::from(seat_index))
            .ok_or(SandwichError::NotSeated)?;
        *listed = Pubkey::default();
        let seat = &mut ctx.accounts.seat;
        seat.chips = 0;
        seat.seat_index = None;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn ante(ctx: Context<SeatAction>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let seat = &mut ctx.accounts.seat;
        require!(matches!(table.phase, Phase::Lobby { .. }), SandwichError::WrongPhase);
        let seat_index = seated_index(table, seat)?;
        require!(!is_anted(table.anted, seat_index), SandwichError::AlreadyAnted);
        seat.chips = seat
            .chips
            .checked_sub(CHIPS_PER_ANTE)
            .ok_or(SandwichError::NotEnoughChips)?;
        seat.pigeon = Pigeon::at_round_start().into();
        if table.anted == 0 {
            table.phase = Phase::Lobby { first_ante_tick: current_tick()? };
        }
        table.anted |= seat_bit(seat_index);
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn withdraw_ante(ctx: Context<SeatAction>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let seat = &mut ctx.accounts.seat;
        require!(matches!(table.phase, Phase::Lobby { .. }), SandwichError::WrongPhase);
        let seat_index = anted_index(table, seat)?;
        seat.chips = seat
            .chips
            .checked_add(CHIPS_PER_ANTE)
            .ok_or(SandwichError::MathOverflow)?;
        table.anted &= !seat_bit(seat_index);
        if table.anted == 0 {
            table.phase = Phase::Lobby { first_ante_tick: 0 };
        }
        Ok(())
    }

    pub fn start_round(ctx: Context<StartRound>) -> Result<()> {
        let now_tick = current_tick()?;
        let table_key = ctx.accounts.table.key();
        let table = &mut ctx.accounts.table;
        let Phase::Lobby { first_ante_tick } = table.phase else {
            return err!(SandwichError::WrongPhase);
        };
        can_start_round(
            count_anted(table.anted),
            count_seated(table),
            first_ante_tick,
            now_tick,
            &RULE_TIMING,
        )
        .map_err(SandwichError::from)?;
        let mut caller_seed = [0u8; 32];
        caller_seed[..8].copy_from_slice(&now_tick.to_le_bytes());
        caller_seed[8..16].copy_from_slice(&table.round_number.to_le_bytes());
        caller_seed[16..].copy_from_slice(&table_key.as_ref()[..16]);
        let request = create_request_randomness_ix_const(
            RequestRandomnessParams {
                payer: ctx.accounts.payer.key(),
                oracle_queue: ctx.accounts.oracle_queue.key(),
                callback_program_id: crate::ID,
                callback_discriminator: instruction::OnWhaleDrawn::DISCRIMINATOR.to_vec(),
                caller_seed,
                accounts_metas: Some(vec![SerializableAccountMeta {
                    pubkey: table_key,
                    is_signer: false,
                    is_writable: true,
                }]),
                callback_args: Some(table.round_number.to_le_bytes().to_vec()),
            },
            VRF_REQUEST_IDENTITY,
        );
        table.phase = Phase::Drawing { requested_tick: now_tick };
        ctx.accounts.request_randomness(&request)
    }

    pub fn on_whale_drawn(
        ctx: Context<OnWhaleDrawn>,
        randomness: [u8; 32],
        round_number: u64,
    ) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(matches!(table.phase, Phase::Drawing { .. }), SandwichError::WrongPhase);
        require_eq!(round_number, table.round_number, SandwichError::StaleDraw);
        let anted_players = count_anted(table.anted);
        let whale_rank = pick_whale(&randomness, anted_players).map_err(SandwichError::from)?;
        let whale_seat = nth_anted_seat(table.anted, whale_rank)?;
        let sandwich_box =
            pick_default_box(&randomness, table.box_count).map_err(SandwichError::from)?;
        let round = Round::start(
            table.box_count,
            sandwich_box,
            anted_players,
            current_tick()?,
            &RULE_TIMING,
        )
        .map_err(SandwichError::from)?;
        table.phase = Phase::Live { whale_seat };
        table.round = round.into();
        msg!("[on_whale_drawn] round {} whale seat {}", table.round_number, whale_seat);
        Ok(())
    }

    pub fn cancel_draw<'info>(ctx: Context<'info, TableRoster<'info>>) -> Result<()> {
        let table_key = ctx.accounts.table.key();
        let table = &mut ctx.accounts.table;
        let Phase::Drawing { requested_tick } = table.phase else {
            return err!(SandwichError::WrongPhase);
        };
        let timeout_tick = requested_tick
            .checked_add(RULE_TIMING.draw_timeout_ticks)
            .ok_or(SandwichError::MathOverflow)?;
        require!(current_tick()? >= timeout_tick, SandwichError::DrawNotTimedOut);
        let seats = load_anted_seats(
            &table_key,
            table,
            ctx.remaining_accounts,
            RosterCoverage::EveryAntedSeat,
        )?;
        refund_antes(seats)?;
        close_round(table)?;
        msg!("[cancel_draw] antes refunded");
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn fly_to(ctx: Context<SeatAction>, box_index: u8) -> Result<()> {
        move_pigeon(ctx.accounts, "fly_to", |round, pigeon, now_tick, timing| {
            round.fly_to(pigeon, box_index, now_tick, timing)
        })
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn take_off(ctx: Context<SeatAction>) -> Result<()> {
        move_pigeon(ctx.accounts, "take_off", |round, pigeon, now_tick, timing| {
            round.take_off(pigeon, now_tick, timing)
        })
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn peck(ctx: Context<SeatAction>) -> Result<()> {
        move_pigeon(ctx.accounts, "peck", |round, pigeon, now_tick, timing| {
            round.peck(pigeon, now_tick, timing).map(|outcome| match outcome {
                PeckOutcome::FlattenedBySwat { dropped_crumbs } => {
                    MoveOutcome::FlattenedBySwat { dropped_crumbs }
                }
                PeckOutcome::TookLooseCrumb
                | PeckOutcome::TookSandwichCrumb
                | PeckOutcome::StunnedOnEmptyBox => MoveOutcome::Moved,
            })
        })
    }

    #[session_auth_or(
        ctx.accounts.seat.wallet == ctx.accounts.signer.key(),
        SandwichError::NotSeatOwner
    )]
    pub fn raise_hand(ctx: Context<WhaleAction>, box_index: u8) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let (whale_seat, mut round) = live_round(table)?;
        let seat_index = anted_index(table, &ctx.accounts.seat)?;
        require_eq!(seat_index, whale_seat, SandwichError::NotTheWhale);
        round
            .raise_hand(box_index, current_tick()?, &RULE_TIMING)
            .map_err(SandwichError::from)?;
        table.round = round.into();
        Ok(())
    }

    pub fn land_swat<'info>(ctx: Context<'info, TableRoster<'info>>) -> Result<()> {
        let now_tick = current_tick()?;
        let table_key = ctx.accounts.table.key();
        let table = &mut ctx.accounts.table;
        let (whale_seat, mut round) = live_round(table)?;
        let mut seats = load_anted_seats(
            &table_key,
            table,
            ctx.remaining_accounts,
            RosterCoverage::AnyAntedSeats,
        )?;
        seats.retain(|seat| seat.seat_index != Some(whale_seat));
        let mut pigeons: Vec<Pigeon> = seats.iter().map(|seat| seat.pigeon.into()).collect();
        round
            .land_swat(&mut pigeons, now_tick, &RULE_TIMING)
            .map_err(SandwichError::from)?;
        for (seat, pigeon) in seats.iter_mut().zip(pigeons) {
            let landed = StoredPigeon::from(pigeon);
            if seat.pigeon != landed {
                seat.pigeon = landed;
                seat.exit(&crate::ID)?;
            }
        }
        table.round = round.into();
        Ok(())
    }

    pub fn settle<'info>(ctx: Context<'info, TableRoster<'info>>) -> Result<()> {
        let now_tick = current_tick()?;
        let table_key = ctx.accounts.table.key();
        let table = &mut ctx.accounts.table;
        let (whale_seat, mut round) = live_round(table)?;
        require!(now_tick >= round.end_tick, SandwichError::RoundNotOver);
        let mut seats = load_anted_seats(
            &table_key,
            table,
            ctx.remaining_accounts,
            RosterCoverage::EveryAntedSeat,
        )?;
        let whale_position = seats
            .iter()
            .position(|seat| seat.seat_index == Some(whale_seat))
            .ok_or(SandwichError::MissingSeat)?;
        let whale_wallet = seats
            .get(whale_position)
            .map(|seat| seat.wallet)
            .ok_or(SandwichError::MissingSeat)?;
        let mut pigeons: Vec<Pigeon> = seats
            .iter()
            .enumerate()
            .filter(|(position, _)| *position != whale_position)
            .map(|(_, seat)| seat.pigeon.into())
            .collect();
        let settlement = round
            .settle(&mut pigeons, now_tick, &RULE_TIMING)
            .map_err(SandwichError::from)?;
        let mut settled_pigeons = pigeons.into_iter();
        for (position, seat) in seats.iter_mut().enumerate() {
            let won_crumbs = if position == whale_position {
                settlement.whale_crumbs
            } else {
                let pigeon = settled_pigeons.next().ok_or(SandwichError::MissingSeat)?;
                seat.pigeon = Pigeon { beak_crumbs: 0, ..pigeon }.into();
                pigeon.beak_crumbs
            };
            seat.chips = seat.chips.checked_add(won_crumbs).ok_or(SandwichError::MathOverflow)?;
            seat.exit(&crate::ID)?;
        }
        table.last_result = Some(RoundResult {
            round_number: table.round_number,
            whale_wallet,
            sandwich_box: round.sandwich_box,
            whale_crumbs: settlement.whale_crumbs,
            pigeon_crumbs: settlement.pigeon_crumbs,
        });
        close_round(table)
    }

    pub fn abort_round<'info>(ctx: Context<'info, TableRoster<'info>>) -> Result<()> {
        let table_key = ctx.accounts.table.key();
        let table = &mut ctx.accounts.table;
        let (_, round) = live_round(table)?;
        let abort_tick = round
            .end_tick
            .checked_add(SETTLE_WINDOW_TICKS)
            .ok_or(SandwichError::MathOverflow)?;
        require!(current_tick()? >= abort_tick, SandwichError::AbortTooEarly);
        let seats = load_anted_seats(
            &table_key,
            table,
            ctx.remaining_accounts,
            RosterCoverage::EveryAntedSeat,
        )?;
        let refunded_crumbs = u64::from(count_anted(table.anted))
            .checked_mul(CHIPS_PER_ANTE)
            .ok_or(SandwichError::MathOverflow)?;
        require_eq!(refunded_crumbs, round.anted_crumbs, SandwichError::ChipsNotConserved);
        refund_antes(seats)?;
        close_round(table)
    }

    #[cfg(feature = "faucet")]
    pub fn create_test_mint(ctx: Context<CreateTestMint>) -> Result<()> {
        test_usdc::initialize_test_mint(ctx)
    }

    #[cfg(feature = "faucet")]
    pub fn faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
        test_usdc::claim_faucet(ctx)
    }
}

fn refund_antes(seats: Vec<Account<Seat>>) -> Result<()> {
    for mut seat in seats {
        seat.chips = seat
            .chips
            .checked_add(CHIPS_PER_ANTE)
            .ok_or(SandwichError::MathOverflow)?;
        seat.pigeon = Pigeon::at_round_start().into();
        seat.exit(&crate::ID)?;
    }
    Ok(())
}

fn close_round(table: &mut Table) -> Result<()> {
    table.anted = 0;
    table.round_number = table.round_number.checked_add(1).ok_or(SandwichError::MathOverflow)?;
    table.phase = Phase::Lobby { first_ante_tick: 0 };
    Ok(())
}

fn move_pigeon(
    accounts: &mut SeatAction,
    instruction_name: &str,
    act: impl FnOnce(&mut Round, &mut Pigeon, u64, &Timing) -> core::result::Result<MoveOutcome, RuleError>,
) -> Result<()> {
    let table = &mut accounts.table;
    let seat = &mut accounts.seat;
    let (whale_seat, mut round) = live_round(table)?;
    let seat_index = anted_index(table, seat)?;
    require_neq!(seat_index, whale_seat, SandwichError::WhaleCannotPeck);
    let mut pigeon: Pigeon = seat.pigeon.into();
    let outcome = act(&mut round, &mut pigeon, current_tick()?, &RULE_TIMING)
        .map_err(SandwichError::from)?;
    if let MoveOutcome::FlattenedBySwat { dropped_crumbs } = outcome {
        msg!("[{}] flattened by a swat, dropped {}", instruction_name, dropped_crumbs);
    }
    table.round = round.into();
    seat.pigeon = pigeon.into();
    Ok(())
}
