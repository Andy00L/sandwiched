use {
    anchor_lang::{
        prelude::Pubkey, system_program, AccountDeserialize, Id, InstructionData, Space,
        ToAccountMetas,
    },
    ephemeral_rollups_sdk::{
        anchor::DelegationProgram,
        consts::{ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID},
        pda::{
            delegate_buffer_pda_from_delegated_account_and_owner_program,
            delegation_metadata_pda_from_delegated_account,
            delegation_record_pda_from_delegated_account,
        },
        spl::{
            builders::{
                DelegateEphemeralAtaBuilder, DepositSplTokensBuilder,
                InitializeEphemeralAtaBuilder, InitializeGlobalVaultBuilder,
            },
            find_rent_pda, find_vault_ata, GlobalVault,
        },
        vrf::consts::{DEFAULT_EPHEMERAL_QUEUE, VRF_PROGRAM_ID},
    },
    magicsvm::{MagicSVM, TransactionTarget},
    sandwich::{
        accounts, instruction, Phase, SandwichError, Seat, StoredPigeonState, Table,
        CUSTODY_SEED, FAUCET_AUTHORITY_SEED, FAUCET_CLAIM_SEED, FAUCET_UNITS, SEAT_SEED,
        TABLE_SEED, TEST_MINT_SEED,
    },
    sandwich_rules::constants::CHIPS_PER_ANTE,
    session_keys::SessionTokenV2,
    solana_address::Address,
    solana_clock::Clock,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_signer::Signer,
    solana_system_interface::instruction as system_instruction,
    solana_transaction::Transaction,
    std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    },
};

const ANTE_UNITS: u64 = 100_000;
const CHIP_UNITS: u64 = ANTE_UNITS / CHIPS_PER_ANTE;
const BOX_COUNT: u8 = 3;
const DEPOSIT_UNITS: u64 = 1_000_000;
const BUY_IN_CHIPS: u64 = 300;
const FLIGHT_TICKS: u64 = 50;
const PECK_COOLDOWN_TICKS: u64 = 30;
const SWAT_WINDUP_TICKS: u64 = 35;
const DRAW_TIMEOUT_TICKS: u64 = 500;
const SESSION_VALIDITY_SECONDS: i64 = 3_600;
const SESSION_INVALID_TOKEN: u32 = 6001;
const PERCHES_PER_BOX_COUNT: usize = sandwich_rules::constants::PERCHES_PER_BOX as usize;
const LEGACY_TRANSACTION_LIMIT_BYTES: usize = 1232;

const BASE: TransactionTarget = TransactionTarget::Base;
const ROLLUP: TransactionTarget = TransactionTarget::Ephemeral;

fn program_so_path() -> PathBuf {
    std::env::var("SANDWICH_SO_PATH").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/sandwich.so")
    })
}

fn session_so_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/session-keys.so")
}

fn address_of(key: &Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}

fn key_of(address: &Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

fn key_of_signer(keypair: &Keypair) -> Pubkey {
    key_of(&keypair.pubkey())
}

fn error_code(error: SandwichError) -> u32 {
    error.into()
}

fn to_instruction(program_id: Pubkey, data: Vec<u8>, metas: Vec<anchor_lang::prelude::AccountMeta>) -> Instruction {
    Instruction {
        program_id: address_of(&program_id),
        accounts: metas
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: address_of(&meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data,
    }
}

fn program_ix(data: impl InstructionData, metas: impl ToAccountMetas) -> Instruction {
    to_instruction(sandwich::ID, data.data(), metas.to_account_metas(None))
}

fn from_compat(compat: ephemeral_rollups_sdk::compat::Instruction) -> Instruction {
    Instruction {
        program_id: Address::new_from_array(compat.program_id.to_bytes()),
        accounts: compat
            .accounts
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: Address::new_from_array(meta.pubkey.to_bytes()),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data: compat.data,
    }
}

fn compat_key(key: &Pubkey) -> ephemeral_rollups_sdk::compat::Pubkey {
    ephemeral_rollups_sdk::compat::Pubkey::new_from_array(key.to_bytes())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

fn table_pda(table_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[TABLE_SEED, &table_id.to_le_bytes()], &sandwich::ID).0
}

fn seat_pda(table: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SEAT_SEED, table.as_ref(), wallet.as_ref()], &sandwich::ID).0
}

fn custody_pda(table: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[CUSTODY_SEED, table.as_ref()], &sandwich::ID).0
}

fn test_mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[TEST_MINT_SEED], &sandwich::ID).0
}

