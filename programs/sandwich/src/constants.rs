use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::vrf::consts::{program_identity_pubkey, scoped_vrf_identity_const};
use sandwich_rules::constants::MAX_SEATS;

pub const TABLE_SEED: &[u8] = b"table";
pub const SEAT_SEED: &[u8] = b"seat";
pub const CUSTODY_SEED: &[u8] = b"custody";

pub const TICK_MS: u64 = 10;
pub const SEAT_COUNT: u8 = MAX_SEATS as u8;

pub const VRF_REQUEST_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);

/// The 0.18.0 `#[vrf_callback]` macro derives this address inside the account constraint at run
/// time, which runs out of compute on the rollup. A const item is evaluated at compile time.
pub const VRF_CALLBACK_IDENTITY: Pubkey =
    Pubkey::new_from_array(scoped_vrf_identity_const(&crate::ID).0);
