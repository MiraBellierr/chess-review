import { MOVETIME_STEPS } from '../types';
import { fmtMovetime } from '../util';

interface Props {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  id?: string;
}

export function DepthSlider({ value, onChange, disabled, id }: Props) {
  const nearestIdx = MOVETIME_STEPS.reduce(
    (best, step, i) => (Math.abs(step - value) < Math.abs(MOVETIME_STEPS[best] - value) ? i : best),
    0,
  );
  const label = fmtMovetime(value);
  return (
    <div className="depth-slider">
      <label className="muted" htmlFor={id ?? 'depth-slider'}>
        Fast
      </label>
      <input
        id={id ?? 'depth-slider'}
        type="range"
        min={0}
        max={MOVETIME_STEPS.length - 1}
        step={1}
        value={nearestIdx}
        disabled={disabled}
        aria-label="Search depth per position"
        onChange={(e) => onChange(MOVETIME_STEPS[Number(e.target.value)])}
      />
      <span className="muted">Deep</span>
      <span className="depth-value">{label}s/pos</span>
    </div>
  );
}
