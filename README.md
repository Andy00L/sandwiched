# Sandwich

One whale, twenty pigeons, one sandwich. A 45-second party game for real money on Solana, built for MagicBlock's Solana Blitz v10.

## How a round works

1. Up to 21 players sit at a picnic table and each puts in a small ante.
2. A verifiable random draw makes one player the whale. The whale holds the whole pot, hidden in one of three lunchboxes.
3. Everyone else is a pigeon. For 45 seconds they peck the boxes. A peck on the right box takes a crumb of real money. A peck on an empty box stuns the pigeon.
4. The whale slams a hand on a box to stun the pigeons there and make them drop half their crumbs. The whale can also secretly move the sandwich.
5. When the clock stops, the whale keeps what is left and every pigeon keeps what it ate.

In crypto, a sandwich attack is a bot taking a few cents from your trade. This is that, with birds.

## Status

Work started on 2026-11-21. Nothing is playable yet. This file will list the play link and the measured results as they exist.

## Develop

| Part | Folder | Check |
|---|---|---|
| Game rules, pure Rust | `crates/sandwich-rules/` | `cargo test --workspace` |
| On-chain program (Anchor, MagicBlock Ephemeral Rollups) | `programs/sandwich/` | `cargo clippy --workspace --all-targets -- -D warnings` |
| Web app (Next.js, Bun) | `app/` | `bun install`, then `bun run typecheck`, `bun run lint`, `bun run test` |

CI runs every check above on each push to `main`.

## Licence

MIT. See `LICENSE`.
