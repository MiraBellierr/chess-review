/**
 * Headless analysis CLI — the tuning workhorse.
 *
 *   npm run analyze -- path/to/game.pgn [--movetime=250] [--multipv=3] [--index=0] [--json]
 */
import fs from 'node:fs';
import { parsePgnGame, splitPgnGames } from './analysis/pgn.js';
import { analyzeGame } from './analysis/analyze.js';
import { engineManager } from './engine/manager.js';
import { openingBook } from './analysis/book.js';
import type { Label, StoredGame } from './types.js';

function usage(): never {
  console.error('Usage: npm run analyze -- <file.pgn> [--movetime=250] [--multipv=3] [--index=0] [--json]');
  process.exit(1);
}

const args = process.argv.slice(2);
const opts = { movetimeMs: 250, multipv: 3, index: 0, json: false };
const positional: string[] = [];
for (const arg of args) {
  if (arg.startsWith('--movetime=')) opts.movetimeMs = Number(arg.split('=')[1]) || 250;
  else if (arg.startsWith('--multipv=')) opts.multipv = Number(arg.split('=')[1]) || 3;
  else if (arg.startsWith('--index=')) opts.index = Number(arg.split('=')[1]) || 0;
  else if (arg === '--json') opts.json = true;
  else if (!arg.startsWith('--')) positional.push(arg);
}
const file = positional[0];
if (!file) usage();
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

function fmtScore(cp?: number, mate?: number): string {
  if (mate !== undefined) return `${mate > 0 ? '+' : '-'}M${Math.abs(mate)}`;
  if (cp === undefined) return '  ?  ';
  if (Math.abs(cp) >= 20000) return cp > 0 ? ' +WIN' : ' -WIN';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

const LABEL_ORDER: Label[] = [
  'Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book',
  'Inaccuracy', 'Mistake', 'Miss', 'Blunder', 'Forced',
];

async function main(): Promise<void> {
  const text = fs.readFileSync(file, 'utf8');
  const chunks = splitPgnGames(text);
  if (chunks.length === 0) {
    console.error('No games found in file.');
    process.exit(1);
  }
  if (chunks.length > 1 && opts.index === 0) {
    console.log(`Found ${chunks.length} games — analysing game #1 (use --index to pick another).`);
  }
  const parsed = parsePgnGame(chunks[Math.min(opts.index, chunks.length - 1)]);
  openingBook.load();

  const game: StoredGame = {
    id: 0,
    source: 'pgn',
    sourceUrl: null,
    meta: parsed.meta,
    startFen: parsed.startFen,
    moves: parsed.moves,
    pgn: parsed.pgn,
    createdAt: Date.now(),
  };

  console.log(`Opening book: ${openingBook.loaded ? `${openingBook.lineCount} lines` : 'NOT LOADED (run npm run setup)'}`);
  console.log(
    `\n${parsed.meta.white} vs ${parsed.meta.black} (${parsed.meta.result}) — ${parsed.moves.length} plies, ` +
      `movetime ${opts.movetimeMs}ms, MultiPV ${opts.multipv}\n`,
  );

  const data = await analyzeGame(game, {
    movetimeMs: opts.movetimeMs,
    multipv: opts.multipv,
    onProgress: (done, total) => {
      process.stderr.write(`\rAnalysing ${done}/${total} positions...`);
    },
  });
  process.stderr.write('\r');

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  const moveLabel = (ply: { fenBefore: string; ply: number }) => {
    const parts = ply.fenBefore.split(' ');
    return parts[1] === 'b' ? `${parts[5]}...` : `${parts[5]}.`;
  };
  for (const ply of data.plies) {
    const num = moveLabel(ply);
    const line =
      `${pad(num, 6)} ${pad(ply.san, 8)} ${pad(ply.label, 10)} ` +
      `${pad(fmtScore(ply.cpBefore, ply.mateBefore), 7)} -> ${pad(fmtScore(ply.cpAfter, ply.mateAfter), 7)} ` +
      `best: ${pad(ply.bestSan ?? '-', 8)} ${ply.caption ?? ''}`;
    console.log(line);
  }

  for (const [name, stats] of [
    [parsed.meta.white, data.white],
    [parsed.meta.black, data.black],
  ] as const) {
    console.log(`\n--- ${name} ---`);
    console.log(`Accuracy: ${stats.accuracy.toFixed(1)}%   Game Rating: ~${stats.rating}`);
    console.log(
      `Phases: opening ${stats.phaseAccuracy.opening?.toFixed(1) ?? '-'}% | ` +
        `middlegame ${stats.phaseAccuracy.middlegame?.toFixed(1) ?? '-'}% | ` +
        `endgame ${stats.phaseAccuracy.endgame?.toFixed(1) ?? '-'}%`,
    );
    const counts = LABEL_ORDER.filter((l) => stats.counts[l] > 0)
      .map((l) => `${l}: ${stats.counts[l]}`)
      .join(', ');
    console.log(`Moves: ${counts}`);
  }

  if (data.keyMoments.length > 0) {
    console.log('\n--- Key moments ---');
    for (const moment of data.keyMoments) {
      const num = moveLabel(data.plies[moment.ply]);
      console.log(`${num} ${data.plies[moment.ply].san}: ${moment.caption}`);
    }
  }
  console.log(`\nEngine: ${data.engine ?? 'Stockfish'}  Depth reached: ${data.depthReached}`);
}

main()
  .then(() => {
    engineManager.shutdown();
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\nError: ${err instanceof Error ? err.message : err}`);
    engineManager.shutdown();
    process.exit(1);
  });