fn ata_of(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let token_program = key_of(&Address::new_from_array(TOKEN_PROGRAM_ID.to_bytes()));
    let associated_program = key_of(&Address::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes()));
    Pubkey::find_program_address(&[owner.as_ref(), token_program.as_ref(), mint.as_ref()], &associated_program).0
}

fn token_program_key() -> Pubkey {
    Pubkey::new_from_array(TOKEN_PROGRAM_ID.to_bytes())
}

fn session_token_pda(session_signer: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            SessionTokenV2::SEED_PREFIX.as_bytes(),
            sandwich::ID.as_ref(),
            session_signer.as_ref(),
            wallet.as_ref(),
        ],
        &session_keys::ID,
    )
    .0
}

struct Player {
    wallet: Keypair,
    session_signer: Option<Keypair>,
}

impl Player {
    fn key(&self) -> Pubkey {
        key_of_signer(&self.wallet)
    }

    fn signer(&self) -> &Keypair {
        self.session_signer.as_ref().unwrap_or(&self.wallet)
    }

    fn session_token(&self) -> Option<Pubkey> {
        self.session_signer
            .as_ref()
            .map(|session_signer| session_token_pda(&key_of_signer(session_signer), &self.key()))
    }
}

struct Lab {
    svm: MagicSVM,
    admin: Keypair,
    mint: Pubkey,
    validator: Pubkey,
}

impl Lab {
    fn boot() -> Lab {
        let admin = Keypair::new();
        let mut svm = MagicSVM::new();
        let mut clock: Clock = svm.get_sysvar();
        clock.unix_timestamp = now_unix();
        svm.set_sysvar(&clock);
        svm.add_program_from_file(address_of(&sandwich::ID), program_so_path())
            .expect("[Lab::boot] load sandwich.so: run `anchor build` first");
        svm.add_program_from_file(address_of(&session_keys::ID), session_so_path())
            .expect("[Lab::boot] load session-keys.so");
        svm.airdrop(&admin.pubkey(), 50 * LAMPORTS_PER_SOL).expect("[Lab::boot] airdrop");
        let validator = key_of(&svm.validator_identity());
        let mut lab = Lab { svm, admin, mint: test_mint_pda(), validator };
        lab.create_mint_and_vault();
        lab
    }

    fn admin_key(&self) -> Pubkey {
        key_of_signer(&self.admin)
    }

    fn send(&mut self, target: TransactionTarget, signers: &[&Keypair], instructions: &[Instruction], label: &str) -> u64 {
        let fee_payer = signers[0].pubkey();
        let transaction = Transaction::new(signers, Message::new(instructions, Some(&fee_payer)), self.svm.latest_blockhash_for(target));
        let outcome = self.svm.send_transaction_to(target, transaction);
        self.svm.expire_blockhash_for(target);
        match outcome {
            Ok(meta) => meta.compute_units_consumed,
            Err(failed) => panic!("[Lab::send] {label} failed on {target:?}: {:?}\nlogs: {:#?}", failed.err, failed.meta.logs),
        }
    }

    fn send_refused(&mut self, target: TransactionTarget, signers: &[&Keypair], instructions: &[Instruction], expected_code: u32, label: &str) {
        let fee_payer = signers[0].pubkey();
        let transaction = Transaction::new(signers, Message::new(instructions, Some(&fee_payer)), self.svm.latest_blockhash_for(target));
        let outcome = self.svm.send_transaction_to(target, transaction);
        self.svm.expire_blockhash_for(target);
        let failed = match outcome {
            Ok(_) => panic!("[Lab::send_refused] {label} succeeded, expected Custom({expected_code})"),
            Err(failed) => failed,
        };
        let rendered = format!("{:?}", failed.err);
        assert!(
            rendered.contains(&format!("Custom({expected_code})")),
            "[Lab::send_refused] {label}: expected Custom({expected_code}), got {rendered}\nlogs: {:#?}",
            failed.meta.logs
        );
    }

    fn slot(&self) -> u64 {
        self.svm.get_sysvar::<Clock>().slot
    }

    fn advance_ticks(&mut self, ticks: u64) {
        let target_slot = self.slot() + ticks;
        self.svm.warp_to_slot(target_slot);
    }

    fn table(&self, table: &Pubkey) -> Table {
        let account = self.svm.get_account_for(ROLLUP, &address_of(table)).expect("[Lab::table] table account");
        Table::try_deserialize(&mut account.data.as_slice()).expect("[Lab::table] decode")
    }

