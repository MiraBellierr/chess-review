import { useMemo } from 'react';
import type { KeyMoment, PlyAnalysis } from '../types';
import { LABEL_META, moveNo, whitePovWin } from '../util';

interface Props {
  plies: PlyAnalysis[];
  totalMoves: number;
  selected: number;
  onSelect: (ply: number) => void;
  keyMoments: KeyMoment[];
}

/** The game's evaluation as a printed chart: parchment ground, ink line,
 *  key moments marked on it. Click or tap anywhere to jump to that move. */
export function EvalGraph({ plies, totalMoves, selected, onSelect, keyMoments }: Props) {
  const points = useMemo(() => {
    if (totalMoves === 0) return [] as { x: number; y: number }[];
    const first = plies[0];
    const arr: { x: number; y: number }[] = [
      { x: 0, y: first ? whitePovWin(first.winBefore, first.fenBefore) : 50 },
    ];
    for (let i = 0; i < Math.min(totalMoves, plies.length); i++) {
      arr.push({ x: i + 1, y: whitePovWin(plies[i].winAfter, plies[i].fenBefore) });
    }
    return arr;
  }, [plies, totalMoves]);

  if (totalMoves === 0) return null;

  const W = totalMoves;
  const lastX = points[points.length - 1]?.x ?? 0;
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${100 - p.y}`).join(' ');
  const areaD = `M 0 100 ${points.map((p) => `L ${p.x} ${100 - p.y}`).join(' ')} L ${lastX} 100 Z`;

  return (
    <div className="card">
      <div className="sec">
        <h2>Evaluation</h2>
        <span className="sec-note">White advantage upwards · click to jump</span>
      </div>
      <div
        className="graph-wrap"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          onSelect(Math.max(0, Math.min(totalMoves, Math.round(frac * totalMoves))));
        }}
      >
        <svg className="graph-svg" viewBox={`0 0 ${Math.max(1, W)} 100`} preserveAspectRatio="none" aria-hidden="true">
          <line x1={0} y1={25} x2={W} y2={25} stroke="rgba(31,41,51,0.14)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={75} x2={W} y2={75} stroke="rgba(31,41,51,0.14)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          {points.length >= 2 && (
            <>
              <path d={areaD} fill="rgba(180, 83, 9, 0.10)" />
              <path d={lineD} fill="none" stroke="#1f2933" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
            </>
          )}
          <line
            x1={0}
            y1={50}
            x2={W}
            y2={50}
            stroke="rgba(31,41,51,0.4)"
            strokeWidth={0.8}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {keyMoments.map((m) => {
          const pa = plies[m.ply];
          if (!pa) return null;
          const title = `${moveNo(m.ply, pa.fenBefore)} ${pa.san} — ${LABEL_META[m.label].title}`;
          return (
            <button
              type="button"
              key={`${m.ply}-${m.label}`}
              className="graph-marker"
              style={{
                left: `${((m.ply + 1) / W) * 100}%`,
                top: `${100 - whitePovWin(pa.winAfter, pa.fenBefore)}%`,
              }}
              title={title}
              aria-label={title}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(m.ply + 1);
              }}
            />
          );
        })}

        <div className="graph-cursor" style={{ left: `${(selected / W) * 100}%` }} />
      </div>
    </div>
  );
}
