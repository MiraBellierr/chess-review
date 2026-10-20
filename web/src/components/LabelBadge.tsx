import { CLASSIFICATION_ICONS } from '../assets/classifications';
import { LABEL_META } from '../util';
import type { Label } from '../types';

/**
 * A move's label is a vendored classification badge (WintrChess set, GPL-3.0):
 * the art carries its own circle, tone and gloss. The tooltip and aria-label
 * always spell the label out, so the pictogram is never the only signal.
 */
export function LabelBadge({ label, size = 'md' }: { label: Label; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`badge badge-${size}`} role="img" aria-label={label} title={LABEL_META[label].title}>
      <img className="badge-img" src={CLASSIFICATION_ICONS[label]} alt="" draggable={false} />
    </span>
  );
}
