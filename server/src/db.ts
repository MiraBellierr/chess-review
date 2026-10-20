import Database from 'better-sqlite3';
import { DB_PATH, ensureDirs, DEFAULT_MOVETIME_MS, DEFAULT_THREADS, DEFAULT_HASH_MB } from './config.js';
import type { AnalysisData, GameMeta, GameSummary, MoveRecord, StoredGame } from './types.js';

ensureDirs();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_url TEXT,
  meta_json TEXT NOT NULL,
  start_fen TEXT NOT NULL,
  moves_json TEXT NOT NULL,
  pgn TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  movetime_ms INTEGER NOT NULL,
  multipv INTEGER NOT NULL,
  engine TEXT,
  white_accuracy REAL,
  black_accuracy REAL,
  white_rating INTEGER,
  black_rating INTEGER,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export interface AppSettings {
  defaultMovetimeMs: number;
  threads: number;
  hashMb: number;
  enginePath?: string;
  /** Optional lichess OAuth token — the online opening explorer now requires one. */
  lichessToken?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultMovetimeMs: DEFAULT_MOVETIME_MS,
  threads: DEFAULT_THREADS,
  hashMb: DEFAULT_HASH_MB,
  lichessToken: process.env.LICHESS_TOKEN || undefined,
};

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, string> = {};
  for (const r of rows) stored[r.key] = r.value;
  return {
    defaultMovetimeMs: Number(stored.defaultMovetimeMs ?? DEFAULT_SETTINGS.defaultMovetimeMs),
    threads: Number(stored.threads ?? DEFAULT_SETTINGS.threads),
    hashMb: Number(stored.hashMb ?? DEFAULT_SETTINGS.hashMb),
    enginePath: stored.enginePath || undefined,
    lichessToken: stored.lichessToken || DEFAULT_SETTINGS.lichessToken,
  };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const tx = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v);
  });
  const entries: [string, string][] = [];
  if (patch.defaultMovetimeMs !== undefined) entries.push(['defaultMovetimeMs', String(patch.defaultMovetimeMs)]);
  if (patch.threads !== undefined) entries.push(['threads', String(patch.threads)]);
  if (patch.hashMb !== undefined) entries.push(['hashMb', String(patch.hashMb)]);
  if (patch.enginePath !== undefined) entries.push(['enginePath', patch.enginePath]);
  if (patch.lichessToken !== undefined) entries.push(['lichessToken', patch.lichessToken.trim()]);
  tx(entries);
  return getSettings();
}

interface GameRow {
  id: number;
  source: string;
  source_url: string | null;
  meta_json: string;
  start_fen: string;
  moves_json: string;
  pgn: string;
  created_at: number;
}

export function insertGame(input: {
  source: string;
  sourceUrl?: string;
  meta: GameMeta;
  startFen: string;
  moves: MoveRecord[];
  pgn: string;
}): number {
  const info = db
    .prepare(
      `INSERT INTO games (source, source_url, meta_json, start_fen, moves_json, pgn, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.source,
      input.sourceUrl ?? null,
      JSON.stringify(input.meta),
      input.startFen,
      JSON.stringify(input.moves),
      input.pgn,
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

export function getGame(id: number): StoredGame | null {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
  if (!row) return null;
  return rowToGame(row);
}

function rowToGame(row: GameRow): StoredGame {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    meta: JSON.parse(row.meta_json) as GameMeta,
    startFen: row.start_fen,
    moves: JSON.parse(row.moves_json) as MoveRecord[],
    pgn: row.pgn,
    createdAt: row.created_at,
  };
}

export function deleteGame(id: number): boolean {
  const info = db.prepare('DELETE FROM games WHERE id = ?').run(id);
  return info.changes > 0;
}

export function saveAnalysis(gameId: number, data: AnalysisData): void {
  db.prepare(
    `INSERT INTO analyses (game_id, movetime_ms, multipv, engine, white_accuracy, black_accuracy, white_rating, black_rating, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game_id) DO UPDATE SET
       movetime_ms = excluded.movetime_ms,
       multipv = excluded.multipv,
       engine = excluded.engine,
       white_accuracy = excluded.white_accuracy,
       black_accuracy = excluded.black_accuracy,
       white_rating = excluded.white_rating,
       black_rating = excluded.black_rating,
       data_json = excluded.data_json,
       created_at = excluded.created_at`,
  ).run(
    gameId,
    data.movetimeMs,
    data.multipv,
    data.engine ?? null,
    data.white.accuracy,
    data.black.accuracy,
    data.white.rating,
    data.black.rating,
    JSON.stringify(data),
    data.createdAt,
  );
}

export function getAnalysis(gameId: number): AnalysisData | null {
  const row = db.prepare('SELECT data_json FROM analyses WHERE game_id = ?').get(gameId) as
    | { data_json: string }
    | undefined;
  return row ? (JSON.parse(row.data_json) as AnalysisData) : null;
}

export function listGames(): GameSummary[] {
  const rows = db
    .prepare(
      `SELECT g.*, a.white_accuracy, a.black_accuracy, a.white_rating, a.black_rating, a.movetime_ms
       FROM games g LEFT JOIN analyses a ON a.game_id = g.id
       ORDER BY g.created_at DESC`,
    )
    .all() as (GameRow & {
    white_accuracy: number | null;
    black_accuracy: number | null;
    white_rating: number | null;
    black_rating: number | null;
    movetime_ms: number | null;
  })[];

  return rows.map((row) => {
    const meta = JSON.parse(row.meta_json) as GameMeta;
    const moves = JSON.parse(row.moves_json) as MoveRecord[];
    return {
      id: row.id,
      source: row.source,
      sourceUrl: row.source_url,
      white: meta.white,
      black: meta.black,
      whiteElo: meta.whiteElo,
      blackElo: meta.blackElo,
      result: meta.result,
      date: meta.date,
      eco: meta.eco,
      opening: meta.opening,
      plyCount: moves.length,
      createdAt: row.created_at,
      analyzed: row.white_accuracy !== null,
      whiteAccuracy: row.white_accuracy ?? undefined,
      blackAccuracy: row.black_accuracy ?? undefined,
      whiteRating: row.white_rating ?? undefined,
      blackRating: row.black_rating ?? undefined,
      movetimeMs: row.movetime_ms ?? undefined,
    } satisfies GameSummary;
  });
}