    fn seat(&self, table: &Pubkey, wallet: &Pubkey) -> Seat {
        let account = self.svm.get_account_for(ROLLUP, &address_of(&seat_pda(table, wallet))).expect("[Lab::seat] seat account");
        Seat::try_deserialize(&mut account.data.as_slice()).expect("[Lab::seat] decode")
    }

    fn token_units(&self, target: TransactionTarget, token_account: &Pubkey) -> u64 {
        let account = self.svm.get_account_for(target, &address_of(token_account)).expect("[Lab::token_units] token account");
        let amount_bytes: [u8; 8] = account.data[64..72].try_into().expect("[Lab::token_units] amount bytes");
        u64::from_le_bytes(amount_bytes)
    }

    fn create_mint_and_vault(&mut self) {
        let admin_key = self.admin_key();
        let create_mint = program_ix(
            instruction::CreateTestMint {},
            accounts::CreateTestMint {
                payer: admin_key,
                test_mint: self.mint,
                faucet_authority: Pubkey::find_program_address(&[FAUCET_AUTHORITY_SEED], &sandwich::ID).0,
                token_program: token_program_key(),
                system_program: system_program::ID,
            },
        );
        let admin = self.admin.insecure_clone();
        self.send(BASE, &[&admin], &[create_mint], "create_test_mint");
        let (rent_pda, _) = find_rent_pda();
        let (vault, _) = GlobalVault::find_pda(&compat_key(&self.mint));
        let vault_ata = find_vault_ata(&compat_key(&self.mint), &vault);
        let instructions = [
            system_instruction::transfer(&admin.pubkey(), &Address::new_from_array(rent_pda.to_bytes()), LAMPORTS_PER_SOL),
            from_compat(InitializeGlobalVaultBuilder { payer: compat_key(&admin_key), mint: compat_key(&self.mint) }.instruction()),
            create_ata_ix(&admin_key, &key_of(&Address::new_from_array(vault_ata.to_bytes())), &key_of(&Address::new_from_array(vault.to_bytes())), &self.mint),
            from_compat(DelegateEphemeralAtaBuilder { payer: compat_key(&admin_key), user: vault, mint: compat_key(&self.mint), validator: Some(compat_key(&self.validator)) }.instruction()),
        ];
        self.send(BASE, &[&admin], &instructions, "init global vault");
    }

    fn faucet_ix(&self, wallet: &Pubkey) -> Instruction {
        program_ix(
            instruction::Faucet {},
            accounts::ClaimFaucet {
                payer: self.admin_key(),
                wallet: *wallet,
                claim: Pubkey::find_program_address(&[FAUCET_CLAIM_SEED, wallet.as_ref()], &sandwich::ID).0,
                test_mint: self.mint,
                faucet_authority: Pubkey::find_program_address(&[FAUCET_AUTHORITY_SEED], &sandwich::ID).0,
                wallet_token: ata_of(wallet, &self.mint),
                token_program: token_program_key(),
                system_program: system_program::ID,
            },
        )
    }

    fn fund_player(&mut self, player: &Player) {
        let admin = self.admin.insecure_clone();
        let admin_key = self.admin_key();
        let wallet_key = player.key();
        let wallet_token = ata_of(&wallet_key, &self.mint);
        let faucet = self.faucet_ix(&wallet_key);
        self.send(BASE, &[&admin, &player.wallet], &[create_ata_ix(&admin_key, &wallet_token, &wallet_key, &self.mint), faucet], "faucet");
        assert_eq!(self.token_units(BASE, &wallet_token), FAUCET_UNITS);
        let compat_wallet = compat_key(&wallet_key);
        let instructions = [
            from_compat(InitializeEphemeralAtaBuilder { payer: compat_key(&admin_key), user: compat_wallet, mint: compat_key(&self.mint) }.instruction()),
            from_compat(DepositSplTokensBuilder { authority: compat_wallet, user: compat_wallet, mint: compat_key(&self.mint), amount: DEPOSIT_UNITS }.instruction()),
            from_compat(DelegateEphemeralAtaBuilder { payer: compat_key(&admin_key), user: compat_wallet, mint: compat_key(&self.mint), validator: Some(compat_key(&self.validator)) }.instruction()),
        ];
        self.send(BASE, &[&admin, &player.wallet], &instructions, "deposit to the rollup");
        assert_eq!(self.token_units(ROLLUP, &wallet_token), DEPOSIT_UNITS);
    }

