import type { ImportPreview } from '../types.js';

const USER_AGENT = 'chess-review/0.1 (personal chess analysis tool)';
const MONTHS_BACK = 2;
const MAX_GAMES = 40;

interface ChessComGame {
  url?: string;
  pgn?: string;
  rules?: string;
  time_class?: string;
  time_control?: string;
  end_time?: number;
  eco?: string;
  white?: { username?: string; rating?: number; result?: string };
  black?: { username?: string; rating?: number; result?: string };
}

function openingFromEcoUrl(eco?: string): string | undefined {
  if (!eco) return undefined;
  try {
    const last = decodeURIComponent(new URL(eco).pathname.split('/').filter(Boolean).pop() ?? '');
    if (!last) return undefined;
    return last.replace(/-/g, ' ').replace(/\b\d+\b$/, '').trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function fetchChessComGames(username: string): Promise<ImportPreview[]> {
  const headers = { 'User-Agent': USER_AGENT };
  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
    { headers },
  );
  if (archivesRes.status === 404) throw new Error(`chess.com player "${username}" not found.`);
  if (!archivesRes.ok) throw new Error(`chess.com API error (HTTP ${archivesRes.status}).`);
  const { archives } = (await archivesRes.json()) as { archives?: string[] };
  const months = (archives ?? []).slice(-MONTHS_BACK).reverse();

  const previews: ImportPreview[] = [];
  for (const monthUrl of months) {
    if (previews.length >= MAX_GAMES) break;
    const monthRes = await fetch(monthUrl, { headers });
    if (!monthRes.ok) continue;
    const { games } = (await monthRes.json()) as { games?: ChessComGame[] };
    for (const g of (games ?? []).reverse()) {
      if (previews.length >= MAX_GAMES) break;
      if (g.rules && g.rules !== 'chess') continue;
      if (!g.pgn) continue;
      const result =
        g.white?.result === 'win' ? '1-0' : g.black?.result === 'win' ? '0-1' : '1/2-1/2';
      previews.push({
        sourceUrl: g.url ?? 'https://www.chess.com',
        white: g.white?.username ?? 'White',
        black: g.black?.username ?? 'Black',
        whiteElo: g.white?.rating,
        blackElo: g.black?.rating,
        result,
        date: g.end_time ? new Date(g.end_time * 1000).toISOString().slice(0, 10) : undefined,
        timeClass: g.time_class,
        event: g.time_control,
        opening: openingFromEcoUrl(g.eco),
        pgn: g.pgn,
      });
    }
  }
  return previews;
}
