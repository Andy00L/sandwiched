use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ephemeral_rollups_sdk::anchor::{delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::compat::Instruction;
use ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE;
use session_keys::{Session, SessionTokenV2};

use crate::constants::{CUSTODY_SEED, SEAT_SEED, TABLE_SEED, VRF_CALLBACK_IDENTITY};
use crate::error::SandwichError;
use crate::state::{Seat, Table};

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Table::INIT_SPACE,
        seeds = [TABLE_SEED, &table_id.to_le_bytes()],
        bump
    )]
    pub table: Box<Account<'info, Table>>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateTable<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: read by `read_table_data`, which checks its owner, discriminator and address.
    #[account(mut, del)]
    pub table: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Sit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub wallet: Signer<'info>,
    /// CHECK: read by `read_table_data`, which checks its owner, discriminator and address.
    pub table: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Seat::INIT_SPACE,
        seeds = [SEAT_SEED, table.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub seat: Account<'info, Seat>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only its address is a seed of the seat.
    pub wallet: UncheckedAccount<'info>,
    /// CHECK: read by `read_table_data`, which checks its owner, discriminator and address.
    pub table: UncheckedAccount<'info>,
    /// CHECK: the seat to delegate, checked by its seeds.
    #[account(mut, del, seeds = [SEAT_SEED, table.key().as_ref(), wallet.key().as_ref()], bump)]
    pub seat: UncheckedAccount<'info>,
}

#[derive(Accounts, Session)]
pub struct SeatAction<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), seat.wallet.as_ref()],
        bump = seat.bump
    )]
    pub seat: Account<'info, Seat>,
    #[session(signer = signer, authority = seat.wallet)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[derive(Accounts, Session)]
pub struct WhaleAction<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(seeds = [SEAT_SEED, table.key().as_ref(), seat.wallet.as_ref()], bump = seat.bump)]
    pub seat: Account<'info, Seat>,
    #[session(signer = signer, authority = seat.wallet)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[derive(Accounts)]
pub struct BuyIn<'info> {
    pub wallet: Signer<'info>,
    #[account(seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), wallet.key().as_ref()],
        bump = seat.bump
    )]
    pub seat: Account<'info, Seat>,
    #[account(
        mut,
        constraint = wallet_token.owner == wallet.key() @ SandwichError::WrongTokenAccount,
        constraint = wallet_token.mint == table.mint @ SandwichError::WrongTokenAccount
    )]
    pub wallet_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = table.escrow @ SandwichError::WrongTokenAccount)]
    pub escrow_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts, Session)]
pub struct CashOut<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), seat.wallet.as_ref()],
        bump = seat.bump
    )]
    pub seat: Account<'info, Seat>,
    /// CHECK: data-less address that owns the escrow token account and signs payouts.
    #[account(seeds = [CUSTODY_SEED, table.key().as_ref()], bump = table.custody_bump)]
    pub custody: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = wallet_token.owner == seat.wallet @ SandwichError::WrongTokenAccount,
        constraint = wallet_token.mint == table.mint @ SandwichError::WrongTokenAccount
    )]
    pub wallet_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = table.escrow @ SandwichError::WrongTokenAccount)]
    pub escrow_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    #[session(signer = signer, authority = seat.wallet)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[vrf]
#[derive(Accounts)]
pub struct StartRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    /// CHECK: the delegated VRF queue; the VRF program validates it.
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE @ SandwichError::UnknownQueue)]
    pub oracle_queue: UncheckedAccount<'info>,
}

impl StartRound<'_> {
    pub fn request_randomness(&self, request: &Instruction) -> Result<()> {
        self.invoke_signed_vrf(&self.payer.to_account_info(), request)?;
        Ok(())
    }
}

#[vrf_callback]
#[derive(Accounts)]
pub struct OnWhaleDrawn<'info> {
    #[account(address = VRF_CALLBACK_IDENTITY @ SandwichError::NotVrf)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
}

#[derive(Accounts)]
pub struct TableRoster<'info> {
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
}
