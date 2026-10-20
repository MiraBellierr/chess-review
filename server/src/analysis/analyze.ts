import { Chess } from 'chess.js';
import { engineManager, type EvalOutcome } from '../engine/manager.js';
import { openingBook } from './book.js';
import { classifyMove } from './classify.js';
import { computeAccuracy, estimateRating, scoreToWinPct } from './accuracy.js';
import { concededMaterialCp } from './see.js';
import {
  ALL_LABELS,
  type AnalysisData,
  type KeyMoment,
  type Label,
  type Phase,
  type PlayerStats,
  type PlyAnalysis,
  type StoredGame,
} from '../types.js';

const BOOK_MAX_PLY = 50;
const OPENING_FALLBACK_PLIES = 16;
const MOMENT_LABELS = new Set<Label>(['Brilliant', 'Great', 'Miss', 'Mistake', 'Blunder']);

export class AnalysisAbortedError extends Error {
  constructor() {
    super('Analysis aborted.');
  }
}

export interface AnalyzeOptions {
  movetimeMs: number;
  multipv: number;
  onProgress?: (donePositions: number, totalPositions: number, ply?: PlyAnalysis) => void;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    engineManager.cancelInFlight();
    throw new AnalysisAbortedError();
  }
}

function scoreOf(line: { cp?: number; mate?: number } | undefined): { cp?: number; mate?: number } {
  return { cp: line?.cp, mate: line?.mate };
}

function toMover(score: { cp?: number; mate?: number }, moverIsWhite: boolean): { cp?: number; mate?: number } {
  if (moverIsWhite) return score;
  return {
    cp: score.cp !== undefined ? -score.cp : undefined,
    mate: score.mate !== undefined ? -score.mate : undefined,
  };
}

function uciLineToSan(fen: string, ucis: string[]): string[] {
  const out: string[] = [];
  try {
    const chess = new Chess(fen);
    for (const uci of ucis) {
      const mv = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      });
      out.push(mv.san);
    }
  } catch {
    /* stop at the first illegal move — PVs come from the engine but the board is the source of truth */
  }
  return out;
}

/** Value of non-pawn, non-king material on the board (both sides, in points). */
function nonPawnMaterial(fen: string): number {
  const board = fen.split(' ')[0];
  let sum = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    sum += lower === 'q' ? 9 : lower === 'r' ? 5 : lower === 'b' || lower === 'n' ? 3 : 0;
  }
  return sum;
}

/** Synthesized evaluation for a finished position (checkmate / draw). */
function terminalEval(chess: Chess): EvalOutcome {
  let cp = 0;
  if (chess.isCheckmate()) cp = chess.turn() === 'w' ? -30000 : 30000;
  return { lines: [{ cp, pvUci: [] }], bestUci: undefined, depth: 0, cancelled: false };
}

/** Was this ply a white move? Taken from the position, not from ply parity. */
function isWhiteMove(ply: PlyAnalysis): boolean {
  return ply.fenBefore.split(' ')[1] !== 'b';
}

function classifyPly(game: StoredGame, plyIdx: number, before: EvalOutcome, after: EvalOutcome): PlyAnalysis {
  const move = game.moves[plyIdx];
  const fenBefore = plyIdx === 0 ? game.startFen : game.moves[plyIdx - 1].fenAfter;
  const fenAfter = move.fenAfter;
  // Who moved? Read it from the position so games that start from a FEN
  // (black to move, or a mid-game setup) are attributed correctly.
  const moverIsWhite = fenBefore.split(' ')[1] !== 'b';

  const lines = before.lines;
  const bestLine = lines[0];
  const afterLine = after.lines[0];

  const chessBefore = new Chess(fenBefore);
  const legalMoveCount = chessBefore.moves().length;
  const isBook = plyIdx < BOOK_MAX_PLY && openingBook.isBookMove(fenBefore, move.uci);

  const beforeScoreMover = toMover(scoreOf(bestLine), moverIsWhite);
  const afterScoreMover = toMover(scoreOf(afterLine), moverIsWhite);
  const winBefore = scoreToWinPct(beforeScoreMover);
  const winAfter = scoreToWinPct(afterScoreMover);
  const winDrop = Math.max(0, winBefore - winAfter);

  let winAltBest: number | null = null;
  for (const line of lines.slice(1)) {
    if (line.pvUci[0] === move.uci) continue;
    const w = scoreToWinPct(toMover(scoreOf(line), moverIsWhite));
    if (winAltBest === null || w > winAltBest) winAltBest = w;
  }

  const playedIsBest = before.bestUci !== undefined && before.bestUci === move.uci;
  let offeredCp = 0;
  if (playedIsBest && legalMoveCount > 1 && !isBook) {
    // Sacrifice detection: real material conceded on the destination square
    // (trades and defended captures count as 0 — see concededMaterialCp).
    offeredCp = concededMaterialCp(fenBefore, fenAfter, move.to, moverIsWhite);
  }

  const result = classifyMove({
    legalMoveCount,
    isBook,
    playedUci: move.uci,
    bestUci: before.bestUci ?? bestLine?.pvUci[0],
    winBefore,
    winAfter,
    winAltBest,
    offeredCp,
    mateBefore: beforeScoreMover.mate,
  });

  const values = lines.map((l) => scoreToWinPct(toMover(scoreOf(l), moverIsWhite)));
  let volatility = 1;
  if (values.length > 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    volatility = Math.max(1, Math.sqrt(variance));
  }

  const bestUci = before.bestUci ?? bestLine?.pvUci[0];
  const pvSan = bestLine ? uciLineToSan(fenBefore, bestLine.pvUci) : [];
  const bestSan = bestLine?.pvUci[0] ? uciLineToSan(fenBefore, [bestLine.pvUci[0]])[0] : undefined;

  let caption: string | undefined;
  switch (result.label) {
    case 'Brilliant':
      caption = 'Brilliant sacrifice!';
      break;
    case 'Great':
      caption = 'The only good move.';
      break;
    case 'Miss':
      if (result.missedMate && beforeScoreMover.mate !== undefined && beforeScoreMover.mate > 0) {
        caption = `Missed a forced mate in ${beforeScoreMover.mate}.`;
      } else {
        caption = `Missed a winning chance — better was ${bestSan ?? 'the engine move'}.`;
      }
      break;
    case 'Mistake':
      caption = `Mistake — better was ${bestSan ?? 'the engine move'}.`;
      break;
    case 'Blunder':
      caption = `Blunder — better was ${bestSan ?? 'the engine move'}.`;
      break;
    default:
      break;
  }

  return {
    ply: plyIdx,
    san: move.san,
    uci: move.uci,
    clockMs: move.clockMs,
    fenBefore,
    fenAfter,
    label: result.label,
    excluded: result.excluded,
    cpBefore: bestLine?.cp,
    mateBefore: bestLine?.mate,
    cpAfter: afterLine?.cp,
    mateAfter: afterLine?.mate,
    winBefore,
    winAfter,
    winDrop,
    bestUci,
    bestSan,
    pvSan,
    lines,
    volatility,
    offeredCp,
    phase: 'middlegame', // patched after all plies are classified
    emptySearch: bestLine === undefined,
    caption,
  };
}

