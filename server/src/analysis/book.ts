import fs from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { BOOK_DIR } from '../config.js';

interface BookEntry {
  eco: string;
  name: string;
  len: number;
}

/** One candidate move from the bundled book, with the lines that recommend it. */
export interface BookMove {
  uci: string;
  san: string;
  /** How many book lines play this move here. */
  count: number;
  eco?: string;
  /** Most common name for the move, when the position is deep enough to have one. */
  name?: string;
  /** Ply at which this move appears in the book lines (how deep the line goes). */
  depth: number;
}

export interface BookPosition {
  moves: BookMove[];
  total: number;
  eco?: string;
  name?: string;
}

function fen4(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

interface BookMoveStat {
  san: string;
  count: number;
  depth: number;
  /** Position reached after this move (fen4) — used to name the move at query time. */
  after: string;
}

class OpeningBook {
  private moves = new Set<string>(); // `${fen4}|${uci}`
  private positions = new Map<string, BookEntry>();
  /** `${fen4}` -> uci -> line stats, powers the offline explorer. */
  private candidates = new Map<string, Map<string, BookMoveStat>>();
  /** `${fen4}` -> line name -> how many book lines call this position that. */
  private names = new Map<string, Map<string, { eco: string; count: number }>>();
  loaded = false;
  lineCount = 0;

  load(dir: string = BOOK_DIR): void {
    this.moves.clear();
    this.positions.clear();
    this.candidates.clear();
    this.names.clear();
    this.lineCount = 0;
    if (!fs.existsSync(dir)) {
      this.loaded = false;
      return;
    }
    for (const file of ['a', 'b', 'c', 'd', 'e']) {
      const p = path.join(dir, `${file}.tsv`);
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('eco\t')) continue;
        const [eco, name, pgn] = line.split('\t');
        if (!eco || !pgn) continue;
        this.addLine(eco, name, pgn);
      }
    }
    this.loaded = this.moves.size > 0;
  }

  private addLine(eco: string, name: string, pgn: string): void {
    const tokens = pgn.split(/\s+/).filter((t) => t && !/^\d+\.*$/.test(t) && t !== '1-0' && t !== '0-1' && t !== '1/2-1/2' && t !== '*');
    const chess = new Chess();
    let count = 0;
    for (const token of tokens) {
      const san = token.replace(/[!?]+$/, '');
      let mv;
      try {
        mv = chess.move(san, { strict: false });
      } catch {
        return; // bad line, skip the whole line
      }
      const before = fen4(mv.before);
      const uci = mv.from + mv.to + (mv.promotion ?? '');
      this.moves.add(`${before}|${uci}`);
      count++;
      const after = fen4(chess.fen());
      const existing = this.positions.get(after);
      if (!existing || existing.len < count) {
        this.positions.set(after, { eco, name, len: count });
      }
      this.recordName(after, eco, name);
      this.recordCandidate(before, uci, mv.san, count, after);
    }
    this.lineCount++;
  }

  private recordName(position: string, eco: string, name: string): void {
    let map = this.names.get(position);
    if (!map) {
      map = new Map();
      this.names.set(position, map);
    }
    const hit = map.get(name);
    if (hit) hit.count++;
    else map.set(name, { eco, count: 1 });
  }

  /**
   * The name most book lines give a position. Counts are a proxy for how commonly
   * a name is attached to the position, which beats "whatever line came first".
   */
  private commonName(position: string): { eco?: string; name?: string } {
    const map = this.names.get(position);
    if (!map) return {};
    let best: { eco: string; count: number; name: string } | null = null;
    for (const [name, { eco, count }] of map) {
      if (!best || count > best.count || (count === best.count && name.length < best.name.length)) {
        best = { eco, count, name };
      }
    }
    return best ? { eco: best.eco, name: best.name } : {};
  }

  private recordCandidate(before: string, uci: string, san: string, depth: number, after: string): void {
    let map = this.candidates.get(before);
    if (!map) {
      map = new Map();
      this.candidates.set(before, map);
    }
    const stat = map.get(uci);
    if (!stat) {
      map.set(uci, { san, count: 1, depth, after });
      return;
    }
    stat.count++;
    if (depth > stat.depth) stat.depth = depth;
  }

  isBookMove(fenBefore: string, uci: string): boolean {
    if (!this.loaded) return false;
    return this.moves.has(`${fen4(fenBefore)}|${uci}`);
  }

  /** Candidate moves from the bundled book for a position (offline explorer). */
  candidatesFor(fen: string): BookPosition {
    const empty: BookPosition = { moves: [], total: 0 };
    if (!this.loaded) return empty;
    const key = fen4(fen);
    const map = this.candidates.get(key);
    if (!map) return empty;
    const moves: BookMove[] = [];
    let total = 0;
    for (const [uci, stat] of map) {
      // Names only make sense once a line is a few plies deep — "1. e4" has dozens of names.
      const label = stat.depth >= 3 ? this.commonName(stat.after) : {};
      moves.push({ uci, san: stat.san, count: stat.count, depth: stat.depth, eco: label.eco, name: label.name });
      total += stat.count;
    }
    moves.sort((a, b) => b.count - a.count || b.depth - a.depth || a.san.localeCompare(b.san));
    const own = this.commonName(key);
    const entry = this.positions.get(key);
    return { moves, total, eco: own.eco ?? entry?.eco, name: own.name ?? entry?.name };
  }

  /** Longest line-prefix match to identify the opening name for a played game. */
  openingFor(fens: string[]): { eco?: string; name?: string } | null {
    if (!this.loaded) return null;
    let best: BookEntry | null = null;
    for (const fen of fens) {
      const entry = this.positions.get(fen4(fen));
      if (entry && (!best || entry.len > best.len)) best = entry;
    }
    return best ? { eco: best.eco, name: best.name } : null;
  }
}

export const openingBook = new OpeningBook();
