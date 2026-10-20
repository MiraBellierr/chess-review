import { LabelBadge } from './LabelBadge';
import type { KeyMoment, PlyAnalysis } from '../types';
import { moveNo } from '../util';

interface Props {
  moments: KeyMoment[];
  plies: PlyAnalysis[];
  selected: number;
  onSelect: (ply: number) => void;
}

/**
 * Key moments read like an annotated scorebook's notes: the move and its
 * symbol on one line, the coach's caption set in serif beneath it.
 */
export function KeyMoments({ moments, plies, selected, onSelect }: Props) {
  return (
    <div className="card">
      <div className="sec">
        <h2>Key moments</h2>
        {moments.length > 0 && <span className="sec-note">{moments.length}</span>}
      </div>
      {moments.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No big swings detected — a clean game.
        </p>
      ) : (
        <div className="moments">
          {moments.map((moment) => {
            const pa = plies[moment.ply];
            const isSel = selected === moment.ply + 1;
            return (
              <button
                className={`moment${isSel ? ' sel' : ''}`}
                key={`${moment.ply}-${moment.label}`}
                onClick={() => onSelect(moment.ply + 1)}
              >
                <span className="moment-line">
                  <LabelBadge label={moment.label} />
                  <span className="moment-move">
                    {moveNo(moment.ply, pa?.fenBefore)} {pa?.san ?? ''}
                  </span>
                </span>
                <span className="moment-caption">{moment.caption}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
