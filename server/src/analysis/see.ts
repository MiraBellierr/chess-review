/**
 * Material / static-exchange helpers used by classification heuristics
 * (Brilliant sacrifice detection and "you gave up material" captions).
 *
 * These deliberately ignore pins and checks — this is a heuristic layer,
 * not a rules engine.
 */
import { Chess } from 'chess.js';

const P = 1;
const N = 2;
const B = 3;
const R = 4;
const Q = 5;
const K = 6;

export const PIECE_VALUE: Record<number, number> = {
  [P]: 100,
  [N]: 320,
  [B]: 330,
  [R]: 500,
  [Q]: 900,
  [K]: 20000,
};

type Board = Int8Array; // positive = white piece code, negative = black, 0 = empty

const BOARD_LEN = 64;

function idx(square: string): number {
  const file = square.charCodeAt(0) - 97; // a=0
  const rank = square.charCodeAt(1) - 49; // '1'=0
  return rank * 8 + file;
}

function sq(idxIn: number): string {
  return String.fromCharCode(97 + (idxIn % 8)) + String.fromCharCode(49 + Math.floor(idxIn / 8));
}

const CODE_BY_TYPE_COLOR: Record<string, number> = {
  wp: P, wn: N, wb: B, wr: R, wq: Q, wk: K,
  bp: -P, bn: -N, bb: -B, br: -R, bq: -Q, bk: -K,
};

function boardFromFen(fen: string): Board {
  const board = new Int8Array(BOARD_LEN);
  const chess = new Chess(fen);
  const rows = chess.board(); // rows[0] = rank 8
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = rows[r][f];
      if (!cell) continue;
      const rankFrom1 = 7 - r; // rows[0] is rank 8
      board[rankFrom1 * 8 + f] = CODE_BY_TYPE_COLOR[`${cell.color}${cell.type}`] ?? 0;
    }
  }
  return board;
}

function colorOf(pc: number): 1 | -1 {
  return pc > 0 ? 1 : -1;
}

function typeOf(pc: number): number {
  return Math.abs(pc);
}

function isLastRank(sqIdx: number, color: 1 | -1): boolean {
  const rank = Math.floor(sqIdx / 8);
  return color === 1 ? rank === 7 : rank === 0;
}

function applyCapture(board: Board, from: number, to: number, moverColor: 1 | -1): void {
  let pc = board[from];
  if (typeOf(pc) === P && isLastRank(to, moverColor)) pc = moverColor === 1 ? Q : -Q;
  board[to] = pc;
  board[from] = 0;
}

/** Does `color` attack square `target`? (Pseudo-legal, ignores pins.) */
function attacks(board: Board, from: number, color: 1 | -1, target: number): boolean {
  const pc = board[from];
  const t = typeOf(pc);
  const tf = target % 8;
  const tr = Math.floor(target / 8);
  const ff = from % 8;
  const fr = Math.floor(from / 8);

  switch (t) {
    case P: {
      const dr = color === 1 ? 1 : -1;
      return tr - fr === dr && Math.abs(tf - ff) === 1;
    }
    case N: {
      const df = Math.abs(tf - ff);
      const dr = Math.abs(tr - fr);
      return (df === 1 && dr === 2) || (df === 2 && dr === 1);
    }
    case B:
    case R:
    case Q: {
      const df = tf - ff;
      const dr = tr - fr;
      const diagonal = Math.abs(df) === Math.abs(dr) && df !== 0;
      const straight = (df === 0) !== (dr === 0);
      if (t === B && !diagonal) return false;
      if (t === R && !straight) return false;
      if (t === Q && !diagonal && !straight) return false;
      const stepF = Math.sign(df);
      const stepR = Math.sign(dr);
      const dist = Math.max(Math.abs(df), Math.abs(dr));
      for (let i = 1; i < dist; i++) {
        if (board[(fr + stepR * i) * 8 + (ff + stepF * i)] !== 0) return false;
      }
      return true;
    }
    case K: {
      return Math.max(Math.abs(tf - ff), Math.abs(tr - fr)) === 1;
    }
  }
  return false;
}

function isAttacked(board: Board, target: number, byColor: 1 | -1): boolean {
  for (let i = 0; i < BOARD_LEN; i++) {
    const pc = board[i];
    if (pc === 0 || colorOf(pc) !== byColor) continue;
    if (attacks(board, i, byColor, target)) return true;
  }
  return false;
}

function smallestAttacker(board: Board, target: number, color: 1 | -1): number {
  let best = -1;
  let bestVal = Infinity;
  for (let i = 0; i < BOARD_LEN; i++) {
    const pc = board[i];
    if (pc === 0 || colorOf(pc) !== color) continue;
    if (!attacks(board, i, color, target)) continue;
    const val = PIECE_VALUE[typeOf(pc)] + (typeOf(pc) === P && isLastRank(target, color) ? 800 : 0);
    if (val < bestVal) {
      bestVal = val;
      best = i;
    }
  }
  return best;
}

/** Classic SEE: net material gain (centipawns) for `side` capturing on `to`. */
function see(board: Board, to: number, side: 1 | -1): number {
  const attacker = smallestAttacker(board, to, side);
  if (attacker === -1) return 0;
  const victim = PIECE_VALUE[typeOf(board[to])];
  const b2 = board.slice();
  applyCapture(b2, attacker, to, side);
  const gain = victim - see(b2, to, -side as 1 | -1);
  return Math.max(0, gain);
}

/**
 * SEE gain for `byColor` capturing on `square`, considering only legal
 * captures that actually target that square. Used to detect genuine
 * sacrifices: after the mover's move, can the opponent profitably capture
 * the piece that just landed on `square`?
 */
export function captureGainOnSquare(fen: string, square: string, byColor: 'w' | 'b'): number {
  const chess = new Chess(fen);
  if (chess.turn() !== byColor) return 0;
  const captures = chess.moves({ verbose: true }).filter((mv) => mv.to === square && mv.captured);
  if (captures.length === 0) return 0;
  const side: 1 | -1 = byColor === 'w' ? 1 : -1;
  return see(boardFromFen(fen), idx(square), side);
}

/**
 * Material (centipawns) the mover genuinely concedes by playing a move that lands
 * on `square`: what the opponent wins by capturing there, minus the material the
 * move itself captured.
 *
 * The netting matters: without it, ordinary trades (Nxd5 Nxd5) and defended
 * captures (Bxe7 Rxe7) look like sacrifices, because after the move the piece on
 * `square` *can* be taken. Zero for quiet moves, trades and recaptures.
 */
export function concededMaterialCp(
  fenBefore: string,
  fenAfter: string,
  square: string,
  moverIsWhite: boolean,
): number {
  const sign = moverIsWhite ? 1 : -1;
  const balanceBefore = materialBalance(fenBefore) * sign;
  const balanceAfter = materialBalance(fenAfter) * sign;
  const gainForOpponent = captureGainOnSquare(fenAfter, square, moverIsWhite ? 'b' : 'w');
  return Math.max(0, balanceBefore - (balanceAfter - gainForOpponent));
}

/** Material balance in centipawns from white's POV for a FEN (kings excluded). */
export function materialBalance(fen: string): number {
  const board = boardFromFen(fen);
  let sum = 0;
  for (let i = 0; i < BOARD_LEN; i++) {
    const pc = board[i];
    if (pc === 0 || typeOf(pc) === K) continue;
    sum += colorOf(pc) * PIECE_VALUE[typeOf(pc)];
  }
  return sum;
}
