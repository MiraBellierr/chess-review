import { LabelBadge } from './LabelBadge';
import type { AnalysisData, GameMeta, Label, PlayerStats } from '../types';
import { PHASE_LABELS, fmtAccuracy } from '../util';

interface Props {
  analysis: AnalysisData;
  meta: GameMeta;
}

/** The reading order of a game review: the marks of quality first, the errors after. */
const CLASS_ROWS: Label[] = [
  'Brilliant',
  'Great',
  'Book',
  'Best',
  'Excellent',
  'Good',
  'Inaccuracy',
  'Mistake',
  'Miss',
  'Blunder',
  'Forced',
];

const PHASES = ['opening', 'middlegame', 'endgame'] as const;

function PlayerHead({ side, name, elo }: { side: 'white' | 'black'; name: string; elo?: number }) {
  return (
    <th scope="col" className="sum-player">
      <span className="sr-only">{side === 'white' ? 'White:' : 'Black:'} </span>
      <span className="sum-name">
        <span className={`side-mark ${side}`} aria-hidden="true" />
        {name}
        {elo ? <span className="muted"> ({elo})</span> : null}
      </span>
    </th>
  );
}

function CountRow({ label, white, black }: { label: Label; white: PlayerStats; black: PlayerStats }) {
  return (
    <tr>
      <th scope="row" className="sum-label">
        {label}
      </th>
      <td className="sum-value num">{white.counts[label] ?? 0}</td>
      <td className="sum-icon">
        <LabelBadge label={label} size="sm" />
      </td>
      <td className="sum-value num">{black.counts[label] ?? 0}</td>
    </tr>
  );
}

function PhaseRow({
  phase,
  white,
  black,
  ruled,
}: {
  phase: (typeof PHASES)[number];
  white: PlayerStats;
  black: PlayerStats;
  ruled?: boolean;
}) {
  const cell = (stats: PlayerStats) => {
    // A phase with no counted moves (all book/forced, or never reached) is a
    // perfect 100% — the row is never left blank.
    const value = stats.phaseAccuracy[phase] ?? 100;
    return (
      <td className="sum-phase">
        <span className="phase-cell">
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${value}%` }} />
          </span>
          <span className="num">{fmtAccuracy(value)}</span>
        </span>
      </td>
    );
  };
  return (
    <tr className={ruled ? 'sum-rule' : undefined}>
      <th scope="row" className="sum-label">
        {PHASE_LABELS[phase]}
      </th>
      {cell(white)}
      <td className="sum-icon" />
      {cell(black)}
    </tr>
  );
}

export function SummaryCards({ analysis, meta }: Props) {
  const { white, black } = analysis;
  const opening =
    analysis.opening?.eco || analysis.opening?.name
      ? analysis.opening
      : meta.eco || meta.opening
        ? { eco: meta.eco, name: meta.opening }
        : undefined;
  return (
    <div className="card">
      <div className="sec">
        <h2>Summary</h2>
        {opening && (
          <span className="sec-note">
            {opening.eco ? `${opening.eco} ` : ''}
            {opening.name}
          </span>
        )}
      </div>

      <table className="sum-table">
        <colgroup>
          <col className="sum-col-label" />
          <col />
          <col className="sum-col-mark" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <td />
            <PlayerHead side="white" name={meta.white} elo={meta.whiteElo} />
            <td />
            <PlayerHead side="black" name={meta.black} elo={meta.blackElo} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="sum-label sum-label-strong">
              Accuracy
            </th>
            <td className="sum-value sum-acc">{fmtAccuracy(white.accuracy)}</td>
            <td className="sum-icon" />
            <td className="sum-value sum-acc">{fmtAccuracy(black.accuracy)}</td>
          </tr>

          {CLASS_ROWS.map((label) => (
            <CountRow key={label} label={label} white={white} black={black} />
          ))}

          <tr className="sum-block sum-rule">
            <th colSpan={4} scope="colgroup">
              Phase accuracy
            </th>
          </tr>
          {PHASES.map((phase) => (
            <PhaseRow key={phase} phase={phase} white={white} black={black} />
          ))}

          <tr className="sum-rule">
            <th scope="row" className="sum-label sum-label-strong">
              Game rating
            </th>
            <td className="sum-value num">~{white.rating}</td>
            <td className="sum-icon" />
            <td className="sum-value num">~{black.rating}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