    fn create_table(&mut self, table_id: u64) -> Pubkey {
        let admin = self.admin.insecure_clone();
        let admin_key = self.admin_key();
        let table = table_pda(table_id);
        let create = program_ix(
            instruction::CreateTable { table_id, ante_units: ANTE_UNITS, box_count: BOX_COUNT, validator: self.validator },
            accounts::CreateTable { payer: admin_key, table, mint: self.mint, system_program: system_program::ID },
        );
        let delegate = program_ix(
            instruction::DelegateTable {},
            accounts::DelegateTable {
                payer: admin_key,
                table,
                buffer_table: delegate_buffer_pda_from_delegated_account_and_owner_program(&table, &sandwich::ID),
                delegation_record_table: delegation_record_pda_from_delegated_account(&table),
                delegation_metadata_table: delegation_metadata_pda_from_delegated_account(&table),
                owner_program: sandwich::ID,
                delegation_program: DelegationProgram::id(),
                system_program: system_program::ID,
            },
        );
        self.send(BASE, &[&admin], &[create, delegate], "create and delegate table");
        let custody = compat_key(&custody_pda(&table));
        let escrow = [
            from_compat(InitializeEphemeralAtaBuilder { payer: compat_key(&admin_key), user: custody, mint: compat_key(&self.mint) }.instruction()),
            from_compat(DelegateEphemeralAtaBuilder { payer: compat_key(&admin_key), user: custody, mint: compat_key(&self.mint), validator: Some(compat_key(&self.validator)) }.instruction()),
        ];
        self.send(BASE, &[&admin], &escrow, "open escrow on the rollup");
        assert_eq!(self.table(&table).escrow, ata_of(&custody_pda(&table), &self.mint));
        table
    }

    fn sit(&mut self, table: &Pubkey, player: &Player) {
        let admin = self.admin.insecure_clone();
        let admin_key = self.admin_key();
        let wallet = player.key();
        let seat = seat_pda(table, &wallet);
        let sit = program_ix(
            instruction::Sit {},
            accounts::Sit { payer: admin_key, wallet, table: *table, seat, system_program: system_program::ID },
        );
        let delegate = program_ix(
            instruction::DelegateSeat {},
            accounts::DelegateSeat {
                payer: admin_key,
                wallet,
                table: *table,
                seat,
                buffer_seat: delegate_buffer_pda_from_delegated_account_and_owner_program(&seat, &sandwich::ID),
                delegation_record_seat: delegation_record_pda_from_delegated_account(&seat),
                delegation_metadata_seat: delegation_metadata_pda_from_delegated_account(&seat),
                owner_program: sandwich::ID,
                delegation_program: DelegationProgram::id(),
                system_program: system_program::ID,
            },
        );
        self.send(BASE, &[&admin, &player.wallet], &[sit, delegate], "sit and delegate seat");
    }

