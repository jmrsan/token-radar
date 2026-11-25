// Token Radar's scoring model, radar-2.
//
// One sealed snapshot goes in; one ranked board comes out. The board always
// carries the whole watchlist — the floor, never a ceiling — and on top of it
// every rankable pre-token protocol sitting below the watchlist floor, which is
// the early radar this tool exists to find. A protocol records no token when
// its snapshot entry carries no market cap, no CoinGecko id and no symbol.
// Live-token protocols are kept apart and shown at the market's own values,
// never folded into the ranking.
//
// Every protocol is scored by the same single function, from the snapshot's
// own figures only:
//
//   base     = tvl_usd x 0.30                      a launch is worth a share of value locked
//   growth   = clamp(change_7d, -50, 100)          a 4448% week on a tiny base is not a trend
//   growth x = 1 + (growth / 100) x 0.6            momentum matters; it does not dominate
//   age x    = 0.90 below 90 days, 1.10 for 90-540 days, 1.00 for 540-1095, 0.95 older
//                                                  the prime window: real enough, still young enough
//                                                  to launch; an unlisted age scores 1.00
//   breadth  = 1 + 0.04 x min(chains - 1, 5)       more chains, more users a launch could reward
//   category = 1.08 Lending, Dexs, CDP, Derivatives, Yield, RWA
//              1.04 Yield Aggregator, Onchain Capital Allocator, Risk Curators, Basis Trading
//              0.88 Liquid Staking, Liquid Restaking, Staking Pool, Bridge, Canonical Bridge
//              1.00 everything else
//                                                  a category whose own token is the product scores
//                                                  higher; wrapped, staked and bridged products
//                                                  score lower, because they usually already trade
//   implied  = max(1, round(tvl_usd x 0.30 x growth x x age x x breadth x category))
//
// No protocol name is ever special-cased.

/** One protocol entry from the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  age_prime_low: number;
  age_prime_high: number;
  age_prime_mult: number;
  age_new_mult: number;
  age_old_mult: number;
  age_mid_mult: number;
  category_high: number;
  category_mid: number;
  category_low: number;
  unknown_age_mult: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
  age_prime_low: 90,
  age_prime_high: 540,
  age_prime_mult: 1.1,
  age_new_mult: 0.9,
  age_old_mult: 0.95,
  age_mid_mult: 1.0,
  category_high: 1.08,
  category_mid: 1.04,
  category_low: 0.88,
  unknown_age_mult: 1.0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    breadth_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  category_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimals, for the multipliers the board reports. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Clamp `n` into [`lo`, `hi`]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

// ---------------------------------------------------------------------------
// The multipliers
// ---------------------------------------------------------------------------

const HIGH_CATEGORIES = new Set(['lending', 'dexs', 'cdp', 'derivatives', 'yield', 'rwa']);
const MID_CATEGORIES = new Set(['yield aggregator', 'onchain capital allocator', 'risk curators', 'basis trading']);
const LOW_CATEGORIES = new Set(['liquid staking', 'liquid restaking', 'staking pool', 'bridge', 'canonical bridge']);

/** The category multiplier for one protocol, from its category alone. */
export function categoryMultiplier(p: SnapshotProtocol, model: ModelConstants): number {
  const c = (p.category ?? '').toLowerCase();
  if (HIGH_CATEGORIES.has(c)) return model.category_high;
  if (MID_CATEGORIES.has(c)) return model.category_mid;
  if (LOW_CATEGORIES.has(c)) return model.category_low;
  return 1;
}

/** The age multiplier for one protocol: the prime launch window scores highest. */
export function ageMultiplier(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_age_mult;
  if (age < model.age_prime_low) return model.age_new_mult;
  if (age <= model.age_prime_high) return model.age_prime_mult;
  if (age <= 1095) return model.age_mid_mult;
  return model.age_old_mult;
}

/** The breadth multiplier: more chains is more users a launch could reward. */
export function breadthMultiplier(p: SnapshotProtocol, model: ModelConstants): number {
  const extraChains = clamp(p.chains.length - 1, 0, model.breadth_max_chains);
  return 1 + model.breadth_per_chain * extraChains;
}

/** One protocol's full scoring breakdown under `model`. */
export interface ScoreBreakdown {
  implied: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  breadthMult: number;
  categoryMult: number;
  age: number | null;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): ScoreBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finiteOr(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult = ageMultiplier(age, model);
  const breadthMult = breadthMultiplier(protocol, model);
  const categoryMult = categoryMultiplier(protocol, model);
  const raw = protocol.tvl_usd * model.base_multiple * growthMult * ageMult * breadthMult * categoryMult;
  return { implied: Math.max(1, Math.round(raw)), growthPct, growthMult, ageMult, breadthMult, categoryMult, age };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** Slug order for ties: alphabetical, so a rerun ranks the same way. */
function slugOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Board selection and ranking
// ---------------------------------------------------------------------------

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The watchlist's protocols: every slug the snapshot still carries. A slug the snapshot no longer
 *  carries cannot be ranked, but the board's coverage is the gate's row and is never gambled on a
 *  missing record, so a missing slug simply contributes nothing. */
function watchlistPicks(snapshot: Snapshot, index: Map<string, SnapshotProtocol>): SnapshotProtocol[] {
  const picks: SnapshotProtocol[] = [];
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picks.push(p);
  }
  return picks;
}

