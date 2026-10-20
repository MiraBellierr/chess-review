/**
 * Move classification (the chess.com-style label set).
 *
 * All win% values passed in are from the MOVER's point of view (0..100).
 * Thresholds live in THRESHOLDS so they can be tuned against reference
 * games without touching the decision tree below.
 */
import type { Label } from '../types.js';

export const THRESHOLDS = {
  /** Win% drop upper bounds for the "not a mistake" buckets. */
  excellentMaxDrop: 2,
  goodMaxDrop: 4,
  inaccuracyMaxDrop: 8,
  mistakeMaxDrop: 16, // above this => Blunder

  /** Great: the best move must be at least this much better (win%) than the best alternative. */
  greatGapWin: 12,
  /** ...and the position shouldn't be decided already. */
  greatMaxWinBefore: 92,

  /** Brilliant gates. */
  brilliantMinWinBefore: 8, // don't praise sacrifices in hopeless positions
  brilliantMaxWinBefore: 85, // ...or in totally winning ones
  brilliantMinWinAfter: 0, // after the sacrifice the mover must still be OK
  brilliantMinOfferedCp: 100, // at least a pawn of material genuinely conceded

  /** Miss: was winning, then wasn't. */
  missWinBefore: 62,
  missWinAfter: 50,
  missMateWinAfter: 97, // "missed a forced mate" if win% drops below this
};

export interface ClassifyInput {
  legalMoveCount: number;
  isBook: boolean;
  playedUci: string;
  bestUci?: string;
  /** Win% before the move, mover POV. */
  winBefore: number;
  /** Win% after the move, mover POV. */
  winAfter: number;
  /** Best win% among candidate lines that are NOT the played move (mover POV). */
  winAltBest: number | null;
  /** Material (cp) the mover genuinely concedes with this move. */
  offeredCp: number;
  /** Mate-in-N for the mover before the move (positive = mover mates). */
  mateBefore?: number;
}

export interface ClassifyResult {
  label: Label;
  excluded: boolean;
  missedMate: boolean;
}

export function classifyMove(input: ClassifyInput): ClassifyResult {
  const winDrop = Math.max(0, input.winBefore - input.winAfter);

  if (input.legalMoveCount === 1) {
    return { label: 'Forced', excluded: true, missedMate: false };
  }
  if (input.isBook) {
    return { label: 'Book', excluded: true, missedMate: false };
  }

  const playedIsBest = input.bestUci !== undefined && input.playedUci === input.bestUci;

  if (playedIsBest) {
    if (
      input.offeredCp >= THRESHOLDS.brilliantMinOfferedCp &&
      input.winBefore >= THRESHOLDS.brilliantMinWinBefore &&
      input.winBefore <= THRESHOLDS.brilliantMaxWinBefore &&
      input.winAfter >= THRESHOLDS.brilliantMinWinAfter
    ) {
      return { label: 'Brilliant', excluded: false, missedMate: false };
    }
    if (
      input.winAltBest !== null &&
      input.winBefore - input.winAltBest >= THRESHOLDS.greatGapWin &&
      input.winBefore <= THRESHOLDS.greatMaxWinBefore
    ) {
      return { label: 'Great', excluded: false, missedMate: false };
    }
    return { label: 'Best', excluded: false, missedMate: false };
  }

  const missedMate = input.mateBefore !== undefined && input.mateBefore > 0;
  if (
    (input.winBefore >= THRESHOLDS.missWinBefore && input.winAfter <= THRESHOLDS.missWinAfter) ||
    (missedMate && input.winAfter < THRESHOLDS.missMateWinAfter)
  ) {
    return { label: 'Miss', excluded: false, missedMate };
  }

  if (winDrop <= THRESHOLDS.excellentMaxDrop) return { label: 'Excellent', excluded: false, missedMate };
  if (winDrop <= THRESHOLDS.goodMaxDrop) return { label: 'Good', excluded: false, missedMate };
  if (winDrop <= THRESHOLDS.inaccuracyMaxDrop) return { label: 'Inaccuracy', excluded: false, missedMate };
  if (winDrop <= THRESHOLDS.mistakeMaxDrop) return { label: 'Mistake', excluded: false, missedMate };
  return { label: 'Blunder', excluded: false, missedMate };
}