    fn open_session(&mut self, player: &mut Player) {
        let admin = self.admin.insecure_clone();
        let session_signer = Keypair::new();
        let session_signer_key = key_of_signer(&session_signer);
        let create = to_instruction(
            session_keys::ID,
            session_keys::instruction::CreateSessionV2 { top_up: Some(false), valid_until: Some(now_unix() + SESSION_VALIDITY_SECONDS), lamports: None }.data(),
            session_keys::accounts::CreateSessionTokenV2 {
                session_token: session_token_pda(&session_signer_key, &player.key()),
                session_signer: session_signer_key,
                fee_payer: self.admin_key(),
                authority: player.key(),
                target_program: sandwich::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(BASE, &[&admin, &player.wallet, &session_signer], &[create], "create session");
        player.session_signer = Some(session_signer);
    }
}

fn create_ata_ix(payer: &Pubkey, ata: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction {
        program_id: Address::new_from_array(ASSOCIATED_TOKEN_PROGRAM_ID.to_bytes()),
        accounts: vec![
            AccountMeta::new(address_of(payer), true),
            AccountMeta::new(address_of(ata), false),
            AccountMeta::new_readonly(address_of(owner), false),
            AccountMeta::new_readonly(address_of(mint), false),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
            AccountMeta::new_readonly(Address::new_from_array(TOKEN_PROGRAM_ID.to_bytes()), false),
        ],
        data: vec![1],
    }
}

fn seat_action_as(
    data: impl InstructionData,
    table: &Pubkey,
    seat_owner: &Pubkey,
    signer: &Pubkey,
    session_token: Option<Pubkey>,
) -> Instruction {
    program_ix(
        data,
        accounts::SeatAction { signer: *signer, table: *table, seat: seat_pda(table, seat_owner), session_token },
    )
}

fn seat_action_ix(data: impl InstructionData, table: &Pubkey, player: &Player) -> Instruction {
    seat_action_as(data, table, &player.key(), &key_of_signer(player.signer()), player.session_token())
}

fn whale_action_ix(box_index: u8, table: &Pubkey, player: &Player) -> Instruction {
    program_ix(
        instruction::RaiseHand { box_index },
        accounts::WhaleAction {
            signer: key_of_signer(player.signer()),
            table: *table,
            seat: seat_pda(table, &player.key()),
            session_token: player.session_token(),
        },
    )
}

fn buy_in_ix(lab: &Lab, table: &Pubkey, player: &Player, chips: u64) -> Instruction {
    program_ix(
        instruction::BuyIn { chips },
        accounts::BuyIn {
            wallet: player.key(),
            table: *table,
            seat: seat_pda(table, &player.key()),
            wallet_token: ata_of(&player.key(), &lab.mint),
            escrow_token: ata_of(&custody_pda(table), &lab.mint),
            token_program: token_program_key(),
        },
    )
}

fn cash_out_ix(lab: &Lab, table: &Pubkey, player: &Player, chips: u64) -> Instruction {
    program_ix(
        instruction::CashOut { chips },
        accounts::CashOut {
            signer: key_of_signer(player.signer()),
            table: *table,
            seat: seat_pda(table, &player.key()),
            custody: custody_pda(table),
            wallet_token: ata_of(&player.key(), &lab.mint),
            escrow_token: ata_of(&custody_pda(table), &lab.mint),
            token_program: token_program_key(),
            session_token: player.session_token(),
        },
    )
}

fn start_round_ix(lab: &Lab, table: &Pubkey) -> Instruction {
    program_ix(
        instruction::StartRound {},
        accounts::StartRound {
            payer: lab.admin_key(),
            table: *table,
            oracle_queue: Pubkey::new_from_array(DEFAULT_EPHEMERAL_QUEUE.to_bytes()),
            program_identity: Pubkey::find_program_address(&[b"identity"], &sandwich::ID).0,
            vrf_program: Pubkey::new_from_array(VRF_PROGRAM_ID.to_bytes()),
            slot_hashes: key_of(&solana_sdk_ids::sysvar::slot_hashes::id()),
            system_program: system_program::ID,
        },
    )
}

fn roster_ix(data: impl InstructionData, table: &Pubkey, seats: &[Pubkey]) -> Instruction {
    let mut roster = program_ix(data, accounts::TableRoster { table: *table });
    roster.accounts.extend(seats.iter().map(|seat| AccountMeta::new(address_of(seat), false)));
    roster
}

fn seated_players(lab: &mut Lab, table: &Pubkey, count: usize) -> Vec<Player> {
    let players: Vec<Player> = (0..count).map(|_| Player { wallet: Keypair::new(), session_signer: None }).collect();
    for player in &players {
        lab.fund_player(player);
        lab.sit(table, player);
    }
    players
}

fn join_buy_in_and_ante(lab: &mut Lab, table: &Pubkey, players: &[Player]) {
    for player in players {
        lab.send(ROLLUP, &[player.signer()], &[seat_action_ix(instruction::Join {}, table, player)], "join");
        lab.send(ROLLUP, &[&player.wallet], &[buy_in_ix(lab, table, player, BUY_IN_CHIPS)], "buy_in");
    }
    for player in players {
        lab.send(ROLLUP, &[player.signer()], &[seat_action_ix(instruction::Ante {}, table, player)], "ante");
    }
}

fn whale_randomness(whale_rank: u8, sandwich_box: u8) -> [u8; 32] {
    let mut randomness = [0u8; 32];
    randomness[0] = whale_rank;
    randomness[8] = sandwich_box;
    randomness
}

#[test]
fn full_round_moves_every_chip_and_settles_once() {
    let mut lab = Lab::boot();
    let table = lab.create_table(1);
    let mut players = seated_players(&mut lab, &table, 4);
    let first_wallet = players[0].wallet.insecure_clone();
    let refaucet = lab.faucet_ix(&players[0].key());
    let admin = lab.admin.insecure_clone();
    lab.send_refused(BASE, &[&admin, &first_wallet], &[refaucet], error_code(SandwichError::FaucetCooldown), "second faucet within the hour");

    lab.open_session(&mut players[0]);
    assert_eq!(lab.svm.get_balance(&players[0].signer().pubkey()).unwrap_or(0), 0);
    join_buy_in_and_ante(&mut lab, &table, &players);
    let escrow = ata_of(&custody_pda(&table), &lab.mint);
    let chips_in_play = 4 * BUY_IN_CHIPS;
    assert_eq!(lab.token_units(ROLLUP, &escrow), chips_in_play * CHIP_UNITS);
    for player in &players {
        assert_eq!(lab.seat(&table, &player.key()).chips, BUY_IN_CHIPS - CHIPS_PER_ANTE);
    }

    let [pigeon_session, pigeon_dodger, pigeon_idle, whale] = [&players[0], &players[1], &players[2], &players[3]];
    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_session)], error_code(SandwichError::WrongPhase), "peck in the lobby");

    let sandwich_box = 1u8;
    lab.svm.set_vrf_randomness(Some(whale_randomness(3, sandwich_box)));
    let start_cu = lab.send(ROLLUP, &[&admin], &[start_round_ix(&lab, &table)], "start_round");
    assert!(matches!(lab.table(&table).phase, Phase::Drawing { .. }));
    let callbacks = lab.svm.warp_to_slot(lab.slot() + 1);
    let callback_cu = match callbacks.as_slice() {
        [Ok(meta)] => meta.compute_units_consumed,
        other => panic!("[full_round] expected one successful VRF callback, got {other:?}"),
    };
    let live = lab.table(&table);
    assert!(matches!(live.phase, Phase::Live { whale_seat: 3 }));
    assert_eq!(live.round.sandwich_box, sandwich_box);
    assert_eq!(live.round.pot_crumbs, 4 * CHIPS_PER_ANTE);

    let forger = Keypair::new();
    let forged_draw = program_ix(
        instruction::OnWhaleDrawn { randomness: [7u8; 32], round_number: 0 },
        accounts::OnWhaleDrawn { vrf_program_identity: key_of_signer(&forger), table },
    );
    lab.send_refused(ROLLUP, &[&forger], &[forged_draw], error_code(SandwichError::NotVrf), "a wallet delivers the draw");
    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[whale_action_ix(0, &table, pigeon_session)], error_code(SandwichError::NotTheWhale), "a pigeon raises the hand");
    lab.send_refused(ROLLUP, &[whale.signer()], &[seat_action_ix(instruction::Peck {}, &table, whale)], error_code(SandwichError::WhaleCannotPeck), "the whale pecks");
    lab.send_refused(ROLLUP, &[pigeon_idle.signer()], &[seat_action_ix(instruction::Ante {}, &table, pigeon_idle)], error_code(SandwichError::WrongPhase), "ante during the round");
    let session_on_other_seat = seat_action_as(
        instruction::Peck {},
        &table,
        &pigeon_dodger.key(),
        &key_of_signer(pigeon_session.signer()),
        pigeon_session.session_token(),
    );
    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[session_on_other_seat], SESSION_INVALID_TOKEN, "a session key acts on another seat");
    let wallet_on_other_seat = seat_action_as(instruction::Peck {}, &table, &pigeon_dodger.key(), &pigeon_idle.key(), None);
    lab.send_refused(ROLLUP, &[&pigeon_idle.wallet], &[wallet_on_other_seat], error_code(SandwichError::NotSeatOwner), "a wallet acts on another seat");

    for pigeon in [pigeon_session, pigeon_dodger] {
        lab.send(ROLLUP, &[pigeon.signer()], &[seat_action_ix(instruction::FlyTo { box_index: sandwich_box }, &table, pigeon)], "fly_to");
    }
    lab.advance_ticks(FLIGHT_TICKS);
    let mut peck_cu = 0;
    for peck_round in 0..4 {
        peck_cu = lab.send(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_session)], "peck (session)");
        if peck_round < 2 {
            lab.send(ROLLUP, &[pigeon_dodger.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_dodger)], "peck (wallet)");
        }
        if peck_round == 0 {
            lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_session)], error_code(SandwichError::PeckTooSoon), "peck within the cooldown");
        }
        lab.advance_ticks(PECK_COOLDOWN_TICKS);
    }
    assert_eq!(lab.seat(&table, &pigeon_session.key()).pigeon.beak_crumbs, 4);
    assert_eq!(lab.seat(&table, &pigeon_dodger.key()).pigeon.beak_crumbs, 2);

    let raise_cu = lab.send(ROLLUP, &[whale.signer()], &[whale_action_ix(sandwich_box, &table, whale)], "raise_hand");
    lab.send(ROLLUP, &[pigeon_dodger.signer()], &[seat_action_ix(instruction::TakeOff {}, &table, pigeon_dodger)], "take_off before the swat lands");
    lab.advance_ticks(SWAT_WINDUP_TICKS);
    lab.send(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_session)], "peck under the landed swat");
    let flattened = lab.seat(&table, &pigeon_session.key());
    assert!(matches!(flattened.pigeon.state, StoredPigeonState::Stunned { box_index: 1, .. }));
    assert_eq!(flattened.pigeon.beak_crumbs, 2);
    assert_eq!(lab.table(&table).round.loose_crumbs[usize::from(sandwich_box)], 2);
    assert_eq!(lab.seat(&table, &pigeon_dodger.key()).pigeon.beak_crumbs, 2);

    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::Peck {}, &table, pigeon_session)], error_code(SandwichError::Stunned), "a stunned pigeon pecks");
    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[seat_action_ix(instruction::FlyTo { box_index: 2 }, &table, pigeon_session)], error_code(SandwichError::Stunned), "a stunned pigeon flies");
    lab.send_refused(ROLLUP, &[pigeon_session.signer()], &[cash_out_ix(&lab, &table, pigeon_session, 1)], error_code(SandwichError::StillInRound), "cash out during the round");

    let seats: Vec<Pubkey> = players.iter().map(|player| seat_pda(&table, &player.key())).collect();
    lab.send_refused(ROLLUP, &[&admin], &[roster_ix(instruction::Settle {}, &table, &seats)], error_code(SandwichError::RoundNotOver), "settle before the end");
    let end_tick = lab.table(&table).round.end_tick;
    lab.svm.warp_to_slot(end_tick);
    lab.send_refused(ROLLUP, &[&admin], &[roster_ix(instruction::Settle {}, &table, &seats[..3])], error_code(SandwichError::MissingSeat), "settle without the last seat");

    let other_table = lab.create_table(2);
    let stranger = Player { wallet: Keypair::new(), session_signer: None };
    lab.fund_player(&stranger);
    lab.sit(&other_table, &stranger);
    let mut foreign_seats = seats[..3].to_vec();
    foreign_seats.push(seat_pda(&other_table, &stranger.key()));
    lab.send_refused(ROLLUP, &[&admin], &[roster_ix(instruction::Settle {}, &table, &foreign_seats)], error_code(SandwichError::NotTableSeat), "settle with a seat of another table");

    let settle_cu = lab.send(ROLLUP, &[&admin], &[roster_ix(instruction::Settle {}, &table, &seats)], "settle");
    let settled = lab.table(&table);
    assert!(matches!(settled.phase, Phase::Lobby { .. }));
    assert_eq!(settled.round_number, 1);
    assert_eq!(settled.anted, 0);
    let result = settled.last_result.expect("[full_round] last result");
    assert_eq!(result.whale_wallet, whale.key());
    assert_eq!(result.whale_crumbs + result.pigeon_crumbs, 4 * CHIPS_PER_ANTE);
    let chips_after: u64 = players.iter().map(|player| lab.seat(&table, &player.key()).chips).sum();
    assert_eq!(chips_after, chips_in_play);
    assert_eq!(lab.seat(&table, &pigeon_session.key()).chips, BUY_IN_CHIPS - CHIPS_PER_ANTE + 2);
    assert_eq!(lab.seat(&table, &pigeon_dodger.key()).chips, BUY_IN_CHIPS - CHIPS_PER_ANTE + 2);
    assert_eq!(lab.seat(&table, &whale.key()).chips, BUY_IN_CHIPS - CHIPS_PER_ANTE + 396);
    lab.send_refused(ROLLUP, &[&admin], &[roster_ix(instruction::Settle {}, &table, &seats)], error_code(SandwichError::WrongPhase), "second settle");

    for player in &players {
        let chips = lab.seat(&table, &player.key()).chips;
        lab.send(ROLLUP, &[player.signer()], &[cash_out_ix(&lab, &table, player, chips)], "cash_out");
    }
    assert_eq!(lab.token_units(ROLLUP, &escrow), 0);
    let tokens_after: u64 = players.iter().map(|player| lab.token_units(ROLLUP, &ata_of(&player.key(), &lab.mint))).sum();
    assert_eq!(tokens_after, 4 * DEPOSIT_UNITS);

    println!(
        "[full_round_moves_every_chip_and_settles_once] cu start_round={start_cu} on_whale_drawn={callback_cu} peck={peck_cu} raise_hand={raise_cu} settle4={settle_cu} table_bytes={} seat_bytes={}",
        8 + Table::INIT_SPACE,
        8 + Seat::INIT_SPACE
    );
}

