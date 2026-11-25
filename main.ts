// Token Radar's entrypoint (Node 22, standard library only).
//
// It reads the sealed snapshot from /input/snapshot.json (or --input
// <snapshot.json|directory>), scores every pre-token protocol with the
// radar-2 model in lib/model.ts, writes the ranked board to /output/board.json,
// and copies this repository's dashboard/ and screenshots/ into /output.
// Last, it writes /output/dossier.json — the summary the judge reads — with
// the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Write a message to stderr and leave with a nonzero status. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

/** `--name <value>` or `--name=<value>` out of the arguments, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const spaced = argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < argv.length) return argv[spaced + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot file to read: a .json path as given, or snapshot.json inside a directory. */
function snapshotPath(): string {
  const given = flagValue('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** The output directory: --output wins, then MAKEFUN_OUTPUT_DIR, then /output. */
function outputDir(): string {
  return flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** Copy one directory's regular files into `to`, skipping dotfiles, and name what it copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Refuse a screenshot set the gate will not take: fewer than three, or a bad file name. */
function checkShots(names: string[]): void {
  if (names.length < 3) {
    fail(
      `token radar: screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
      1,
    );
  }
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
    }
  }
}

const inputFile = snapshotPath();
if (!existsSync(inputFile)) {
  fail(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
    2,
  );
}
const out = outputDir();

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyDir(join(REPO_ROOT, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(REPO_ROOT, 'screenshots'), join(out, 'screenshots'));
checkShots(shots);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
