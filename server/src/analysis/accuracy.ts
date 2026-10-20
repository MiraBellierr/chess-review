/**
 * Accuracy + rating estimation.
 *
 * The win-probability model and the per-move accuracy curve are the
 * well-documented open-source equivalents of what chess.com approximates
 * (they publish the same logistic win% idea in their blog posts).
 */

/**
 * Win% losses below this are search noise between independently evaluated
 * positions, not player error. The floor sits well under the Inaccuracy
 * threshold (4), so every counted mistake still costs accuracy; only a game
 * whose losses are all inside the noise band may read a perfect 100%.
 */
const WIN_DROP_FLOOR = 1.0;

/** Logistic centipawn -> win-percentage model (0..100). */
export function cpToWinPct(cp: number): number {
  const k = 0.00368208;
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

export function scoreToWinPct(score: { cp?: number; mate?: number }): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  if (score.cp !== undefined) return cpToWinPct(Math.max(-20000, Math.min(20000, score.cp)));
  return 50;
}

/** Per-move accuracy from how much win% the player gave away. */
export function moveAccuracyPct(winDrop: number): number {
  const clamped = Math.max(0, winDrop);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * clamped) - 3.1669));
}

export interface AccuracyItem {
  winDrop: number;
  weight: number;
}

/**
 * Game accuracy: weighted mean of per-move accuracies blended with the
 * weighted harmonic mean (punishes repeated mistakes). There is no
 * calibration lift on top: a game with real errors must never be rounded up
 * to a perfect score, so only noise-level losses can read 100%.
 */
export function computeAccuracy(items: AccuracyItem[]): number | null {
  if (items.length === 0) return null;
  let weightSum = 0;
  let weightedAcc = 0;
  let harmonicDen = 0;
  for (const item of items) {
    const acc = moveAccuracyPct(Math.max(0, item.winDrop - WIN_DROP_FLOOR));
    const w = Math.max(0.25, item.weight);
    weightSum += w;
    weightedAcc += acc * w;
    harmonicDen += w / Math.max(acc, 0.01);
  }
  const mean = weightedAcc / weightSum;
  const harmonic = weightSum / harmonicDen;
  const blended = 0.5 * mean + 0.5 * harmonic;
  return Math.min(100, blended);
}

/**
 * Accuracy -> estimated game rating (Elo), tuned to feel like chess.com's
 * "Game Rating" across common accuracy ranges. Piecewise linear by design:
 * easy to re-anchor after comparing against reference reviews.
 */
const RATING_ANCHORS: [number, number][] = [
  [10, 100],
  [30, 250],
  [40, 450],
  [50, 700],
  [60, 1000],
  [65, 1150],
  [70, 1350],
  [75, 1550],
  [80, 1780],
  [85, 2020],
  [90, 2290],
  [95, 2580],
  [100, 2900],
];

export function estimateRating(accuracy: number): number {
  const a = Math.max(0, Math.min(100, accuracy));
  for (let i = 0; i < RATING_ANCHORS.length - 1; i++) {
    const [a0, r0] = RATING_ANCHORS[i];
    const [a1, r1] = RATING_ANCHORS[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return Math.round((r0 + t * (r1 - r0)) / 10) * 10;
    }
  }
  return a <= 10 ? 100 : 2900;
}
