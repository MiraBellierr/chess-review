import { Chess } from 'chess.js';
import type { GameMeta, MoveRecord } from '../types.js';

export class PgnParseError extends Error {}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface ParsedPgnGame {
  meta: GameMeta;
  startFen: string;
  moves: MoveRecord[];
  pgn: string;
}

/** Split a PGN blob into individual game chunks. */
export function splitPgnGames(text: string): string[] {
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!norm) return [];

  const eventMatches = [...norm.matchAll(/(^|\n)(?=\[Event\s)/g)];
  if (eventMatches.length >= 1) {
    const starts = eventMatches.map((m) => (m.index ?? 0) + m[1].length);
    const chunks: string[] = [];
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : norm.length;
      const chunk = norm.slice(starts[i], end).trim();
      if (chunk) chunks.push(chunk);
    }
    if (chunks.length > 1) return chunks;
    // A single [Event] block plus possibly movetext-only leftovers: fall through when only one chunk.
    if (chunks.length === 1) return chunks;
  }

  // No [Event] tags: split on blank-line-separated tag blocks, else treat as a single game.
  const parts = norm.split(/\n\s*\n(?=\s*\[)/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [norm];
}

interface Token {
  type: 'san' | 'comment' | 'number' | 'nag' | 'result';
  value: string;
}

function tokenizeMovetext(movetext: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < movetext.length) {
    const c = movetext[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '{') {
      const end = movetext.indexOf('}', i);
      const text = end === -1 ? movetext.slice(i + 1) : movetext.slice(i + 1, end);
      tokens.push({ type: 'comment', value: text });
      i = end === -1 ? movetext.length : end + 1;
      continue;
    }
    if (c === ';') {
      const end = movetext.indexOf('\n', i);
      i = end === -1 ? movetext.length : end + 1;
      continue;
    }
    if (c === '(') {
      // Skip an entire variation, including nested ones and comments inside.
      let depth = 1;
      i++;
      while (i < movetext.length && depth > 0) {
        const ch = movetext[i];
        if (ch === '{') {
          const end = movetext.indexOf('}', i);
          i = end === -1 ? movetext.length : end + 1;
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < movetext.length && /\d/.test(movetext[j])) j++;
      tokens.push({ type: 'nag', value: movetext.slice(i, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < movetext.length && !/[\s{}();]/.test(movetext[j])) j++;
    const word = movetext.slice(i, j);
    i = j;

    const numMatch = /^(\d+)\.+(.*)$/.exec(word);
    if (numMatch) {
      tokens.push({ type: 'number', value: numMatch[1] + '.' });
      const rest = numMatch[2];
      if (rest) {
        if (rest === '1-0' || rest === '0-1' || rest === '1/2-1/2' || rest === '*') {
          tokens.push({ type: 'result', value: rest });
        } else {
          tokens.push({ type: 'san', value: rest });
        }
      }
      continue;
    }
    if (word === '1-0' || word === '0-1' || word === '1/2-1/2' || word === '*') {
      tokens.push({ type: 'result', value: word });
      continue;
    }
    tokens.push({ type: 'san', value: word });
  }
  return tokens;
}

function parseTags(chunk: string): { tags: Record<string, string>; movetext: string } {
  const tags: Record<string, string> = {};
  const lines = chunk.split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^\[(\w+)\s+"(.*)"\]$/.exec(line);
    if (!m) break;
    tags[m[1]] = m[2];
  }
  return { tags, movetext: lines.slice(i).join('\n') };
}

function parseClock(comment: string): { clockMs?: number; emtMs?: number; clean: string } {
  let clockMs: number | undefined;
  let emtMs: number | undefined;
  const clk = /\[%clk\s+([0-9:.]+)\]/.exec(comment);
  if (clk) clockMs = clockStringToMs(clk[1]);
  const emt = /\[%emt\s+([0-9:.]+)\]/.exec(comment);
  if (emt) emtMs = clockStringToMs(emt[1]);
  const clean = comment
    .replace(/\[%clk\s+[0-9:.]+\]/g, '')
    .replace(/\[%emt\s+[0-9:.]+\]/g, '')
    .replace(/\[%eval\s+[^\]]*\]/g, '')
    .trim();
  return { clockMs, emtMs, clean };
}

function clockStringToMs(value: string): number | undefined {
  const parts = value.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return Math.round(seconds * 1000);
}

export function parsePgnGame(chunk: string): ParsedPgnGame {
  const { tags, movetext } = parseTags(chunk);
  const startFen = tags.FEN?.trim() || START_FEN;

  const chess = new Chess(startFen === START_FEN ? undefined : startFen);
  const moves: MoveRecord[] = [];
  const tokens = tokenizeMovetext(movetext);

  let pendingComment: { clockMs?: number; emtMs?: number; clean: string } | null = null;

  for (const token of tokens) {
    if (token.type === 'comment') {
      const parsed = parseClock(token.value);
      // A comment annotates the move it follows; a comment before any move
      // (some exporters put the starting clock first) belongs to the next one.
      const target = moves[moves.length - 1];
      if (!target) {
        pendingComment = parsed;
        continue;
      }
      if (parsed.clockMs !== undefined) target.clockMs = parsed.clockMs;
      if (parsed.emtMs !== undefined) target.emtMs = parsed.emtMs;
      if (parsed.clean) target.comment = target.comment ? `${target.comment} ${parsed.clean}` : parsed.clean;
      continue;
    }
    if (token.type !== 'san') continue;

    let san = token.value
      .replace(/[!?]+$/, '')
      .replace(/^0-0-0/i, 'O-O-O')
      .replace(/^0-0/i, 'O-O')
      .replace(/\s*e\.p\.?/i, '')
      .trim();
    if (!san) continue;

    let mv;
    try {
      mv = chess.move(san, { strict: false });
    } catch {
      try {
        mv = chess.move(san);
      } catch (err) {
        throw new PgnParseError(
          `Illegal move "${token.value}" at move ${Math.floor(moves.length / 2) + 1} (${chess.turn() === 'w' ? 'White' : 'Black'}).`,
        );
      }
    }

    const record: MoveRecord = {
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion ?? ''),
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion,
      fenAfter: chess.fen(),
    };
    if (pendingComment) {
      if (pendingComment.clockMs !== undefined) record.clockMs = pendingComment.clockMs;
      if (pendingComment.emtMs !== undefined) record.emtMs = pendingComment.emtMs;
      if (pendingComment.clean) record.comment = pendingComment.clean;
      pendingComment = null;
    }
    moves.push(record);
  }

  if (moves.length === 0) {
    throw new PgnParseError('No moves found in this PGN.');
  }

  const meta: GameMeta = {
    event: tags.Event,
    site: tags.Site,
    round: tags.Round,
    date: tags.Date ?? tags.UTCDate,
    white: tags.White ?? 'White',
    black: tags.Black ?? 'Black',
    whiteElo: tags.WhiteElo ? Number(tags.WhiteElo) || undefined : undefined,
    blackElo: tags.BlackElo ? Number(tags.BlackElo) || undefined : undefined,
    result: normalizeResult(tags.Result),
    eco: tags.ECO,
    opening: tags.Opening,
  };

  return { meta, startFen, moves, pgn: chunk.trim() };
}

function normalizeResult(result?: string): string {
  if (result === '1-0' || result === '0-1' || result === '1/2-1/2') return result;
  return '*';
}

export function parsePgn(text: string): ParsedPgnGame[] {
  const chunks = splitPgnGames(text);
  const games: ParsedPgnGame[] = [];
  for (const chunk of chunks) {
    games.push(parsePgnGame(chunk));
  }
  return games;
}
