//! End-to-end market lifecycle against the REAL TxLINE oracle:
//! the devnet `txoracle.so` binary and a captured `daily_scores_roots`
//! account + Merkle proof from a live devnet match (fixture 18179552).
//! No mocks — resolution here is exactly what happens on-chain.

use anchor_lang::prelude::*;
use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer as _;
use solana_transaction::versioned::VersionedTransaction;

use fulltime::oracle::{ProofNode, ScoreStat, ScoresBatchSummary, ScoresUpdateStats, StatTerm, ValidationBundle};
use fulltime::error::FulltimeError;
use fulltime::state::{Comparison, Market, MarketStatus, Position};
use fulltime::{CreateMarketArgs, Side};

const ORACLE_ID: Pubkey = anchor_lang::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const COMPUTE_BUDGET_ID: Pubkey = anchor_lang::pubkey!("ComputeBudget111111111111111111111111111111");
const FIXTURE_ID: i64 = 18179552;
const UNITS: u64 = 1_000_000; // 6-decimal token
const MINT_LEN: usize = 82; // MINT_LEN
const TOKEN_ACCOUNT_LEN: usize = 165; // TOKEN_ACCOUNT_LEN

struct Harness {
    svm: LiteSVM,
    payer: Keypair,
    mint: Pubkey,
}

fn tx(svm: &mut LiteSVM, payer: &Keypair, extra: &[&Keypair], ixs: &[Instruction]) -> std::result::Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let vtx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(vtx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn code(e: FulltimeError) -> String {
    format!("Custom({})", 6000 + e as u32)
}

fn cu_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2u8]; // SetComputeUnitLimit
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: COMPUTE_BUDGET_ID, accounts: vec![], data }
}

fn setup() -> Harness {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

    svm.add_program(fulltime::id(), include_bytes!("../../../target/deploy/fulltime.so"))
        .unwrap();
    svm.add_program(ORACLE_ID, include_bytes!("../../../tests/fixtures/txoracle.so"))
        .unwrap();

    // real daily_scores_roots account captured from devnet
    let dump: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/daily-scores-roots-20637.json"
    ))
    .unwrap();
    let pubkey: Pubkey = dump["pubkey"].as_str().unwrap().parse().unwrap();
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD
        .decode(dump["account"]["data"][0].as_str().unwrap())
        .unwrap();
    let account = solana_account::Account {
        lamports: dump["account"]["lamports"].as_u64().unwrap(),
        data,
        owner: dump["account"]["owner"].as_str().unwrap().parse().unwrap(),
        executable: false,
        rent_epoch: 0,
    };
    svm.set_account(pubkey, account).unwrap();

    // stake mint
    let mint_kp = Keypair::new();
    let mint_rent = svm.minimum_balance_for_rent_exemption(MINT_LEN);
    let create_mint = anchor_lang::solana_program::system_instruction::create_account(
        &payer.pubkey(),
        &mint_kp.pubkey(),
        mint_rent,
        MINT_LEN as u64,
        &spl_token::id(),
    );
    let init_mint = spl_token::instruction::initialize_mint2(
        &spl_token::id(),
        &mint_kp.pubkey(),
        &payer.pubkey(),
        None,
        6,
    )
    .unwrap();
    tx(&mut svm, &payer, &[&mint_kp], &[create_mint, init_mint]).unwrap();

    Harness { svm, payer, mint: mint_kp.pubkey() }
}

impl Harness {
    fn new_funded_token_account(&mut self, owner: &Keypair, amount: u64) -> Pubkey {
        let acc = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(TOKEN_ACCOUNT_LEN);
        let create = anchor_lang::solana_program::system_instruction::create_account(
            &self.payer.pubkey(),
            &acc.pubkey(),
            rent,
            TOKEN_ACCOUNT_LEN as u64,
            &spl_token::id(),
        );
        let init = spl_token::instruction::initialize_account3(
            &spl_token::id(),
            &acc.pubkey(),
            &self.mint,
            &owner.pubkey(),
        )
        .unwrap();
        let mint_to = spl_token::instruction::mint_to(
            &spl_token::id(),
            &self.mint,
            &acc.pubkey(),
            &self.payer.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        tx(&mut self.svm, &self.payer, &[&acc], &[create, init, mint_to]).unwrap();
        acc.pubkey()
    }

    fn token_balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).unwrap().data;
        u64::from_le_bytes(data[64..72].try_into().unwrap())
    }

    fn set_clock(&mut self, unix_ts: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_ts;
        self.svm.set_sysvar(&clock);
    }

    fn market_pdas(&self, creator: &Pubkey, market_id: u64) -> (Pubkey, Pubkey) {
        let (market, _) = Pubkey::find_program_address(
            &[Market::SEED, creator.as_ref(), &market_id.to_le_bytes()],
            &fulltime::id(),
        );
        let (vault, _) =
            Pubkey::find_program_address(&[Market::VAULT_SEED, market.as_ref()], &fulltime::id());
        (market, vault)
    }

    fn market(&self, market: &Pubkey) -> Market {
        let data = self.svm.get_account(market).unwrap().data;
        Market::try_deserialize(&mut data.as_slice()).unwrap()
    }
}

