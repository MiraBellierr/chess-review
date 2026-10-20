// Mirrors server/src/types.ts — keep them in sync.

export type Label =
  | 'Brilliant'
  | 'Great'
  | 'Best'
  | 'Excellent'
  | 'Good'
  | 'Book'
  | 'Inaccuracy'
  | 'Mistake'
  | 'Miss'
  | 'Blunder'
  | 'Forced';

export const ALL_LABELS: Label[] = [
  'Brilliant',
  'Great',
  'Best',
  'Excellent',
  'Good',
  'Book',
  'Inaccuracy',
  'Mistake',
  'Miss',
  'Blunder',
  'Forced',
];

export type Phase = 'opening' | 'middlegame' | 'endgame';

export interface MoveRecord {
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  clockMs?: number;
  emtMs?: number;
  comment?: string;
  fenAfter: string;
}

export interface GameMeta {
  event?: string;
  site?: string;
  round?: string;
  date?: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  eco?: string;
  opening?: string;
}

export interface StoredGame {
  id: number;
  source: string;
  sourceUrl?: string | null;
  meta: GameMeta;
  startFen: string;
  moves: MoveRecord[];
  pgn: string;
  createdAt: number;
}

export interface EngineLine {
  cp?: number;
  mate?: number;
  pvUci: string[];
}

export interface PlyAnalysis {
  ply: number;
  san: string;
  uci: string;
  clockMs?: number;
  fenBefore: string;
  fenAfter: string;
  label: Label;
  excluded: boolean;
  cpBefore?: number;
  mateBefore?: number;
  cpAfter?: number;
  mateAfter?: number;
  winBefore: number;
  winAfter: number;
  winDrop: number;
  bestUci?: string;
  bestSan?: string;
  pvSan: string[];
  lines: EngineLine[];
  volatility?: number;
  offeredCp?: number;
  phase: Phase;
  emptySearch?: boolean;
  caption?: string;
}

export interface PlayerStats {
  accuracy: number;
  rating: number;
  phaseAccuracy: Record<Phase, number | null>;
  counts: Record<Label, number>;
}

export interface KeyMoment {
  ply: number;
  label: Label;
  caption: string;
  winSwing: number;
}

export interface AnalysisData {
  movetimeMs: number;
  multipv: number;
  engine?: string;
  depthReached?: number;
  createdAt: number;
  plies: PlyAnalysis[];
  white: PlayerStats;
  black: PlayerStats;
  keyMoments: KeyMoment[];
  opening?: { eco?: string; name?: string };
}

export interface GameSummary {
  id: number;
  source: string;
  sourceUrl?: string | null;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  date?: string;
  eco?: string;
  opening?: string;
  plyCount: number;
  createdAt: number;
  analyzed: boolean;
  whiteAccuracy?: number;
  blackAccuracy?: number;
  whiteRating?: number;
  blackRating?: number;
  movetimeMs?: number;
}

export interface ImportPreview {
  sourceUrl: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  date?: string;
  timeClass?: string;
  event?: string;
  eco?: string;
  opening?: string;
  pgn: string;
}

export interface EvalOutcome {
  lines: EngineLine[];
  bestUci?: string;
  depth: number;
  cancelled: boolean;
}

export interface Health {
  ok: boolean;
  engine: { available: boolean; path?: string; name?: string; error?: string };
  book: { loaded: boolean; lines: number };
}

export interface AppSettings {
  defaultMovetimeMs: number;
  threads: number;
  hashMb: number;
  enginePath?: string;
  lichessToken?: string;
  movetimeSteps: number[];
}

export const MOVETIME_STEPS = [250, 500, 1000, 1500, 2500, 4000, 6000, 10000];
