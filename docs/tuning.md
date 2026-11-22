# Tuning

The balance target (plan/04 section 4, T4): with 8 players and the simulator's three pigeon temperaments, the whale keeps 35 to 55 % of the pot on average. Measured with `cargo run --release -p sandwich-tune -- balance --players <n> --rounds <n> --seed 1 [overrides]`; each line is that command's report. The simulator's bot whale swats the most crowded box as soon as its hand is ready, so these numbers are the whale's best case.

## Sweep at 8 players, 300 rounds, one constant at a time (2026-11-22)

| Change from the old constants | Whale keeps | Swats per round | Greedy / nervous / vulture crumbs per pigeon |
|---|---|---|---|
| none (peck 300 ms, swat cooldown 900 ms, swat stun 1,500 ms) | 82.8 % | 33.5 | 3.3 / 46.0 / 12.1 |
| swat cooldown 1,500 ms | 69.3 % | 23.7 | 1.2 / 61.4 / 45.6 |
| swat cooldown 2,000 ms | 67.5 % | 19.0 | 2.0 / 61.0 / 51.1 |
| swat cooldown 2,600 ms | 62.8 % | 15.0 | 7.3 / 70.1 / 53.2 |
| swat cooldown 3,200 ms | 62.5 % | 13.0 | 6.0 / 73.2 / 52.4 |
| swat stun 1,000 ms | 75.7 % | 31.9 | 1.5 / 45.4 / 38.4 |
| swat stun 700 ms | 76.2 % | 32.9 | 2.4 / 45.1 / 36.0 |
| peck cooldown 200 ms | 78.3 % | 33.5 | 4.9 / 55.3 / 16.9 |
| empty-box stun 1,000 ms | 82.8 % | 33.5 | 3.3 / 46.0 / 12.1 |
| wind-up 500 ms | 74.8 % | 29.1 | 2.4 / 64.9 / 22.6 |

## Combinations at 8 players, 300 rounds

| Swat cooldown | Swat stun | Peck cooldown | Whale keeps | Swats |
|---|---|---|---|---|
| 2,600 ms | 1,000 ms | 300 ms | 61.3 % | 15.0 |
| 2,600 ms | 1,000 ms | 250 ms | 53.0 % | 15.0 |
| 2,600 ms | 1,000 ms | 200 ms | 41.2 % | 15.0 |
| 2,000 ms | 1,000 ms | 200 ms | 46.2 % | 19.0 |
| 3,200 ms | 1,000 ms | 250 ms | 53.9 % | 13.0 |

## Chosen: swat cooldown 2,600 ms, swat stun 1,000 ms, peck cooldown 250 ms

A swat about every 3 s, which is the practice whale plan/09 asks for. 2,000 rounds per table size:

| Players | Whale keeps (spread) | Swats | Pot emptied before the clock | Greedy / nervous / vulture |
|---|---|---|---|---|
| 4 | 62.5 % (18.4) | 14.4 | 1.4 % | 12.6 / 93.3 / 43.8 |
| 8 | 52.5 % (12.2) | 15.0 | 0.1 % | 12.8 / 92.0 / 59.2 |
| 14 | 72.5 % (10.5) | 15.0 | 0.0 % | 12.4 / 54.5 / 22.1 |
| 21 | 83.9 % (7.5) | 15.0 | 0.0 % | 11.1 / 29.0 / 10.7 |

Old constants at the same sizes: 84.6 %, 82.0 %, 89.5 %, 95.8 %.

Not met: greedy pigeons, which never dodge, earn about a seventh of the nervous ones (target: no temperament earns more than twice another), and large tables still favour the whale because a crowded box puts more pigeons under each swat. Both wait for the playtests; `SWAT_DROP_PERCENT` (a constant, not yet a simulator flag) is the next lever for the first.

Live check on devnet after the upgrade (slot 525,203,326): round 13 at practice table 2001, a bot whale and 6 pigeons, the whale kept 340 of 700 crumbs (48.6 %) with 10 swats.
