# Sandwich: rules for agents

Commands, from the repo root unless noted:

| What | Command |
|---|---|
| App types, lint, tests | `cd app && bun run typecheck && bun run lint && bun test` |
| Rules crate and clippy | `cargo clippy --workspace --all-targets --locked -- -D warnings && cargo test --workspace --locked` |
| Program build and MagicSVM tests | `cargo build-sbf --manifest-path programs/sandwich/Cargo.toml && (cd tests-magicsvm && cargo test --release --locked)` |
| Table money model (TLA+) | `TLA2TOOLS=/path/to/tla2tools.jar verification/table-money/check.sh` |
| Scene captures | `.scratch/pyvenv/bin/python tools/papercraft/capture.py app --url http://localhost:3000/stage --page "stage?replay=slam-showcase" f8:time=6.35` (exit 1 means a page error or a card clip: read it, never pipe it away) |
| Sync the IDL after a program change | `cd app && bun scripts/sync-idl.ts` |

CI (`.github/workflows/ci.yml`) runs every command above except captures.

## Rule table

Each rule names what enforces it. A rule with "judgment" has no check: it is the last resort. When a correction repeats a rule that has a check, the check is broken; fix the check in the same change.

| Rule | Enforced by |
|---|---|
| No `throw` in `app/src/lib/**`, `app/src/app/api/**`, `app/scripts/**`: return `{ ok, ... }` results | lint `BANNED_IN_LIB` in `app/eslint.config.mjs` |
| Every network request has a deadline: `fetchWithTimeout` or `createRpcConnection` from `app/src/lib/chain/rpc.ts`; `Transaction.serialize` only inside `attempt`/`attemptSync` | lint `REQUESTS_THROUGH_RPC` |
| No allocation per frame in `app/src/lib/table/replay` and `motion`: no `new THREE.*`, `.clone()`, `new Map`/`Set` outside `build*`/`create*`/`print*`/`make*` functions or inside `onStep` | lint `NO_ALLOCATION_PER_FRAME` |
| Only `app/src/lib/table/motion/verbs.ts` writes `.scale` | lint `SCALE_ONLY_IN_VERBS` |
| No `useEffect`, no `as unknown as`, no `any`, no `@ts-ignore`, no single-letter names | lint (`no-restricted-syntax`, `no-restricted-imports`, `id-length`, typescript-eslint) |
| The program's funds paths (buy-in, cash-out, ante, withdraw_ante, settle, abort_round, cancel_draw, evict_seat) keep their MagicSVM tests green | CI job `program` |
| A guest who wants out can always get their chips back alone; no instruction creates or loses chips | TLA+ `verification/table-money` (CI job `models`); skill `table-money` |
| A pigeon's body matches its chain pose after any mix of events and frames | Bun model check `app/src/lib/table/replay/pigeon-life.check.test.ts`; skill `pigeon-life` |
| A deposit's record outlives every state where its tokens can still land or sit unmerged in the shuttle, across crashes, reloads, two tabs and balance moves | Bun check `app/src/lib/chain/deposits.check.test.ts` (`verification/deposit-shuttle/check.sh`, CI job `app`), breaks in `verification/deposit-shuttle/prove-breaks.sh`; skill `deposit-shuttle` |
| The table store publishes the rounds the chain played (seats, whale, swats, settle split, beaks) however its snapshots are polled, coalesced, delayed, duplicated or restarted | Bun check `app/src/lib/game/table-store.check.test.ts` (`verification/table-store/check.sh`), breaks in `verification/table-store/mutants.ts`; skill `table-store` |
| A watched account shows fresh chain data, or the feed status leaves `live`, through any order of socket, RPC and timer events | Bun model check `app/src/lib/chain/account-feed.check.test.ts`, breaks in `verification/account-feed/prove-breaks.sh`; skill `account-feed` |
| The sponsor's per-IP, per-wallet and spend limits hold across every server instance, and the sponsor refuses when the shared limiter cannot be reached | `app/src/lib/chain/sponsor-guards.test.ts` (fail-closed case in CI; the shared-database case runs with `UPSTASH_LIVE_TEST=1`) |
| State that moves through stages is a discriminated union with one transition function, not flags plus scattered `if`s | judgment, then a formal check per subsystem (`.claude/skills/*`) |
| The app's IDL copy matches the built program | `app/src/lib/chain/idl-sync.test.ts` |
| No card cuts into another on the hero; a known crossing needs an entry in `app/accepted-clips.json` with reason, depth, expiry and a human approver | `tools/papercraft/capture.py` exit code |
| Look in the code, the plan and the docs before asking the human a question they already answered | judgment |
| Never stage `.claude/`, `.scratch/`, `ui-design/`, `.env*` or a keypair | `.gitignore` |
