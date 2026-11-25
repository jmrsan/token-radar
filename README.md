# Token Radar · radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jmrsan/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jmrsan/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built by an AI agent for make.fun's ["Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01), $1,325 in USDC.

A radar for token launches. It takes a sealed DefiLlama snapshot of
protocols, scores the ones that record no token by implied value, and
produces a dashboard that opens in a browser with no network at all.

## The question it answers

Which pre-token protocol should I farm next, and what exactly do I do?

The floor is the watchlist: every protocol holding at least $50M of TVL
that records no token. Below that floor, the early radar scores every
other rankable pre-token protocol. On this snapshot that means 40
watchlist protocols plus 186 early ones — 226 rows in total. Protocols
whose token already trades are kept apart, their market caps shown, and
never folded into the ranking.

## How the model scores (radar-2)

Each protocol gets one score, computed from the snapshot's own numbers
and nothing else:

```text
implied = round(tvl_usd x 0.30 x (1 + clamp(change_7d, -50, 100) / 100 x 0.6) x age_mult x (1 + 0.04 x min(chains - 1, 5)) x category_mult)
```

- **Age:** under 90 days scores 0.90, and 90–540 days scores 1.10 — the
  prime launch window, old enough to be real and young enough to still
  launch. 540–1095 days scores 1.00, and older scores 0.95.
- **Category:** Lending, Dexs, CDP, Derivatives, Yield and RWA score 1.08,
  while Yield Aggregator, Onchain Capital Allocator, Risk Curators and
  Basis Trading score 1.04. Liquid Staking, Liquid Restaking, Staking
  Pool and Bridge score 0.88; everything else scores 1.00.
- No protocol name gets special treatment. Saying a protocol "records no
  token" in the snapshot is a statement about the record, not a promise
  that it will ever issue one. Implied value is a model estimate, never
  a price.

Every row also carries a seven-step farm plan, worked out from its
category, its chains, its TVL and its age: a fresh wallet, the action
that fits the category, a weekly qualifying action, a hold of 30–60 days,
a weekly TVL check with an unwind rule, a claim-safety step (never pay
to claim, and only follow links the protocol itself publishes), and a
farm log with a staged exit.

## Running it

Node 22 or later, standard library only, nothing to install:

```shell
mkdir -p ./out
MAKEFUN_OUTPUT_DIR=out node main.ts \
  --input <snapshot.json|directory>
```

That writes `out/board.json` (the ranked board), `out/data.js` (the
dashboard's data), `out/dashboard/` (the page itself), `out/screenshots/`
(the board, a detail view and a filtered view) and `out/dossier.json`.

## What's in here

- `main.ts` — the entry point the grader runs.
- `lib/model.ts` — the radar-2 scoring model, the board builder and the farm plans.
- `vendor/makefun-board.ts` — the make.fun dossier library, copied byte for byte.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — three screenshots of the dashboard above.

## License (MIT)

MIT — see the `LICENSE` file.
