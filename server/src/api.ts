import { Router } from 'express';
import { Chess } from 'chess.js';
import { engineManager } from './engine/manager.js';
import { openingBook } from './analysis/book.js';
import { analyzeGame, AnalysisAbortedError } from './analysis/analyze.js';
import { parsePgnGame, splitPgnGames, PgnParseError } from './analysis/pgn.js';
import { fetchChessComGames } from './import/chesscom.js';
import { fetchLichessGames } from './import/lichess.js';
import { buildAnnotatedPgn } from './exportPgn.js';
import * as db from './db.js';
import { MOVETIME_STEPS } from './config.js';
import type { GameSummary, ImportPreview } from './types.js';

export const api = Router();

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function summaryFor(gameId: number): GameSummary | undefined {
  return db.listGames().find((g) => g.id === gameId);
}

function isValidFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- health ----

api.get('/health', async (_req, res) => {
  const engine = await engineManager.status();
  res.json({
    ok: true,
    engine,
    book: { loaded: openingBook.loaded, lines: openingBook.lineCount },
  });
});

// -------------------------------------------------------------- settings ----

api.get('/settings', (_req, res) => {
  res.json({ ...db.getSettings(), movetimeSteps: MOVETIME_STEPS });
});

api.put('/settings', (req, res) => {
  const body = req.body ?? {};
  const patch: Partial<db.AppSettings> = {};
  if (body.defaultMovetimeMs !== undefined) {
    patch.defaultMovetimeMs = clamp(Math.round(Number(body.defaultMovetimeMs) || 250), 250, 30000);
  }
  if (body.threads !== undefined) patch.threads = clamp(Math.round(Number(body.threads) || 1), 1, 128);
  if (body.hashMb !== undefined) patch.hashMb = clamp(Math.round(Number(body.hashMb) || 16), 16, 8192);
  if (body.enginePath !== undefined) patch.enginePath = String(body.enginePath);
  if (body.lichessToken !== undefined) patch.lichessToken = String(body.lichessToken);
  res.json({ ...db.setSettings(patch), movetimeSteps: MOVETIME_STEPS });
});

// --------------------------------------------------------------- library ----

api.get('/library', (_req, res) => {
  res.json({ games: db.listGames() });
});

api.get('/games/:id', (req, res) => {
  const id = Number(req.params.id);
  const game = db.getGame(id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  res.json({ game, analysis: db.getAnalysis(id) });
});

api.delete('/games/:id', (req, res) => {
  const id = Number(req.params.id);
  const deleted = db.deleteGame(id);
  if (!deleted) return res.status(404).json({ error: 'Game not found.' });
  res.json({ ok: true });
});

api.get('/games/:id/export.pgn', (req, res) => {
  const id = Number(req.params.id);
  const game = db.getGame(id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  const pgn = buildAnnotatedPgn(game, db.getAnalysis(id));
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 40);
  const filename = `${safe(game.meta.white)}_vs_${safe(game.meta.black)}_${game.id}.pgn`;
  res.setHeader('Content-Type', 'application/x-chess-pgn; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pgn);
});

// ---------------------------------------------------------------- import ----

api.post('/parse', (req, res) => {
  const pgn = String(req.body?.pgn ?? '');
  if (!pgn.trim()) return res.status(400).json({ error: 'No PGN provided.' });
  const chunks = splitPgnGames(pgn);
  const games = chunks.map((chunk, index) => {
    try {
      const parsed = parsePgnGame(chunk);
      return {
        index,
        white: parsed.meta.white,
        black: parsed.meta.black,
        whiteElo: parsed.meta.whiteElo,
        blackElo: parsed.meta.blackElo,
        result: parsed.meta.result,
        date: parsed.meta.date,
        eco: parsed.meta.eco,
        opening: parsed.meta.opening,
        plyCount: parsed.moves.length,
      };
    } catch (err) {
      return { index, error: err instanceof PgnParseError ? err.message : 'Could not parse this game.' };
    }
  });
  res.json({ games });
});

api.post('/games', (req, res) => {
  const body = req.body ?? {};
  const pgn = String(body.pgn ?? '');
  const source = ['pgn', 'chesscom', 'lichess'].includes(body.source) ? String(body.source) : 'pgn';
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl) : undefined;
  const gameIndex = Number.isFinite(Number(body.gameIndex)) ? Number(body.gameIndex) : 0;
  if (!pgn.trim()) return res.status(400).json({ error: 'No PGN provided.' });

  const chunks = splitPgnGames(pgn);
  if (chunks.length === 0) return res.status(400).json({ error: 'No games found in the PGN.' });
  if (gameIndex < 0 || gameIndex >= chunks.length) {
    return res.status(400).json({ error: `Game index ${gameIndex} is out of range (${chunks.length} games).` });
  }

  let parsed;
  try {
    parsed = parsePgnGame(chunks[gameIndex]);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Could not parse the PGN.' });
  }

  const id = db.insertGame({
    source,
    sourceUrl,
    meta: parsed.meta,
    startFen: parsed.startFen,
    moves: parsed.moves,
    pgn: parsed.pgn,
  });
  res.json({ id, summary: summaryFor(id) });
});

api.get('/import/chesscom', async (req, res) => {
  const username = String(req.query.username ?? '').trim();
  if (!username) return res.status(400).json({ error: 'Username required.' });
  try {
    const games = await fetchChessComGames(username);
    res.json({ games });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'chess.com import failed.';
    res.status(message.includes('not found') ? 404 : 502).json({ error: message });
  }
});

api.get('/import/lichess', async (req, res) => {
  const username = String(req.query.username ?? '').trim();
  if (!username) return res.status(400).json({ error: 'Username required.' });
  try {
    const games = await fetchLichessGames(username);
    res.json({ games });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lichess import failed.';
    res.status(message.includes('not found') ? 404 : 502).json({ error: message });
  }
});

// -------------------------------------------------------------- analysis ----

api.get('/games/:id/analyze', async (req, res) => {
  const id = Number(req.params.id);
  const game = db.getGame(id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  const settings = db.getSettings();
  const movetimeMs = clamp(
    Math.round(Number(req.query.movetime ?? settings.defaultMovetimeMs) || settings.defaultMovetimeMs),
    50,
    30000,
  );
  const multipv = clamp(Math.round(Number(req.query.multipv ?? 3) || 3), 1, 5);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
      engineManager.cancelInFlight();
    }
  });

  const startedAt = Date.now();
  try {
    send('started', { gameId: id, movetimeMs, multipv, plies: game.moves.length });
    const data = await analyzeGame(game, {
      movetimeMs,
      multipv,
      signal: controller.signal,
      onProgress: (done, total, ply) => send('progress', { done, total, ply }),
    });
    db.saveAnalysis(id, data);
    send('done', {
      gameId: id,
      elapsedMs: Date.now() - startedAt,
      whiteAccuracy: Math.round(data.white.accuracy * 10) / 10,
      blackAccuracy: Math.round(data.black.accuracy * 10) / 10,
    });
  } catch (err) {
    if (!(err instanceof AnalysisAbortedError) && !controller.signal.aborted) {
      send('error', { message: err instanceof Error ? err.message : 'Analysis failed.' });
    }
  } finally {
    res.end();
  }
});