#[test]
fn settle_pays_a_full_table_of_21_seats_in_one_transaction() {
    let mut lab = Lab::boot();
    let table = lab.create_table(4);
    let players = seated_players(&mut lab, &table, sandwich_rules::constants::MAX_SEATS);
    join_buy_in_and_ante(&mut lab, &table, &players);
    let admin = lab.admin.insecure_clone();
    lab.send(ROLLUP, &[&admin], &[start_round_ix(&lab, &table)], "start_round");
    lab.svm.warp_to_slot(lab.slot() + 1);
    for pigeon in players.iter().take(PERCHES_PER_BOX_COUNT) {
        lab.send(ROLLUP, &[pigeon.signer()], &[seat_action_ix(instruction::FlyTo { box_index: lab.table(&table).round.sandwich_box }, &table, pigeon)], "fly_to");
    }
    let end_tick = lab.table(&table).round.end_tick;
    lab.svm.warp_to_slot(end_tick);
    let seats: Vec<Pubkey> = players.iter().map(|player| seat_pda(&table, &player.key())).collect();
    let settle = roster_ix(instruction::Settle {}, &table, &seats);
    let fee_payer = admin.pubkey();
    let settle_bytes = Transaction::new(&[&admin], Message::new(std::slice::from_ref(&settle), Some(&fee_payer)), lab.svm.latest_blockhash_for(ROLLUP)).message.serialize().len() + 1 + 64;
    let settle_cu = lab.send(ROLLUP, &[&admin], &[settle], "settle with 21 seats");
    let chips_after: u64 = players.iter().map(|player| lab.seat(&table, &player.key()).chips).sum();
    assert_eq!(chips_after, sandwich_rules::constants::MAX_SEATS as u64 * BUY_IN_CHIPS);
    assert!(settle_bytes <= LEGACY_TRANSACTION_LIMIT_BYTES, "[settle21] {settle_bytes} bytes");
    println!("[settle_pays_a_full_table_of_21_seats_in_one_transaction] cu settle21={settle_cu} bytes={settle_bytes}");
}

