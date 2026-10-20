/**
 * Judging the moves played on the board while exploring.
 *
 * The evals come from the same `/api/eval` search the eval bar uses, and the
 * maths mirrors server/src/analysis/{accuracy,classify}.ts so an explored
 * move's accuracy reads on the same scale as the stored review. Two labels are
 * out of reach here and are never claimed: Book needs the server's opening
 * table, Brilliant needs a static exchange evaluation of the sacrifice.
 *
 * Nothing in this file touches the server: an explored line lives only in the
 * page, and is thrown away with it.
 */
import { Chess } from 'chess.js';
import type { EngineLine, EvalOutcome, Label } from './types';
import { moveAccuracyPct, moverIsWhite, winFromScore } from './util';

/** Mirrors server/src/analysis/classify.ts — keep the thresholds in sync. */
const THRESHOLDS = {
  excellentMaxDrop: 2,
  goodMaxDrop: 4,
  inaccuracyMaxDrop: 8,
  mistakeMaxDrop: 16, // above this => Blunder
  greatGapWin: 12,
  greatMaxWinBefore: 92,
  missWinBefore: 62,
  missWinAfter: 50,
  missMateWinAfter: 97,
};

export interface AltMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  /** Eval of the position before the move, white POV — null until it lands. */
  beforeEval: EvalOutcome | null;
  /** Eval of the position after the move, white POV — null until it lands. */
  afterEval: EvalOutcome | null;
  /** Everything below is filled in by deriveAltMove() once both evals are in. */
  winBefore?: number;
  winAfter?: number;
  winDrop?: number;
  accuracy?: number;
  label?: Label;
}

/** Win% of a white-POV engine line, read from the mover's side. */
function moverWin(line: EngineLine | undefined, isWhite: boolean): number {
  if (!line) return 50;
  return winFromScore(
    isWhite
      ? { cp: line.cp, mate: line.mate }
      : {
          cp: line.cp !== undefined ? -line.cp : undefined,
          mate: line.mate !== undefined ? -line.mate : undefined,
        },
  );
}

function classifyAltMove(input: {
  legalMoves: number;
  playedIsBest: boolean;
  winBefore: number;
  winAfter: number;
  /** Best win% among the other candidate lines, mover POV. */
  winAltBest: number | null;
  /** Mate-in-N available before the move (mover positive). */
  mateBefore?: number;
}): Label {
  const winDrop = Math.max(0, input.winBefore - input.winAfter);

  if (input.legalMoves === 1) return 'Forced';
  if (input.playedIsBest) {
    if (
      input.winAltBest !== null &&
      input.winBefore - input.winAltBest >= THRESHOLDS.greatGapWin &&
      input.winBefore <= THRESHOLDS.greatMaxWinBefore
    ) {
      return 'Great';
    }
    return 'Best';
  }

  const missedMate = input.mateBefore !== undefined && input.mateBefore > 0;
  if (
    (input.winBefore >= THRESHOLDS.missWinBefore && input.winAfter <= THRESHOLDS.missWinAfter) ||
    (missedMate && input.winAfter < THRESHOLDS.missMateWinAfter)
  ) {
    return 'Miss';
  }

  if (winDrop <= THRESHOLDS.excellentMaxDrop) return 'Excellent';
  if (winDrop <= THRESHOLDS.goodMaxDrop) return 'Good';
  if (winDrop <= THRESHOLDS.inaccuracyMaxDrop) return 'Inaccuracy';
  if (winDrop <= THRESHOLDS.mistakeMaxDrop) return 'Mistake';
  return 'Blunder';
}

/** Fills in the win% / accuracy / label of a move once both of its evals are in. */
export function deriveAltMove(move: AltMove): AltMove {
  const { beforeEval, afterEval } = move;
  if (!beforeEval || !afterEval) return move;

  const isWhite = moverIsWhite(move.fenBefore);
  const bestLine = beforeEval.lines[0];
  const winBefore = moverWin(bestLine, isWhite);
  // A move that ends the game leaves the engine with no lines to send, so the
  // board settles it: mate is a win, a drawn position is a draw.
  const after = new Chess(move.fenAfter);
  let winAfter: number;
  if (after.isCheckmate()) winAfter = 100;
  else if (after.isDraw()) winAfter = 50;
  else winAfter = moverWin(afterEval.lines[0], isWhite);

  let winAltBest: number | null = null;
  for (const line of beforeEval.lines.slice(1)) {
    if (line.pvUci[0] === move.uci) continue;
    const win = moverWin(line, isWhite);
    if (winAltBest === null || win > winAltBest) winAltBest = win;
  }

  const mateBefore = bestLine?.mate !== undefined ? (isWhite ? bestLine.mate : -bestLine.mate) : undefined;
  const label = classifyAltMove({
    legalMoves: new Chess(move.fenBefore).moves().length,
    playedIsBest: (beforeEval.bestUci ?? bestLine?.pvUci[0]) === move.uci,
    winBefore,
    winAfter,
    winAltBest,
    mateBefore,
  });

  return {
    ...move,
    winBefore,
    winAfter,
    winDrop: Math.max(0, winBefore - winAfter),
    label,
    accuracy: moveAccuracyPct(winBefore - winAfter),
  };
}

/** MultiPV spread before the move — the server weights counted moves by it too. */
function volatility(move: AltMove): number {
  const lines = move.beforeEval?.lines ?? [];
  if (lines.length < 2) return 1;
  const isWhite = moverIsWhite(move.fenBefore);
  const values = lines.map((line) => moverWin(line, isWhite));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Accuracy of the whole explored line: the server's weighted mean↔harmonic
 * blend, over the moves it would count (forced moves are excluded like they
 * are in a game review). Null until at least one move has been judged.
 */
export function altLineAccuracy(moves: AltMove[]): number | null {
  const counted = moves.filter((m) => m.accuracy !== undefined && m.label !== undefined && m.label !== 'Forced');
  if (counted.length === 0) return null;

  let weightSum = 0;
  let weighted = 0;
  let harmonicDen = 0;
  for (const move of counted) {
    const weight = Math.max(0.25, volatility(move));
    const accuracy = Math.max(move.accuracy as number, 0.01);
    weightSum += weight;
    weighted += accuracy * weight;
    harmonicDen += weight / accuracy;
  }
  return Math.min(100, 0.5 * (weighted / weightSum) + 0.5 * (weightSum / harmonicDen));
}