// ------------------------------------------------------- explore / eval ----

api.get('/eval', async (req, res) => {
  const fen = String(req.query.fen ?? '');
  if (!isValidFen(fen)) return res.status(400).json({ error: 'Invalid FEN.' });
  const movetimeMs = clamp(Math.round(Number(req.query.movetime ?? 800) || 800), 100, 10000);
  const multipv = clamp(Math.round(Number(req.query.multipv ?? 3) || 3), 1, 5);
  try {
    const outcome = await engineManager.evalPosition(fen, { movetimeMs, multipv });
    res.json(outcome);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'Engine error.' });
  }
});

const exploreCache = new Map<string, { at: number; data: unknown }>();
const EXPLORE_TTL_MS = 10 * 60 * 1000;

api.get('/explore', async (req, res) => {
  const fen = String(req.query.fen ?? '');
  if (!isValidFen(fen)) return res.status(400).json({ error: 'Invalid FEN.' });
  const dbName = req.query.db === 'lichess' ? 'lichess' : 'masters';
  const play = String(req.query.play ?? '');
  const token = db.getSettings().lichessToken;
  const key = `${dbName}|${fen}|${play}|${token ? 'auth' : 'anon'}`;

  const cached = exploreCache.get(key);
  if (cached && Date.now() - cached.at < EXPLORE_TTL_MS) return res.json(cached.data);

  const params = new URLSearchParams({ fen, variant: 'standard', topGames: '0', recentGames: '0', source: 'analysis' });
  if (play) params.set('play', play);
  if (dbName === 'lichess') params.set('speeds', 'blitz,rapid,classical');
  try {
    const headers: Record<string, string> = { 'User-Agent': 'chess-review/0.1' };
    // lichess requires an OAuth token on the explorer API since 2025.
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`https://explorer.lichess.ovh/${dbName}?${params.toString()}`, { headers });
    if (r.status === 401) {
      return res.status(401).json({
        error: token
          ? 'Lichess rejected the token — check it in Settings (needs no scopes).'
          : 'The lichess opening explorer now requires a (free) lichess token. Add one in Settings, or use the Local book tab.',
        needsToken: true,
      });
    }
    if (r.status === 429) {
      return res.status(429).json({ error: 'Lichess is rate-limiting the explorer. Try again in a minute.' });
    }
    if (!r.ok) return res.status(502).json({ error: `Opening explorer error (HTTP ${r.status}).` });
    const data = await r.json();
    exploreCache.set(key, { at: Date.now(), data });
    if (exploreCache.size > 500) {
      const oldest = [...exploreCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) exploreCache.delete(oldest[0]);
    }
    res.json(data);
  } catch {
    res.status(502).json({ error: 'Could not reach the opening explorer (offline?). The Local book tab still works.' });
  }
});

/** Offline explorer: candidate moves from the bundled opening book (no network). */
api.get('/book', (req, res) => {
  const fen = String(req.query.fen ?? '');
  if (!isValidFen(fen)) return res.status(400).json({ error: 'Invalid FEN.' });
  res.json(openingBook.candidatesFor(fen));
});

// ------------------------------------------------------------- favicon? ----