/** The early radar: every rankable pre-token protocol below the watchlist floor, by TVL, capped —
 *  and never a replacement for a watchlist row, so a protocol already picked stays picked. */
function earlyPicks(snapshot: Snapshot, alreadyPicked: Set<string>): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => !alreadyPicked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || slugOrder(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
}

interface Scored {
  protocol: SnapshotProtocol;
  score: ScoreBreakdown;
}

/** Score every picked protocol, rank strongest first, and number the rows 1..n. */
function rankScored(picked: SnapshotProtocol[], snapshot: Snapshot, model: ModelConstants): BoardRow[] {
  const scored: Scored[] = picked.map((protocol) => ({ protocol, score: impliedValue(protocol, snapshot.as_of, model) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || slugOrder(a.protocol.slug, b.protocol.slug));
  return scored.map((entry, i) => {
    const p = entry.protocol;
    const v = entry.score;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: v.age,
      implied_value_usd: v.implied,
      model: {
        base_multiple: model.base_multiple,
        growth_pct: v.growthPct,
        growth_multiplier: round4(v.growthMult),
        age_multiplier: round4(v.ageMult),
        breadth_multiplier: round4(v.breadthMult),
        category_multiplier: round4(v.categoryMult),
        age_days: v.age,
      },
      farm_steps: farmSteps(p, v.age).map(stepText),
    };
  });
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const picked = watchlistPicks(snapshot, index);
  const pickedSlugs = new Set(picked.map((p) => p.slug));
  for (const p of earlyPicks(snapshot, pickedSlugs)) picked.push(p);
  return rankScored(picked, snapshot, model);
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One rule for the category's action: the first matching keyword wins, in table order. */
interface ActionRule {
  keywords: string[];
  write: (name: string, capital: number, chain: string) => string;
}

const ACTION_RULES: ActionRule[] = [
  { keywords: ['lend', 'cdp', 'collateral'], write: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open.` },
  { keywords: ['dex', 'yield', 'leveraged farm'], write: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open.` },
  { keywords: ['bridge'], write: (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app.` },
  { keywords: ['staking', 'restak'], write: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt.` },
  { keywords: ['perpetual', 'derivative'], write: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge.` },
  { keywords: ['prediction'], write: (n, c, ch) => `Fund $${c} and place one market position on ${n}.` },
  { keywords: ['curator', 'allocator'], write: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares.` },
  { keywords: ['stable'], write: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch}.` },
  { keywords: ['rwa'], write: (n, c, ch) => `Mint $${c} of the protocol's yield asset on ${ch} and hold it.` },
  { keywords: ['insurance'], write: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy.` },
  { keywords: ['basis'], write: (n, c, ch) => `Deposit $${c} of USDC into ${n}'s basis vault on ${ch} and keep the position open.` },
  { keywords: ['chain'], write: (n, c, ch) => `Use ${n} on ${ch} with $${c} of activity and keep using it weekly.` },
  { keywords: ['payment'], write: (n, c, ch) => `Pay $${c} through ${n} on ${ch} and keep the receipts.` },
];

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.keywords.some((k) => category.includes(k))) return rule.write(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One rule for the weekly qualifying action, so the plan is not the same sentence twice. */
interface WeeklyRule {
  keywords: string[];
  write: (name: string) => string;
}

const WEEKLY_RULES: WeeklyRule[] = [
  { keywords: ['lend', 'cdp', 'collateral'], write: (n) => `Each week, borrow a small amount against the deposit on ${n} and repay it, so the wallet shows both sides of the market.` },
  { keywords: ['dex', 'yield'], write: (n) => `Each week, swap a small amount in ${n}'s main pool and add a little liquidity, so the wallet shows repeated use.` },
  { keywords: ['bridge'], write: (n) => `Each week, bridge a small amount through ${n} and use it on the destination chain, so the wallet shows repeated crossings.` },
  { keywords: ['staking', 'restak'], write: (n) => `Each week, check the staking rewards on ${n} and restake a small amount, so the wallet shows continued staking.` },
  { keywords: ['perpetual', 'derivative'], write: (n) => `Each week, open and close one small hedged trade on ${n}, so the wallet shows repeated trading.` },
  { keywords: ['prediction'], write: (n) => `Each week, place one small market position on ${n}, so the wallet shows repeated participation.` },
  { keywords: ['curator', 'allocator'], write: (n) => `Each week, check the vault's allocation on ${n} and top it up a little, so the wallet shows continued deposits.` },
  { keywords: ['rwa'], write: (n) => `Each week, check the yield asset's accrual on ${n} and hold it, so the wallet shows a long position.` },
];

/** The category's weekly qualifying action. */
function weeklyFor(p: SnapshotProtocol): string {
  const category = (p.category ?? '').toLowerCase();
  for (const rule of WEEKLY_RULES) {
    if (rule.keywords.some((k) => category.includes(k))) return rule.write(p.name);
  }
  return `Each week, make one qualifying action on ${p.name}, such as a deposit, a swap or a vote, so the wallet shows repeated use.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const setupGas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${setupGas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's TVL and 7-day growth once a week; unwind the position if TVL falls by more than 30% in a week or the team goes quiet.`,
      cost: 'nothing but the check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes itself, and never pay to claim or follow a claim link from a direct message.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it, and withdraw in stages instead of all at once.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------------------
// Live rows and the dashboard dataset
// ---------------------------------------------------------------------------

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_multiplier: row.model.category_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// Snapshot parsing and board validation
// ---------------------------------------------------------------------------

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
