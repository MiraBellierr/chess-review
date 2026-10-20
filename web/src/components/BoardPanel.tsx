import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Icon } from './Icons';
import { LabelBadge } from './LabelBadge';
import type { Label } from '../types';

export interface EngineLineView {
  score: string;
  san: string[];
}

/** What the figure caption prints under the board. */
export interface FigureInfo {
  /** "24…Nf6", or "Starting position" before the first move. */
  move: string;
  label?: Label;
  /** Mover's win% before → after, e.g. "win 62% → 48%". */
  swing?: string;
  /** Engine-proven caption, printed like a book annotation. */
  note?: string;
}

interface Props {
  fen: string;
  flipped: boolean;
  onFlip: () => void;
  /** True while the board shows an explored line — the engine panel under the board. */
  exploring: boolean;
  onToggleExplore: () => void;
  /** Plays a move on the board. Returns whether the move was legal. */
  onUserMove: (from: string, to: string, promotion?: string) => boolean;
  arrows: string[][];
  squareStyles: Record<string, CSSProperties>;
  showArrows: boolean;
  onToggleArrows: () => void;
  winPct: number | null;
  evalText: string;
  engineLines: EngineLineView[] | null;
  engineLoading?: boolean;
  engineError?: string;
  ply: number;
  totalPlies: number;
  onNavigate: (ply: number) => void;
  figure: FigureInfo;
  /** Destination square of the move on screen — the badge anchor. */
  destSquare?: string;
}

/** The promotion dialog hands the piece back as "wQ"; chess.js wants "q". */
function promotionFromPiece(piece?: string): string | undefined {
  const letter = piece?.[1]?.toLowerCase();
  return letter && 'qrbn'.includes(letter) ? letter : undefined;
}

