import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(SERVER_DIR, '..');
export const VENDOR_DIR = path.join(PROJECT_ROOT, 'vendor');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DB_PATH = process.env.CHESS_REVIEW_DB ?? path.join(DATA_DIR, 'chess-review.db');
export const BOOK_DIR = path.join(VENDOR_DIR, 'openings');
export const WEB_DIST = path.join(PROJECT_ROOT, 'web', 'dist');

export const PORT = Number(process.env.PORT ?? 3001);

export const DEFAULT_MOVETIME_MS = 250;
export const DEFAULT_MULTIPV = 3;
export const DEFAULT_THREADS = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
export const DEFAULT_HASH_MB = 256;

/** Search budget ladder exposed by the depth slider (ms per position). */
export const MOVETIME_STEPS = [250, 500, 1000, 1500, 2500, 4000, 6000, 10000];

export function resolveStockfishPath(): string | null {
  const candidates: string[] = [];
  if (process.env.STOCKFISH_PATH) candidates.push(process.env.STOCKFISH_PATH);
  candidates.push(path.join(VENDOR_DIR, 'stockfish', 'stockfish.exe'));
  candidates.push(path.join(VENDOR_DIR, 'stockfish', 'stockfish'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
