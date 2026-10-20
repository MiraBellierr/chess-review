import type { AnalysisData, Label, StoredGame } from './types.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const NAG_FOR_LABEL: Partial<Record<Label, number>> = {
  Brilliant: 3, // !!
  Great: 1, // !
  Inaccuracy: 6, // ?!
  Mistake: 2, // ?
  Miss: 2, // ?
  Blunder: 4, // ??
};

function evalComment(cp?: number, mate?: number): string | undefined {
  if (mate !== undefined) return `[%eval #${mate > 0 ? '' : '-'}${Math.abs(mate)}]`;
  if (cp !== undefined) {
    if (Math.abs(cp) >= 20000) return cp > 0 ? '[%eval #]' : '[%eval -#]';
    return `[%eval ${(cp / 100).toFixed(2)}]`;
  }
  return undefined;
}

function clockComment(clockMs?: number): string | undefined {
  if (clockMs === undefined) return undefined;
  const total = Math.floor(clockMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `[%clk ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
}

/** Wrap movetext at ~79 columns without splitting tokens. */
function fold(tokens: string[]): string {
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (line.length + tok.length + 1 > 79) {
      lines.push(line);
      line = tok;
    } else {
      line = line ? `${line} ${tok}` : tok;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function buildAnnotatedPgn(game: StoredGame, analysis: AnalysisData | null): string {
  const meta = game.meta;
  const tags: [string, string | undefined][] = [
    ['Event', meta.event || 'Chess Review'],
    ['Site', game.sourceUrl || meta.site || 'Local'],
    ['Date', meta.date || '????.??.??'],
    ['Round', meta.round || '-'],
    ['White', meta.white],
    ['Black', meta.black],
    ['Result', meta.result],
    ['WhiteElo', meta.whiteElo?.toString()],
    ['BlackElo', meta.blackElo?.toString()],
    ['ECO', analysis?.opening?.eco || meta.eco],
    ['Opening', analysis?.opening?.name || meta.opening],
    ['Annotator', 'Chess Review (Stockfish)'],
  ];

  const head: string[] = [];
  for (const [key, value] of tags) {
    if (value) head.push(`[${key} "${String(value).replace(/"/g, "'")}"]`);
  }
  if (game.startFen !== START_FEN) {
    head.push('[SetUp "1"]');
    head.push(`[FEN "${game.startFen}"]`);
  }

  const tokens: string[] = [];
  // Move numbers come from the position, so a FEN start (black to move) still
  // exports valid PGN.
  let moveNo = Number(game.startFen.split(' ')[5]) || 1;
  let whiteToMove = game.startFen.split(' ')[1] !== 'b';
  game.moves.forEach((move, i) => {
    const ply = analysis?.plies[i];
    if (whiteToMove) tokens.push(`${moveNo}.`);
    else if (i === 0) tokens.push(`${moveNo}...`);
    tokens.push(move.san);

    if (whiteToMove) whiteToMove = false;
    else {
      whiteToMove = true;
      moveNo++;
    }

    const commentParts = [
      evalComment(ply?.cpAfter, ply?.mateAfter),
      clockComment(move.clockMs),
      ply?.label && !['Best', 'Excellent', 'Good', 'Book', 'Forced'].includes(ply.label) ? ply.label : undefined,
      ply?.caption,
    ].filter(Boolean);

    const nag = ply ? NAG_FOR_LABEL[ply.label] : undefined;
    if (nag) tokens.push(`$${nag}`);
    if (commentParts.length > 0) tokens.push(`{${commentParts.join(' ')}}`);
  });

  if (!tokens.includes(meta.result)) tokens.push(meta.result || '*');

  return `${head.join('\n')}\n\n${fold(tokens)}\n`;
}
