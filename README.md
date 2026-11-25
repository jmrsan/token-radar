# Token Radar — radar-2

A token launch radar: it reads a sealed DefiLlama protocol snapshot, ranks the
pre-token protocols by implied value, and writes a dashboard you can open in a
browser with no network.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it?

The watchlist is the floor: every protocol with at least $50M of TVL that
records no token. The early radar adds every rankable pre-token protocol below
that floor. In this snapshot that is 40 watchlist protocols and 186 early
ones, 226 rows in all. Live-token protocols are set aside with their market
caps shown, never mixed into the ranking.

## The model (radar-2)

One function scores every protocol, from the snapshot's own figures only:

```
implied = round(tvl_usd x 0.30
  x (1 + clamp(change_7d, -50, 100) / 100 x 0.6)
  x age_mult x (1 + 0.04 x min(chains - 1, 5)) x category_mult)
```

- **Age:** under 90 days scores 0.90, 90–540 days scores 1.10 (the prime
  launch window: old enough to be real, young enough to still launch),
  540–1095 days scores 1.00, older scores 0.95.
- **Category:** Lending, Dexs, CDP, Derivatives, Yield and RWA score 1.08;
  Yield Aggregator, Onchain Capital Allocator, Risk Curators and Basis
  Trading score 1.04; Liquid Staking, Liquid Restaking, Staking Pool and
  Bridge score 0.88; the rest score 1.00.
- No protocol name is special-cased. A protocol "records no token" in the
  snapshot; that is a record, not a promise it will ever issue one. Implied
  value is a model estimate, never a price.

Each row carries a seven-step farm plan derived from its category, chains,
TVL and age: a fresh wallet, the category's action, a weekly qualifying
action, a hold of 30–60 days, a weekly TVL check with an unwind rule, a
claim-safety step (never pay to claim, only follow links the protocol itself
publishes), and a farm log with a staged exit.

## Run it

Node 22 or later, standard library only, no install:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json` (the ranked board), `out/data.js` (the
dashboard's data), `out/dashboard/` (the page), `out/screenshots/` (the
board, a detail view and a filtered view) and `out/dossier.json`.

## Files

- `main.ts` — the entrypoint the grader runs.
- `lib/model.ts` — the radar-2 model, the board builder and the farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte for byte.
- `dashboard/` — a static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the three screenshots of the dashboard above.

## License

MIT. See `LICENSE`.