#[test]
fn cancel_draw_refunds_antes_and_refuses_the_late_draw() {
    let mut lab = Lab::boot();
    let table = lab.create_table(3);
    let players = seated_players(&mut lab, &table, 2);
    join_buy_in_and_ante(&mut lab, &table, &players);
    let admin = lab.admin.insecure_clone();
    let seats: Vec<Pubkey> = players.iter().map(|player| seat_pda(&table, &player.key())).collect();

    lab.send(ROLLUP, &[&admin], &[start_round_ix(&lab, &table)], "start_round");
    let Phase::Drawing { requested_tick } = lab.table(&table).phase else {
        panic!("[cancel_draw] expected the drawing phase");
    };
    lab.svm.ephemeral_mut().warp_to_slot(requested_tick + DRAW_TIMEOUT_TICKS - 1);
    lab.send_refused(ROLLUP, &[&admin], &[roster_ix(instruction::CancelDraw {}, &table, &seats)], error_code(SandwichError::DrawNotTimedOut), "cancel before the timeout");
    lab.svm.ephemeral_mut().warp_to_slot(requested_tick + DRAW_TIMEOUT_TICKS);
    lab.send(ROLLUP, &[&admin], &[roster_ix(instruction::CancelDraw {}, &table, &seats)], "cancel_draw");

    let cancelled = lab.table(&table);
    assert!(matches!(cancelled.phase, Phase::Lobby { .. }));
    assert_eq!(cancelled.anted, 0);
    assert_eq!(cancelled.round_number, 1);
    for player in &players {
        assert_eq!(lab.seat(&table, &player.key()).chips, BUY_IN_CHIPS);
    }

    let late_callbacks = lab.svm.warp_to_slot(requested_tick + DRAW_TIMEOUT_TICKS + 1);
    match late_callbacks.as_slice() {
        [Err(failed)] => assert!(
            format!("{:?}", failed.err).contains(&format!("Custom({})", error_code(SandwichError::WrongPhase))),
            "[cancel_draw] late draw refused with {:?}",
            failed.err
        ),
        other => panic!("[cancel_draw] expected one refused late callback, got {other:?}"),
    }
    assert!(matches!(lab.table(&table).phase, Phase::Lobby { .. }));
}
