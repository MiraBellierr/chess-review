import type {
  AnalysisData,
  AppSettings,
  EvalOutcome,
  GameSummary,
  Health,
  ImportPreview,
  PlyAnalysis,
  StoredGame,
} from './types';

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string } | null)?.error ?? `Request failed (HTTP ${res.status}).`,
      res.status,
      data,
    );
  }
  return data as T;
}

export const apiGet = <T>(path: string): Promise<T> => fetch(path).then(jsonOrThrow<T>);

export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(jsonOrThrow<T>);

export const apiPut = <T>(path: string, body: unknown): Promise<T> =>
  fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(jsonOrThrow<T>);

export const apiDelete = <T>(path: string): Promise<T> =>
  fetch(path, { method: 'DELETE' }).then(jsonOrThrow<T>);

// ------------------------------------------------------------------ typed --

export interface LibraryResponse {
  games: GameSummary[];
}

export interface GameDetailResponse {
  game: StoredGame;
  analysis: AnalysisData | null;
}

export interface ParsePreview {
  index: number;
  white?: string;
  black?: string;
  whiteElo?: number;
  blackElo?: number;
  result?: string;
  date?: string;
  eco?: string;
  opening?: string;
  plyCount?: number;
  error?: string;
}

export const getLibrary = () => apiGet<LibraryResponse>('/api/library');
export const getGame = (id: number) => apiGet<GameDetailResponse>(`/api/games/${id}`);
export const deleteGame = (id: number) => apiDelete<{ ok: boolean }>(`/api/games/${id}`);
export const getHealth = () => apiGet<Health>('/api/health');
export const getSettings = () => apiGet<AppSettings>('/api/settings');
export const putSettings = (patch: Partial<AppSettings>) => apiPut<AppSettings>('/api/settings', patch);
export const parsePgn = (pgn: string) => apiPost<{ games: ParsePreview[] }>('/api/parse', { pgn });
export const storeGame = (body: { pgn: string; source: string; sourceUrl?: string; gameIndex?: number }) =>
  apiPost<{ id: number; summary: GameSummary }>('/api/games', body);
export const importChessCom = (username: string) =>
  apiGet<{ games: ImportPreview[] }>(`/api/import/chesscom?username=${encodeURIComponent(username)}`);
export const importLichess = (username: string) =>
  apiGet<{ games: ImportPreview[] }>(`/api/import/lichess?username=${encodeURIComponent(username)}`);
export const evalFen = (fen: string, movetimeMs = 1200) =>
  apiGet<EvalOutcome>(`/api/eval?fen=${encodeURIComponent(fen)}&movetime=${movetimeMs}&multipv=3`);

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}
export interface ExplorerData {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  opening?: { eco?: string; name?: string } | null;
}
export const getExplorer = (fen: string, db: 'masters' | 'lichess') =>
  apiGet<ExplorerData>(`/api/explore?fen=${encodeURIComponent(fen)}&db=${db}`);

export interface BookMove {
  uci: string;
  san: string;
  count: number;
  eco?: string;
  name?: string;
  depth: number;
}
export interface BookData {
  moves: BookMove[];
  total: number;
  eco?: string;
  name?: string;
}
/** Offline explorer backed by the bundled ECO book. */
export const getBook = (fen: string) => apiGet<BookData>(`/api/book?fen=${encodeURIComponent(fen)}`);

// -------------------------------------------------------------------- SSE --

export interface AnalysisStreamHandlers {
  onStarted?: (data: { gameId: number; movetimeMs: number; plies: number }) => void;
  onProgress?: (data: { done: number; total: number; ply?: PlyAnalysis }) => void;
  onDone?: (data: { gameId: number; elapsedMs: number; whiteAccuracy: number; blackAccuracy: number }) => void;
  onError?: (message: string) => void;
}

/** Opens the analysis SSE stream. Returns a close function. */
export function openAnalysisStream(gameId: number, movetimeMs: number, handlers: AnalysisStreamHandlers): () => void {
  const es = new EventSource(`/api/games/${gameId}/analyze?movetime=${movetimeMs}`);
  let closed = false;

  es.addEventListener('started', (e) => {
    try {
      handlers.onStarted?.(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('progress', (e) => {
    try {
      handlers.onProgress?.(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('done', (e) => {
    try {
      handlers.onDone?.(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore */
    }
    if (!closed) {
      closed = true;
      es.close();
    }
  });
  es.addEventListener('error', (e) => {
    const data = (e as MessageEvent).data;
    if (data) {
      try {
        handlers.onError?.(JSON.parse(data).message ?? 'Analysis failed.');
      } catch {
        handlers.onError?.('Analysis failed.');
      }
    } else {
      handlers.onError?.('Lost connection to the server during analysis.');
    }
    if (!closed) {
      closed = true;
      es.close();
    }
  });

  return () => {
    if (!closed) {
      closed = true;
      es.close();
    }
  };
}