export function BoardPanel({
  fen,
  flipped,
  onFlip,
  exploring,
  onToggleExplore,
  onUserMove,
  arrows,
  squareStyles,
  showArrows,
  onToggleArrows,
  winPct,
  evalText,
  engineLines,
  engineLoading,
  engineError,
  ply,
  totalPlies,
  onNavigate,
  figure,
  destSquare,
}: Props) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';

  // A selection only means something in the position on screen.
  useEffect(() => setSelectedSquare(null), [fen]);

  const styles: Record<string, CSSProperties> = { ...squareStyles };
  if (selectedSquare) {
    styles[selectedSquare] = {
      ...(styles[selectedSquare] ?? {}),
      backgroundColor: 'var(--hl-select)',
      boxShadow: 'inset 0 0 0 2px var(--accent-deep)',
      borderRadius: 4,
    };
  }

  // The dark fill carries Black's share of the bar and White's share stays bare
  // parchment — the same hollow-versus-solid reading as the pieces and plates.
  const blackShare = 100 - Math.max(0, Math.min(100, winPct ?? 50));

  // Click-click moving: the first click picks up a piece of the side to move,
  // the second plays it — or re-aims at another of your own pieces.
  const handleSquareClick = (square: string, piece?: string) => {
    const own = !!piece && piece[0] === sideToMove;
    if (!selectedSquare) {
      if (own) setSelectedSquare(square);
      return;
    }
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }
    if (onUserMove(selectedSquare, square)) {
      setSelectedSquare(null);
      return;
    }
    setSelectedSquare(own ? square : null);
  };

  const handleDrop = (from: string, to: string, piece: string) => {
    setSelectedSquare(null);
    return onUserMove(from, to, promotionFromPiece(piece));
  };

  // Anchor for the label badge: the destination square's top-right corner,
  // mirrored when the board is flipped.
  const badgePos = useMemo(() => {
    if (!destSquare) return null;
    const file = destSquare.charCodeAt(0) - 97;
    const rank = Number(destSquare[1]) - 1;
    let col = file;
    let row = 7 - rank;
    if (flipped) {
      col = 7 - col;
      row = 7 - row;
    }
    return {
      left: `${(col + 1) * 12.5}%`,
      top: `${row * 12.5}%`,
    };
  }, [destSquare, flipped]);

  return (
    <figure className="board-figure">
      <div className="board-row">
        <div className="eval-bar" style={{ flexDirection: flipped ? 'column-reverse' : 'column' }}>
          <div className="eval-bar-clip">
            <div className="eval-bar-fill" style={{ height: `${blackShare}%` }} />
          </div>
          <span className="eval-bar-text">{evalText}</span>
        </div>

        <div className="board-holder">
          <div className="board-frame">
            <Chessboard
              id="review-board"
              position={fen}
              boardOrientation={flipped ? 'black' : 'white'}
              arePiecesDraggable
              isDraggablePiece={({ piece }) => piece[0] === sideToMove}
              onPieceDrop={handleDrop}
              onSquareClick={handleSquareClick}
              // clicks on a piece never reach onSquareClick — the piece
              // swallows them — so both routes run the same picker.
              onPieceClick={(piece, square) => handleSquareClick(square, piece)}
              customArrows={arrows as never}
              customArrowColor="#b45309"
              customSquareStyles={styles}
              customLightSquareStyle={{ backgroundColor: 'var(--sq-light)' }}
              customDarkSquareStyle={{ backgroundColor: 'var(--sq-dark)' }}
              customNotationStyle={{ color: 'var(--notation-ink)', fontSize: '11px', fontWeight: '600' }}
              animationDuration={160}
              areArrowsAllowed
            />
          </div>
          {badgePos && figure.label && (
            <span
              className="board-badge"
              style={{ ...badgePos, transform: 'translate(calc(-100% - 3px), 3px)' }}
              aria-hidden="true"
            >
              <LabelBadge label={figure.label} size="sm" />
            </span>
          )}
        </div>
      </div>

      <figcaption className="board-caption" aria-live="polite">
        <span className="fig-move">{figure.move}</span>
        {figure.label && <LabelBadge label={figure.label} size="sm" />}
        {figure.swing && <span className="fig-swing">{figure.swing}</span>}
        {figure.note && <span className="fig-note">{figure.note}</span>}
      </figcaption>

      <div className="controls">
        <button className="ctrl-btn" title="First position (Home)" aria-label="First position" onClick={() => onNavigate(0)}>
          <Icon name="start" size={18} />
        </button>
        <button className="ctrl-btn" title="Previous move (←)" aria-label="Previous move" onClick={() => onNavigate(ply - 1)}>
          <Icon name="prev" size={18} />
        </button>
        <button className="ctrl-btn" title="Next move (→)" aria-label="Next move" onClick={() => onNavigate(ply + 1)}>
          <Icon name="next" size={18} />
        </button>
        <button className="ctrl-btn" title="Final position (End)" aria-label="Final position" onClick={() => onNavigate(totalPlies)}>
          <Icon name="end" size={18} />
        </button>
        <button className="ctrl-btn" title="Flip board" aria-label="Flip board" onClick={onFlip}>
          <Icon name="flip" size={18} />
        </button>
        <button
          className={`ctrl-btn ${showArrows ? 'on' : ''}`}
          title={showArrows ? 'Hide the engine’s move' : 'Show the engine’s move'}
          aria-pressed={showArrows}
          aria-label="Show or hide the engine's move"
          onClick={onToggleArrows}
        >
          <Icon name="arrow" size={18} />
        </button>
        <button
          className={`ctrl-btn ${exploring ? 'on' : ''}`}
          title={
            exploring
              ? 'Leave the explored line and return to the game'
              : 'Explore — the engine evaluates your moves from here'
          }
          aria-pressed={exploring}
          aria-label="Explore mode"
          onClick={onToggleExplore}
        >
          <Icon name="explore" size={18} />
        </button>
        <span className="spacer" />
        <span className="ply-count">
          {ply}/{totalPlies}
        </span>
      </div>

      {exploring && (
        <div className="engine-lines">
          {engineLoading && !engineLines?.length && <div className="muted">Thinking…</div>}
          {!engineLoading &&
            engineLines &&
            engineLines.length > 0 &&
            engineLines.map((line, i) => (
              <div className="engine-line" key={i}>
                <span className="score">{line.score}</span>
                <span className="san">{line.san.join(' ')}</span>
              </div>
            ))}
          {!engineLoading && (!engineLines || engineLines.length === 0) && (
            <div className="muted">
              {engineError ?? 'Move a piece — the engine evaluates the position instantly. Right-click-drag to draw arrows.'}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
