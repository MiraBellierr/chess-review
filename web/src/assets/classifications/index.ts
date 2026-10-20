import type { Label } from '../../types';

import best from './best.png';
import blunder from './blunder.png';
import brilliant from './brilliant.png';
import critical from './critical.png';
import excellent from './excellent.png';
import forced from './forced.png';
import inaccuracy from './inaccuracy.png';
import miss from './miss.png';
import mistake from './mistake.png';
import okay from './okay.png';
import theory from './theory.png';

/**
 * Move-class badge art, vendored byte-for-byte from WintrChess
 * (github.com/WintrCat/wintrchess, GPL-3.0 — see `CREDITS.md` for the
 * licence note). File names are upstream's; the map below bridges their
 * vocabulary to ours:
 *
 * - their `critical` is the blue "!" standing in for Great (their set has no
 *   "great" class),
 * - their `okay` is our Good,
 * - their `theory` is our Book.
 *
 * Upstream files left untaken: `error`, `risky`, `loading` (no counterpart
 * class here).
 */
export const CLASSIFICATION_ICONS: Record<Label, string> = {
  Brilliant: brilliant,
  Great: critical,
  Best: best,
  Excellent: excellent,
  Good: okay,
  Book: theory,
  Inaccuracy: inaccuracy,
  Mistake: mistake,
  Miss: miss,
  Blunder: blunder,
  Forced: forced,
};
