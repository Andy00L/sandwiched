use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, CreateAccount};
use anchor_spl::token::{self, InitializeMint2, Mint, MintTo, Token, TokenAccount};

use crate::error::SandwichError;

pub const TEST_MINT_SEED: &[u8] = b"test_usdc";
pub const FAUCET_AUTHORITY_SEED: &[u8] = b"faucet";
pub const FAUCET_CLAIM_SEED: &[u8] = b"faucet_claim";
pub const TEST_MINT_DECIMALS: u8 = 6;
pub const FAUCET_UNITS: u64 = 5_000_000;
pub const FAUCET_COOLDOWN_SECONDS: i64 = 3_600;

#[account]
#[derive(InitSpace)]
pub struct FaucetClaim {
    pub last_claim_unix: i64,
}

#[derive(Accounts)]
pub struct CreateTestMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: created and initialised as a mint by `create_test_mint`.
    #[account(mut, seeds = [TEST_MINT_SEED], bump)]
    pub test_mint: UncheckedAccount<'info>,
    /// CHECK: data-less address that holds the mint authority.
    #[account(seeds = [FAUCET_AUTHORITY_SEED], bump)]
    pub faucet_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimFaucet<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub wallet: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + FaucetClaim::INIT_SPACE,
        seeds = [FAUCET_CLAIM_SEED, wallet.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, FaucetClaim>,
    #[account(mut, seeds = [TEST_MINT_SEED], bump)]
    pub test_mint: Account<'info, Mint>,
    /// CHECK: data-less address that holds the mint authority.
    #[account(seeds = [FAUCET_AUTHORITY_SEED], bump)]
    pub faucet_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = wallet_token.owner == wallet.key() @ SandwichError::WrongTokenAccount,
        constraint = wallet_token.mint == test_mint.key() @ SandwichError::WrongTokenAccount
    )]
    pub wallet_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_test_mint(ctx: Context<CreateTestMint>) -> Result<()> {
    let mint_seeds: &[&[u8]] = &[TEST_MINT_SEED, &[ctx.bumps.test_mint]];
    system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.test_mint.to_account_info(),
            },
            &[mint_seeds],
        ),
        Rent::get()?.minimum_balance(Mint::LEN),
        Mint::LEN as u64,
        &token::ID,
    )?;
    token::initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            InitializeMint2 { mint: ctx.accounts.test_mint.to_account_info() },
        ),
        TEST_MINT_DECIMALS,
        &ctx.accounts.faucet_authority.key(),
        None,
    )
}

pub fn claim_faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
    let now_unix = Clock::get()?.unix_timestamp;
    let claim = &mut ctx.accounts.claim;
    let is_first_claim = claim.last_claim_unix == 0;
    let next_claim_unix = claim
        .last_claim_unix
        .checked_add(FAUCET_COOLDOWN_SECONDS)
        .ok_or(SandwichError::MathOverflow)?;
    require!(is_first_claim || now_unix >= next_claim_unix, SandwichError::FaucetCooldown);
    claim.last_claim_unix = now_unix;
    let authority_seeds: &[&[u8]] = &[FAUCET_AUTHORITY_SEED, &[ctx.bumps.faucet_authority]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.test_mint.to_account_info(),
                to: ctx.accounts.wallet_token.to_account_info(),
                authority: ctx.accounts.faucet_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        FAUCET_UNITS,
    )
}
