import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface RawLine {
  multipv: number;
  depth: number;
  cp?: number; // side-to-move POV
  mate?: number; // side-to-move POV
  pvUci: string[];
}

export interface RawEval {
  lines: RawLine[];
  bestUci?: string;
  depth: number;
  cancelled: boolean;
}

export interface StockfishOptions {
  path: string;
  threads: number;
  hashMb: number;
}

interface SearchState {
  lines: Map<number, RawLine>;
  maxDepth: number;
  stopped: boolean;
  done: { resolve: (best?: string) => void } | null;
}

/**
 * Minimal, robust UCI wrapper for Stockfish. All calls are serialized
 * through an internal queue: one search runs at a time.
 */
export class Stockfish {
  name = '';
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: {
    pred: (line: string) => boolean;
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private search: SearchState | null = null;
  private multipv = 0;
  private closing = false;

  constructor(private opts: StockfishOptions) {}

  private send(cmd: string): void {
    this.proc?.stdin.write(cmd + '\n');
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private handleLine(line: string): void {
    if (line.startsWith('id name ')) {
      this.name = line.slice('id name '.length).trim();
      return;
    }
    if (this.pending && this.pending.pred(line)) {
      const { resolve, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      resolve(line);
      return;
    }
    if (!this.search) return;

    if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      const best = parts[1] && parts[1] !== '(none)' ? parts[1] : undefined;
      const done = this.search.done;
      this.search.done = null;
      done?.resolve(best);
      return;
    }
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const tokens = line.split(/\s+/);
      let depth = 0;
      let multipv = 1;
      let cp: number | undefined;
      let mate: number | undefined;
      let bound = false;
      let pv: string[] | null = null;
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === 'depth') depth = Number(tokens[++i]);
        else if (t === 'multipv') multipv = Number(tokens[++i]);
        else if (t === 'score' && tokens[i + 1] === 'cp') {
          cp = Number(tokens[i + 2]);
          i += 2;
        } else if (t === 'score' && tokens[i + 1] === 'mate') {
          mate = Number(tokens[i + 2]);
          i += 2;
        } else if (t === 'lowerbound' || t === 'upperbound') bound = true;
        else if (t === 'pv') {
          pv = tokens.slice(i + 1);
          break;
        }
      }
      if (bound || !pv || pv.length === 0 || !Number.isFinite(depth)) return;
      this.search.lines.set(multipv, { multipv, depth, cp, mate, pvUci: pv });
      if (depth > this.search.maxDepth) this.search.maxDepth = depth;
    }
  }

  private failAll(err: Error): void {
    if (this.pending) {
      const { reject, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      reject(err);
    }
    if (this.search?.done) {
      const done = this.search.done;
      this.search.done = null;
      done.resolve(undefined);
    }
  }

  private expectLine(pred: (line: string) => boolean, timeoutMs: number, kick?: () => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Stockfish did not respond in time.'));
      }, timeoutMs);
      this.pending = { pred, resolve, reject, timer };
      if (kick) kick();
    });
  }

  async start(): Promise<void> {
    if (this.proc || this.closing) return;
    const proc = spawn(this.opts.path, [], { windowsHide: true });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', () => undefined);
    let buf = '';
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '').trim();
        buf = buf.slice(i + 1);
        if (line) this.handleLine(line);
      }
    });
    proc.on('error', (err) => {
      this.proc = null;
      this.failAll(new Error(`Stockfish failed to start (${this.opts.path}): ${err.message}`));
    });
    proc.on('exit', () => {
      this.proc = null;
      if (!this.closing) this.failAll(new Error('Stockfish process exited unexpectedly.'));
    });

    await this.expectLine((l) => l === 'uciok', 10000, () => this.send('uci'));
    this.send(`setoption name Threads value ${this.opts.threads}`);
    this.send(`setoption name Hash value ${this.opts.hashMb}`);
    await this.isReady();
    // A fresh engine: clear the remembered MultiPV so the next analyze() sets it.
    this.multipv = 0;
    if (!this.name) this.name = 'Stockfish';
  }

  private isReady(): Promise<string> {
    return this.expectLine((l) => l === 'readyok', 10000, () => this.send('isready'));
  }

  ready(): boolean {
    return this.proc !== null;
  }

  private async setMultipv(n: number): Promise<void> {
    if (this.multipv === n) return;
    this.send(`setoption name MultiPV value ${n}`);
    await this.isReady();
    this.multipv = n;
  }

  analyze(
    fen: string,
    opts: { movetimeMs?: number; depth?: number; multipv?: number },
  ): Promise<RawEval> {
    return this.enqueue(async () => {
      await this.start();
      await this.setMultipv(opts.multipv ?? 3);

      const state: SearchState = { lines: new Map(), maxDepth: 0, stopped: false, done: null };
      this.search = state;
      this.send(`position fen ${fen}`);

      const resultPromise = new Promise<string | undefined>((resolve) => {
        state.done = { resolve };
      });

      const budgetMs = opts.depth ? 60000 : Math.max(50, opts.movetimeMs ?? 250);
      const hardTimeout = setTimeout(() => this.send('stop'), budgetMs + 5000);

      this.send(opts.depth ? `go depth ${opts.depth}` : `go movetime ${Math.round(budgetMs)}`);

      try {
        const bestUci = await resultPromise;
        return {
          lines: [...state.lines.values()].sort((a, b) => a.multipv - b.multipv),
          bestUci,
          depth: state.maxDepth,
          cancelled: state.stopped,
        };
      } finally {
        clearTimeout(hardTimeout);
        if (this.search === state) this.search = null;
      }
    });
  }

  /** Ask the engine to stop the currently running search (resolves as cancelled). */
  cancelInFlight(): void {
    if (this.search) {
      this.search.stopped = true;
      this.send('stop');
    }
  }

  kill(): void {
    this.closing = true;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try {
        proc.stdin.write('quit\n');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, 300);
    }
  }
}