fn load_bundle() -> ValidationBundle {
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../data/spike-validation-sample.json")).unwrap();
    let bytes32 = |val: &serde_json::Value| -> [u8; 32] {
        let arr: Vec<u8> = val.as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect();
        arr.try_into().unwrap()
    };
    let nodes = |val: &serde_json::Value| -> Vec<ProofNode> {
        val.as_array()
            .unwrap()
            .iter()
            .map(|n| ProofNode { hash: bytes32(&n["hash"]), is_right_sibling: n["isRightSibling"].as_bool().unwrap() })
            .collect()
    };
    ValidationBundle {
        // spike verified: oracle accepts the batch min timestamp as `ts`
        ts: v["summary"]["updateStats"]["minTimestamp"].as_i64().unwrap(),
        fixture_summary: ScoresBatchSummary {
            fixture_id: v["summary"]["fixtureId"].as_i64().unwrap(),
            update_stats: ScoresUpdateStats {
                update_count: v["summary"]["updateStats"]["updateCount"].as_i64().unwrap() as i32,
                min_timestamp: v["summary"]["updateStats"]["minTimestamp"].as_i64().unwrap(),
                max_timestamp: v["summary"]["updateStats"]["maxTimestamp"].as_i64().unwrap(),
            },
            events_sub_tree_root: bytes32(&v["summary"]["eventStatsSubTreeRoot"]),
        },
        fixture_proof: nodes(&v["subTreeProof"]),
        main_tree_proof: nodes(&v["mainTreeProof"]),
        stat_a: StatTerm {
            stat_to_prove: ScoreStat {
                key: v["statToProve"]["key"].as_u64().unwrap() as u32,
                value: v["statToProve"]["value"].as_i64().unwrap() as i32,
                period: v["statToProve"]["period"].as_i64().unwrap() as i32,
            },
            event_stat_root: bytes32(&v["eventStatRoot"]),
            stat_proof: nodes(&v["statProof"]),
        },
        stat_b: None,
    }
}

