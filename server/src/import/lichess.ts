import type { ImportPreview } from '../types.js';

const MAX_GAMES = 40;
const SKIP_STATUSES = new Set(['aborted', 'noStart', 'unknownFinish']);

interface LichessGame {
  id?: string;
  variant?: string;
  speed?: string;
  status?: string;
  createdAt?: number;
  winner?: 'white' | 'black';
  pgn?: string;
  opening?: { eco?: string; name?: string };
  players?: {
    white?: { user?: { name?: string }; rating?: number };
    black?: { user?: { name?: string }; rating?: number };
  };
}

export async function fetchLichessGames(username: string): Promise<ImportPreview[]> {
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${MAX_GAMES}&pgnInJson=true&opening=true&standard=true&clocks=false&evals=false`;
  const res = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`lichess user "${username}" not found.`);
  if (!res.ok) throw new Error(`lichess API error (HTTP ${res.status}).`);

  const text = await res.text();
  const previews: ImportPreview[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g: LichessGame;
    try {
      g = JSON.parse(line) as LichessGame;
    } catch {
      continue;
    }
    if (g.variant && g.variant !== 'standard') continue;
    if (g.status && SKIP_STATUSES.has(g.status)) continue;
    if (!g.pgn) continue;

    const result = !g.winner ? '1/2-1/2' : g.winner === 'white' ? '1-0' : '0-1';
    previews.push({
      sourceUrl: g.id ? `https://lichess.org/${g.id}` : 'https://lichess.org',
      white: g.players?.white?.user?.name ?? 'Anonymous',
      black: g.players?.black?.user?.name ?? 'Anonymous',
      whiteElo: g.players?.white?.rating,
      blackElo: g.players?.black?.rating,
      result,
      date: g.createdAt ? new Date(g.createdAt).toISOString().slice(0, 10) : undefined,
      timeClass: g.speed,
      eco: g.opening?.eco,
      opening: g.opening?.name,
      pgn: g.pgn,
    });
  }
  return previews;
}