function buildPlayerStats(plies: PlyAnalysis[], isWhite: boolean): PlayerStats {
  const mine = plies.filter((p) => isWhiteMove(p) === isWhite);
  const counted = mine.filter((p) => !p.excluded);
  const accuracy =
    computeAccuracy(counted.map((p) => ({ winDrop: p.winDrop, weight: p.volatility ?? 1 }))) ?? 100;

  // A phase with nothing counted (all book/forced, or never reached) is a
  // perfect 100% — the review should never show an empty phase cell.
  const phaseAccuracy: Record<Phase, number | null> = { opening: null, middlegame: null, endgame: null };
  for (const phase of ['opening', 'middlegame', 'endgame'] as Phase[]) {
    const subset = counted.filter((p) => p.phase === phase);
    phaseAccuracy[phase] =
      computeAccuracy(subset.map((p) => ({ winDrop: p.winDrop, weight: p.volatility ?? 1 }))) ?? 100;
  }

  const counts = Object.fromEntries(ALL_LABELS.map((l) => [l, 0])) as Record<Label, number>;
  for (const p of mine) counts[p.label]++;

  return { accuracy, rating: estimateRating(accuracy), phaseAccuracy, counts };
}

export async function analyzeGame(game: StoredGame, opts: AnalyzeOptions): Promise<AnalysisData> {
  if (game.moves.length === 0) throw new Error('This game has no moves to analyse.');

  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const totalPositions = fens.length;
  const evals: EvalOutcome[] = [];
  const plies: PlyAnalysis[] = [];
  let maxDepth = 0;

  const status = await engineManager.status();
  if (!status.available) throw new Error(status.error ?? 'Stockfish is not available.');
  const engineName = status.name;

  for (let i = 0; i < fens.length; i++) {
    throwIfAborted(opts.signal);
    const fen = fens[i];
    const chess = new Chess(fen);

    let ev: EvalOutcome;
    if (chess.isGameOver()) {
      ev = terminalEval(chess);
    } else {
      ev = await engineManager.evalPosition(fen, { movetimeMs: opts.movetimeMs, multipv: opts.multipv });
      if (ev.cancelled) throw new AnalysisAbortedError();
      throwIfAborted(opts.signal);
      if (ev.lines.length === 0) {
        throw new Error(`The engine returned no evaluation for position ${i + 1}. Is Stockfish healthy?`);
      }
    }
    evals.push(ev);
    if (ev.depth > maxDepth && ev.depth < 200) maxDepth = ev.depth;

    if (i >= 1) {
      const ply = classifyPly(game, i - 1, evals[i - 1], evals[i]);
      plies.push(ply);
      opts.onProgress?.(i + 1, totalPositions, ply);
    } else {
      opts.onProgress?.(i + 1, totalPositions);
    }
  }

  // Phase assignment: opening lasts until the last book move (fallback: first N plies).
  const lastBookPly = plies.reduce((acc, p) => (p.label === 'Book' ? p.ply : acc), -1);
  for (const p of plies) {
    const inOpening = lastBookPly >= 0 ? p.ply <= lastBookPly : p.ply < OPENING_FALLBACK_PLIES;
    p.phase = inOpening ? 'opening' : nonPawnMaterial(p.fenBefore) <= 10 ? 'endgame' : 'middlegame';
  }

  const white = buildPlayerStats(plies, true);
  const black = buildPlayerStats(plies, false);

  const keyMoments: KeyMoment[] = plies
    .filter((p) => MOMENT_LABELS.has(p.label) && p.caption)
    .map((p) => ({ ply: p.ply, label: p.label, caption: p.caption as string, winSwing: p.winDrop }))
    .sort((a, b) => b.winSwing - a.winSwing)
    .slice(0, 10)
    .sort((a, b) => a.ply - b.ply);

  const opening = openingBook.openingFor(fens) ?? {
    eco: game.meta.eco,
    name: game.meta.opening,
  };

  return {
    movetimeMs: opts.movetimeMs,
    multipv: opts.multipv,
    engine: engineName,
    depthReached: maxDepth,
    createdAt: Date.now(),
    plies,
    white,
    black,
    keyMoments,
    opening: opening.eco || opening.name ? opening : undefined,
  };
}
