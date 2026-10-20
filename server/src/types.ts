// Shared server-side types. A mirrored copy lives in web/src/types.ts — keep them in sync.

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
  uci: string; // e.g. "e2e4", "e7e8q"
  from: string;
  to: string;
  promotion?: string;
  clockMs?: number;
  emtMs?: number; // elapsed move time, when present
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
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
  eco?: string;
  opening?: string;
}

export interface StoredGame {
  id: number;
  source: string; // 'pgn' | 'chesscom' | 'lichess'
  sourceUrl?: string | null;
  meta: GameMeta;
  startFen: string;
  moves: MoveRecord[];
  pgn: string;
  createdAt: number;
}

/** One engine candidate line. Scores are stored from WHITE's point of view. */
export interface EngineLine {
  cp?: number; // centipawns, white POV
  mate?: number; // mate in N plies-ish (engine's convention), white POV (positive = white mates)
  pvUci: string[];
}

export interface PlyAnalysis {
  ply: number; // 0-based; ply 0 = white's first move
  san: string;
  uci: string;
  clockMs?: number;
  fenBefore: string;
  fenAfter: string;
  label: Label;
  /** Excluded moves (Book / Forced) don't count toward accuracy. */
  excluded: boolean;
  /** White-POV evaluations. */
  cpBefore?: number;
  mateBefore?: number;
  cpAfter?: number;
  mateAfter?: number;
  /** Win percentages, white POV (0 = black winning, 100 = white winning). */
  winBefore: number;
  winAfter: number;
  /** Win% drop from the mover's point of view (used for accuracy). */
  winDrop: number;
  bestUci?: string;
  bestSan?: string;
  /** SAN sequence of the top engine line from this position. */
  pvSan: string[];
  /** Engine candidate lines (white POV), up to MultiPV. */
  lines: EngineLine[];
  /** Game phase this move belongs to (patched after all plies are classified). */
  phase: Phase;
  /** Short human-readable note ("Missed a forced mate in 2.") for key moments. */
  caption?: string;
  /** How sharp the position was (stddev of candidate win%), used as accuracy weight. */
  volatility?: number;
  /** Material (in centipawns) the mover puts at risk — used for Brilliant detection. */
  offeredCp?: number;
  emptySearch?: boolean; // true when the position was terminal and no search ran
}

export interface LabelCounts {
  [label: string]: number;
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
  winSwing: number; // absolute win% change of the move, mover POV
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
