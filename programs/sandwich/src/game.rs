use anchor_lang::prelude::*;
use sandwich_rules::{Round, Timing};

use crate::constants::{SEAT_COUNT, SEAT_SEED, TABLE_SEED, TICK_MS};
use crate::error::SandwichError;
use crate::state::{Phase, Seat, Table};

pub fn rule_timing() -> Result<Timing> {
    Ok(Timing::from_tick_ms(TICK_MS).map_err(SandwichError::from)?)
}

pub fn current_tick() -> Result<u64> {
    Ok(Clock::get()?.slot)
}

pub fn seat_bit(seat_index: u8) -> u32 {
    1u32.checked_shl(u32::from(seat_index)).unwrap_or(0)
}

pub fn is_anted(anted: u32, seat_index: u8) -> bool {
    anted & seat_bit(seat_index) != 0
}

pub fn count_anted(anted: u32) -> u8 {
    anted.count_ones() as u8
}

pub fn count_seated(table: &Table) -> u8 {
    table.seats.iter().filter(|wallet| **wallet != Pubkey::default()).count() as u8
}

pub fn seated_index(table: &Table, seat: &Seat) -> Result<u8> {
    let seat_index = seat.seat_index.ok_or(SandwichError::NotSeated)?;
    let listed_wallet = table
        .seats
        .get(usize::from(seat_index))
        .ok_or(SandwichError::NotSeated)?;
    require_keys_eq!(*listed_wallet, seat.wallet, SandwichError::NotSeated);
    Ok(seat_index)
}

pub fn is_seat_anted(table: &Table, seat: &Seat) -> bool {
    seated_index(table, seat).is_ok_and(|seat_index| is_anted(table.anted, seat_index))
}

pub fn anted_index(table: &Table, seat: &Seat) -> Result<u8> {
    let seat_index = seated_index(table, seat)?;
    require!(is_anted(table.anted, seat_index), SandwichError::NotInRound);
    Ok(seat_index)
}

pub fn live_round(table: &Table) -> Result<(u8, Round)> {
    match table.phase {
        Phase::Live { whale_seat } => Ok((whale_seat, table.round.into())),
        Phase::Lobby { .. } | Phase::Drawing { .. } => err!(SandwichError::WrongPhase),
    }
}

pub fn nth_anted_seat(anted: u32, rank: u8) -> Result<u8> {
    Ok((0..SEAT_COUNT)
        .filter(|seat_index| is_anted(anted, *seat_index))
        .nth(usize::from(rank))
        .ok_or(SandwichError::TooFewPlayers)?)
}

pub fn verify_table_address(table_key: &Pubkey, table: &Table) -> Result<()> {
    let expected = Pubkey::create_program_address(
        &[TABLE_SEED, &table.table_id.to_le_bytes(), &[table.bump]],
        &crate::ID,
    )
    .map_err(|_| SandwichError::NotTable)?;
    require_keys_eq!(expected, *table_key, SandwichError::NotTable);
    Ok(())
}

pub fn read_table_data(table_info: &AccountInfo) -> Result<Table> {
    let is_known_owner =
        *table_info.owner == crate::ID || *table_info.owner == ephemeral_rollups_sdk::id();
    require!(is_known_owner, SandwichError::NotTable);
    let table = {
        let data = table_info.try_borrow_data()?;
        Table::try_deserialize(&mut &data[..])?
    };
    verify_table_address(table_info.key, &table)?;
    Ok(table)
}

pub fn load_anted_seats<'info>(
    table_key: &Pubkey,
    table: &Table,
    seat_infos: &'info [AccountInfo<'info>],
) -> Result<Vec<Account<'info, Seat>>> {
    let mut seen: u32 = 0;
    let mut seats = Vec::with_capacity(seat_infos.len());
    for seat_info in seat_infos {
        require!(seat_info.is_writable, SandwichError::NotTableSeat);
        let seat: Account<Seat> = Account::try_from(seat_info)?;
        let expected = Pubkey::create_program_address(
            &[SEAT_SEED, table_key.as_ref(), seat.wallet.as_ref(), &[seat.bump]],
            &crate::ID,
        )
        .map_err(|_| SandwichError::NotTableSeat)?;
        require_keys_eq!(expected, *seat_info.key, SandwichError::NotTableSeat);
        let seat_index = anted_index(table, &seat)?;
        let bit = seat_bit(seat_index);
        require!(seen & bit == 0, SandwichError::DuplicateSeat);
        seen |= bit;
        seats.push(seat);
    }
    require_eq!(seen, table.anted, SandwichError::MissingSeat);
    Ok(seats)
}
