import { useEffect, useRef } from 'react';
import { LabelBadge } from './LabelBadge';
import type { MoveRecord, PlyAnalysis } from '../types';
import type { AltMove } from '../altLine';
import { fmtAccuracy, fmtClock, moverIsWhite } from '../util';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The line played on the board while exploring — page-only, never stored. */
export interface AltLineView {
  /** Position the line branched from, for move numbering. */
  baseFen: string;
  moves: AltMove[];
  /** How many of the moves are on the board (0 = back at the branch point). */
  cursor: number;
  /** Blended accuracy of the line, once moves have been judged. */
  accuracy: number | null;
  /** Show the position after move `index` (`-1` = the branch point). */
  onSelect: (index: number) => void;
}

interface Props {
  plies: PlyAnalysis[];
  moves: MoveRecord[];
  startFen: string;
  selected: number;
  onSelect: (ply: number) => void;
  streaming?: boolean;
  alt?: AltLineView;
}

export function MoveList({ plies, moves, startFen, selected, onSelect, streaming, alt }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const showClocks = moves.some((m) => m.clockMs !== undefined);

  // Keep the position being walked in view: the explored line's cursor when it
  // has one on screen, the game's selection otherwise.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = wrap.querySelector('.alt-line .sel') ?? wrap.querySelector('.sel');
    target?.scrollIntoView({ block: 'nearest' });
  }, [selected, alt?.cursor]);

  // Games can start from a FEN (black to move), so pair the columns by looking
  // at the starting position instead of assuming white moves first.
  const whiteFirst = moverIsWhite(startFen || START_FEN);
  const firstNo = Number((startFen || START_FEN).split(' ')[5]) || 1;
  const rows = Math.ceil(moves.length / 2);

  const cell = (plyIndex: number) => {
    const move = moves[plyIndex];
    if (!move) return <td />;
    const analyzed = plies[plyIndex];
    const isSel = selected === plyIndex + 1;
    return (
      <td className={isSel ? 'sel' : ''} onClick={() => onSelect(plyIndex + 1)}>
        {analyzed ? <LabelBadge label={analyzed.label} /> : streaming ? <span className="pending-dot" /> : null}
        <span className="mv-san">{move.san}</span>
        {showClocks && <span className="mv-clock">{fmtClock(move.clockMs)}</span>}
      </td>
    );
  };

  // The explored line reads like the game's score, only with the accuracy of
  // each move printed next to it instead of a clock. It branches wherever the
  // board was, so each move is filed under the side that actually played it —
  // a line starting on Black's move opens with a gap.
  const altRows: Array<{ no: number; white: number | null; black: number | null }> = [];
  if (alt) {
    let side = moverIsWhite(alt.baseFen);
    let no = Number(alt.baseFen.split(' ')[5]) || 1;
    alt.moves.forEach((_, i) => {
      if (altRows.length === 0 || altRows[altRows.length - 1].black !== null) {
        altRows.push({ no, white: null, black: null });
      }
      const row = altRows[altRows.length - 1];
      if (side) row.white = i;
      else {
        row.black = i;
        no += 1;
      }
      side = !side;
    });
  }

  const altCell = (index: number | null) => {
    const move = index === null || !alt ? undefined : alt.moves[index];
    if (!alt || !move || index === null) return <td />;
    const isSel = alt.cursor === index + 1;
    return (
      <td className={isSel ? 'sel' : ''} onClick={() => alt.onSelect(index)}>
        {move.label ? <LabelBadge label={move.label} /> : <span className="pending-dot" />}
        <span className="mv-san">{move.san}</span>
        {move.accuracy !== undefined && <span className="mv-acc">{fmtAccuracy(move.accuracy)}</span>}
      </td>
    );
  };

  return (
    <div className="moves-scroll" ref={wrapRef}>
      <table className="score">
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td style={{ width: 40 }}>
                <span className="mv-no">{firstNo + i}.</span>
              </td>
              {cell(whiteFirst ? i * 2 : i * 2 + 1)}
              {cell(whiteFirst ? i * 2 + 1 : i * 2)}
            </tr>
          ))}
        </tbody>
      </table>

      {alt && alt.moves.length > 0 && (
        <div className="alt-line">
          <div className="alt-head">
            <span className="alt-title">Alternative line</span>
            <span className="alt-note">on the board — not saved</span>
            {alt.cursor > 0 && (
              <button
                className="alt-back"
                title="Back to the position the line branched from"
                onClick={() => alt.onSelect(-1)}
              >
                ↩ start
              </button>
            )}
            {alt.accuracy !== null && <span className="alt-acc">{fmtAccuracy(alt.accuracy)} line</span>}
          </div>
          <table className="score">
            <tbody>
              {altRows.map((row, i) => (
                <tr key={i}>
                  <td style={{ width: 40 }}>
                    <span className="mv-no">{row.no}.</span>
                  </td>
                  {row.white === null ? (
                    <td className="mv-gap">{row.black === null ? '' : '…'}</td>
                  ) : (
                    altCell(row.white)
                  )}
                  {altCell(row.black)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