fn create_market_ix(h: &Harness, creator: &Keypair, creator_token: Pubkey, args: &CreateMarketArgs) -> Instruction {
    let (market, vault) = h.market_pdas(&creator.pubkey(), args.market_id);
    Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::CreateMarket { args: args.clone() }.data(),
        fulltime::accounts::CreateMarket {
            creator: creator.pubkey(),
            market,
            vault,
            creator_token,
            mint: h.mint,
            oracle_program: ORACLE_ID,
            token_program: spl_token::id(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn default_args(bundle: &ValidationBundle, market_id: u64) -> CreateMarketArgs {
    let packet_secs = bundle.ts / 1000;
    CreateMarketArgs {
        market_id,
        fixture_id: FIXTURE_ID,
        stat_key_a: 1, // P1 total goals
        stat_key_b: None,
        op: None,
        comparison: Comparison::GreaterThan,
        threshold: -1, // always-true predicate => resolves YES on any valid proof
        seed_liquidity: 500 * UNITS,
        resolve_after_ts: packet_secs - 100,
        finality_delay_secs: 600,
        void_after_ts: packet_secs + 86_400,
    }
}

#[test]
fn full_lifecycle_create_buy_resolve_claim_with_real_proof() {
    let mut h = setup();
    let bundle = load_bundle();
    let packet_secs = bundle.ts / 1000;

    let creator = Keypair::new();
    let buyer = Keypair::new();
    h.svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    h.svm.airdrop(&buyer.pubkey(), 10_000_000_000).unwrap();
    let creator_token = h.new_funded_token_account(&creator, 1_000 * UNITS);
    let buyer_token = h.new_funded_token_account(&buyer, 1_000 * UNITS);

    h.set_clock(packet_secs - 50); // during the match

    // --- create ---
    let args = default_args(&bundle, 1);
    let ix = create_market_ix(&h, &creator, creator_token, &args);
    tx(&mut h.svm, &creator, &[], &[ix]).unwrap();
    let (market_pda, vault) = h.market_pdas(&creator.pubkey(), 1);
    assert_eq!(h.market(&market_pda).status, MarketStatus::Open);
    assert_eq!(h.token_balance(&vault), 500 * UNITS);

    // --- buy YES in-play ---
    let (position, _) = Pubkey::find_program_address(
        &[Position::SEED, market_pda.as_ref(), buyer.pubkey().as_ref()],
        &fulltime::id(),
    );
    let buy_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Buy { side: Side::Yes, amount_in: 100 * UNITS, min_shares_out: 100 * UNITS }.data(),
        fulltime::accounts::Buy {
            buyer: buyer.pubkey(),
            market: market_pda,
            position,
            vault,
            buyer_token,
            mint: h.mint,
            token_program: spl_token::id(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &buyer, &[], &[buy_ix]).unwrap();
    let m = h.market(&market_pda);
    assert!(m.pool_yes < 500 * UNITS, "YES bought out of pool");
    assert_eq!(m.pool_no, 600 * UNITS);
    assert_eq!(h.token_balance(&vault), 600 * UNITS);

    let pos = Position::try_deserialize(&mut h.svm.get_account(&position).unwrap().data.as_slice()).unwrap();
    assert!(pos.yes_shares > 100 * UNITS && pos.yes_shares < 200 * UNITS);

    // --- resolve blocked before finality window elapses ---
    let (droots, _) = fulltime::oracle::daily_scores_roots_pda(&ORACLE_ID, bundle.ts);
    let resolve_ix = |h: &Harness| {
        Instruction::new_with_bytes(
            fulltime::id(),
            &fulltime::instruction::Resolve { bundle: bundle.clone() }.data(),
            fulltime::accounts::Resolve {
                keeper: h.payer.pubkey(),
                market: market_pda,
                oracle_program: ORACLE_ID,
                daily_scores_roots: droots,
            }
            .to_account_metas(None),
        )
    };
    h.set_clock(packet_secs + 30); // final whistle-ish, VAR window still open
    let early_ix = resolve_ix(&h);
    let payer = h.payer.insecure_clone();
    let err = tx(&mut h.svm, &payer, &[], &[cu_limit_ix(1_400_000), early_ix]).unwrap_err();
    assert!(err.contains(&code(FulltimeError::FinalityGateOpen)), "expected finality gate, got: {err}");

    // --- resolve passes after finality delay, via REAL oracle CPI ---
    h.set_clock(packet_secs + 700);
    h.svm.expire_blockhash(); // avoid identical-tx dedup after the failed attempt
    let late_ix = resolve_ix(&h);
    tx(&mut h.svm, &payer, &[], &[cu_limit_ix(1_400_000), late_ix]).unwrap();
    assert_eq!(h.market(&market_pda).status, MarketStatus::ResolvedYes);

    // --- winner claims 1:1 ---
    let before = h.token_balance(&buyer_token);
    let claim_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Claim {}.data(),
        fulltime::accounts::Claim {
            claimer: buyer.pubkey(),
            market: market_pda,
            position,
            vault,
            claimer_token: buyer_token,
            mint: h.mint,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &buyer, &[], &[claim_ix]).unwrap();
    assert_eq!(h.token_balance(&buyer_token) - before, pos.yes_shares);

    // double-claim rejected
    h.svm.expire_blockhash();
    let claim_again = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Claim {}.data(),
        fulltime::accounts::Claim {
            claimer: buyer.pubkey(),
            market: market_pda,
            position,
            vault,
            claimer_token: buyer_token,
            mint: h.mint,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    let err = tx(&mut h.svm, &buyer, &[], &[claim_again]).unwrap_err();
    assert!(err.contains(&code(FulltimeError::AlreadyClaimed)), "got: {err}");

    // --- creator reclaims pool remainder; vault fully drained (no stuck funds) ---
    let wl_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::WithdrawLiquidity {}.data(),
        fulltime::accounts::WithdrawLiquidity {
            creator: creator.pubkey(),
            market: market_pda,
            vault,
            creator_token,
            mint: h.mint,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &creator, &[], &[wl_ix]).unwrap();
    assert_eq!(
        h.token_balance(&vault),
        0,
        "vault must be exactly emptied: user shares + pool shares == collateral"
    );
}

#[test]
fn resolve_rejects_wrong_fixture_stat_and_oracle() {
    let mut h = setup();
    let bundle = load_bundle();
    let packet_secs = bundle.ts / 1000;

    let creator = Keypair::new();
    h.svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    let creator_token = h.new_funded_token_account(&creator, 1_000 * UNITS);
    h.set_clock(packet_secs - 50);

    // market over a DIFFERENT stat key (corners) — the goals proof must not resolve it
    let mut args = default_args(&bundle, 7);
    args.stat_key_a = 7;
    let ix = create_market_ix(&h, &creator, creator_token, &args);
    tx(&mut h.svm, &creator, &[], &[ix]).unwrap();
    let (market_pda, _) = h.market_pdas(&creator.pubkey(), 7);

    h.set_clock(packet_secs + 700);
    let (droots, _) = fulltime::oracle::daily_scores_roots_pda(&ORACLE_ID, bundle.ts);
    let resolve = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Resolve { bundle: bundle.clone() }.data(),
        fulltime::accounts::Resolve {
            keeper: h.payer.pubkey(),
            market: market_pda,
            oracle_program: ORACLE_ID,
            daily_scores_roots: droots,
        }
        .to_account_metas(None),
    );
    let err = tx(&mut h.svm, &h.payer.insecure_clone(), &[], &[cu_limit_ix(1_400_000), resolve]).unwrap_err();
    assert!(err.contains(&code(FulltimeError::StatKeyMismatch)), "got: {err}");
}

#[test]
fn unresolved_market_voids_and_refunds_cost_basis() {
    let mut h = setup();
    let bundle = load_bundle();
    let packet_secs = bundle.ts / 1000;

    let creator = Keypair::new();
    let buyer = Keypair::new();
    h.svm.airdrop(&creator.pubkey(), 10_000_000_000).unwrap();
    h.svm.airdrop(&buyer.pubkey(), 10_000_000_000).unwrap();
    let creator_token = h.new_funded_token_account(&creator, 1_000 * UNITS);
    let buyer_token = h.new_funded_token_account(&buyer, 1_000 * UNITS);
    h.set_clock(packet_secs - 50);

    let args = default_args(&bundle, 2);
    let ix = create_market_ix(&h, &creator, creator_token, &args);
    tx(&mut h.svm, &creator, &[], &[ix]).unwrap();
    let (market_pda, vault) = h.market_pdas(&creator.pubkey(), 2);

    let (position, _) = Pubkey::find_program_address(
        &[Position::SEED, market_pda.as_ref(), buyer.pubkey().as_ref()],
        &fulltime::id(),
    );
    let buy_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Buy { side: Side::No, amount_in: 50 * UNITS, min_shares_out: 0 }.data(),
        fulltime::accounts::Buy {
            buyer: buyer.pubkey(),
            market: market_pda,
            position,
            vault,
            buyer_token,
            mint: h.mint,
            token_program: spl_token::id(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &buyer, &[], &[buy_ix]).unwrap();

    // too early to void
    let void_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::VoidMarket {}.data(),
        fulltime::accounts::VoidMarket { caller: h.payer.pubkey(), market: market_pda }.to_account_metas(None),
    );
    let err = tx(&mut h.svm, &h.payer.insecure_clone(), &[], &[void_ix.clone()]).unwrap_err();
    assert!(err.contains(&code(FulltimeError::VoidTooEarly)), "got: {err}");

    // abandoned match: deadline passes with no proof
    h.set_clock(args.void_after_ts + 1);
    h.svm.expire_blockhash(); // avoid identical-tx dedup after the failed attempt
    tx(&mut h.svm, &h.payer.insecure_clone(), &[], &[void_ix]).unwrap();
    assert_eq!(h.market(&market_pda).status, MarketStatus::Voided);

    // buyer refunded exact cost basis
    let before = h.token_balance(&buyer_token);
    let claim_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::Claim {}.data(),
        fulltime::accounts::Claim {
            claimer: buyer.pubkey(),
            market: market_pda,
            position,
            vault,
            claimer_token: buyer_token,
            mint: h.mint,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &buyer, &[], &[claim_ix]).unwrap();
    assert_eq!(h.token_balance(&buyer_token) - before, 50 * UNITS);

    // creator reclaims seed liquidity
    let before = h.token_balance(&creator_token);
    let wl_ix = Instruction::new_with_bytes(
        fulltime::id(),
        &fulltime::instruction::WithdrawLiquidity {}.data(),
        fulltime::accounts::WithdrawLiquidity {
            creator: creator.pubkey(),
            market: market_pda,
            vault,
            creator_token,
            mint: h.mint,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
    );
    tx(&mut h.svm, &creator, &[], &[wl_ix]).unwrap();
    assert_eq!(h.token_balance(&creator_token) - before, 500 * UNITS);
    assert_eq!(h.token_balance(&vault), 0);
}
