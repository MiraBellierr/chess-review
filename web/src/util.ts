import { Chess } from 'chess.js';
import type { Label, Phase } from './types';

export const LABEL_META: Record<Label, { title: string }> = {
  Brilliant: { title: 'Brilliant — best move with a sacrifice' },
  Great: { title: 'Great — the only good move' },
  Best: { title: 'Best — matches the engine' },
  Excellent: { title: 'Excellent' },
  Good: { title: 'Good' },
  Book: { title: 'Book — known opening theory' },
  Inaccuracy: { title: 'Inaccuracy' },
  Mistake: { title: 'Mistake' },
  Miss: { title: 'Miss — missed a big chance' },
  Blunder: { title: 'Blunder' },
  Forced: { title: 'Forced — only one legal move' },
};

export const PHASE_LABELS: Record<Phase, string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

export function cpToWinPct(cp: number): number {
  const k = 0.00368208;
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

/**
 * Win% losses below this are search noise between independently evaluated
 * positions, not player error (mirrors server/src/analysis/accuracy.ts).
 */
const WIN_DROP_FLOOR = 1.0;

/**
 * Per-move accuracy from how much win% the mover gave away — the same curve
 * and noise floor the server's game accuracy uses, so an explored move's
 * number reads on the same scale as the stored review.
 */
export function moveAccuracyPct(winDrop: number): number {
  const counted = Math.max(0, winDrop - WIN_DROP_FLOOR);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * counted) - 3.1669));
}

export function winFromScore(score: { cp?: number; mate?: number }): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  if (score.cp !== undefined) return cpToWinPct(Math.max(-20000, Math.min(20000, score.cp)));
  return 50;
}

/** White-POV eval text: "+1.24", "-0.80", "+M3", "-M5", "+#". */
export function scoreText(cp?: number, mate?: number): string {
  if (mate !== undefined) return mate > 0 ? `+M${mate}` : `-M${Math.abs(mate)}`;
  if (cp === undefined) return '?';
  if (Math.abs(cp) >= 20000) return cp > 0 ? '+#' : '-#';
  const v = cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Is the side to move in this position white? */
export function moverIsWhite(fen: string): boolean {
  return fen.split(' ')[1] !== 'b';
}

/**
 * Stored win% values are from the mover's point of view; the eval bar and graph
 * want white's point of view, so flip them for black's moves.
 */
export function whitePovWin(win: number, fenBefore: string): number {
  return moverIsWhite(fenBefore) ? win : 100 - win;
}

export function fmtAccuracy(a?: number | null): string {
  if (a === undefined || a === null) return '—';
  return `${a.toFixed(1)}%`;
}

export function fmtClock(ms?: number): string {
  if (ms === undefined) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "3." for a white move, "3…" for a black one. Prefers the FEN's move number when given. */
export function moveNo(ply: number, fenBefore?: string): string {
  const parts = fenBefore?.split(' ');
  const num = parts?.[5] ? Number(parts[5]) : Math.floor(ply / 2) + 1;
  const white = parts?.[1] ? parts[1] !== 'b' : ply % 2 === 0;
  return white ? `${num}.` : `${num}…`;
}

export function uciLineToSan(fen: string, ucis: string[]): string[] {
  const out: string[] = [];
  try {
    const chess = new Chess(fen);
    for (const uci of ucis) {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      });
      out.push(move.san);
    }
  } catch {
    /* stop at illegal move */
  }
  return out;
}

export function arrowsFromUci(uci?: string): [string, string] | null {
  if (!uci || uci.length < 4) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

export function classNames(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function sourceLabel(source: string): string {
  return source === 'chesscom' ? 'chess.com' : source;
}

/** Movetime in seconds, trimmed: 250 → "0.25", 2500 → "2.5", 10000 → "10". */
export function fmtMovetime(ms: number): string {
  return (ms / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Printed result notation: ½–½ with a real half. */
export function fmtResult(result?: string): string {
  if (result === '1/2-1/2') return '½–½';
  if (!result || result === '*') return '—';
  return result;
}
