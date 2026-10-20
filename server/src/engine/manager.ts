import { resolveStockfishPath } from '../config.js';
import { getSettings } from '../db.js';
import { Stockfish } from './stockfish.js';
import type { EngineLine } from '../types.js';

export class EngineUnavailableError extends Error {}

export interface EvalOptions {
  movetimeMs: number;
  multipv?: number;
  depth?: number;
}

export interface EvalOutcome {
  lines: EngineLine[]; // white POV
  bestUci?: string;
  depth: number;
  cancelled: boolean;
}

class EngineManager {
  private engine: Stockfish | null = null;
  private engineKey = '';

  private settingsKey(settings: { threads: number; hashMb: number }, path: string): string {
    return `${path}|${settings.threads}|${settings.hashMb}`;
  }

  /** Returns a live engine, restarting it when settings change. */
  private ensure(): Stockfish {
    const settings = getSettings();
    const path = settings.enginePath || resolveStockfishPath();
    if (!path) {
      throw new EngineUnavailableError(
        'Stockfish binary not found. Run "npm run setup" (or set STOCKFISH_PATH) and restart the server.',
      );
    }
    const key = this.settingsKey(settings, path);
    if (!this.engine || key !== this.engineKey) {
      this.engine?.kill();
      this.engine = new Stockfish({ path, threads: settings.threads, hashMb: settings.hashMb });
      this.engineKey = key;
    }
    return this.engine;
  }

  async evalPosition(fen: string, opts: EvalOptions): Promise<EvalOutcome> {
    const engine = this.ensure();
    const raw = await engine.analyze(fen, opts);
    const side = fen.split(/\s+/)[1] === 'b' ? -1 : 1;
    const lines: EngineLine[] = raw.lines.map((l) => ({
      cp: l.cp !== undefined ? l.cp * side : undefined,
      mate: l.mate !== undefined ? l.mate * side : undefined,
      pvUci: l.pvUci,
    }));
    return { lines, bestUci: raw.bestUci, depth: raw.depth, cancelled: raw.cancelled };
  }

  cancelInFlight(): void {
    this.engine?.cancelInFlight();
  }

  /** Kill the engine process (used by the CLI and on shutdown). */
  shutdown(): void {
    this.engine?.kill();
    this.engine = null;
  }

  async status(): Promise<{ available: boolean; path?: string; name?: string; error?: string }> {
    try {
      const engine = this.ensure();
      await engine.start();
      const settings = getSettings();
      return { available: true, path: settings.enginePath || resolveStockfishPath() || undefined, name: engine.name };
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const engineManager = new EngineManager();
