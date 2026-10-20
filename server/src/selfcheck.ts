/**
 * Self-check for the parts of the analysis pipeline that are pure logic and easy
 * to regress: sacrifice detection, the label decision tree, accuracy/rating maths
 * and PGN parsing. Run with `npm run selfcheck`.
 *
 * These are the same rules a full review uses, exercised without the engine.
 */
import { Chess } from 'chess.js';
import { classifyMove, THRESHOLDS } from './analysis/classify.js';
import { computeAccuracy, estimateRating, moveAccuracyPct } from './analysis/accuracy.js';
import { concededMaterialCp, materialBalance } from './analysis/see.js';
import { parsePgnGame } from './analysis/pgn.js';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

/** Play a SAN line from the standard start and hand back the position before each move. */
function line(sans: string[]): { fenBefore: string; san: string; fenAfter: string }[] {
  const chess = new Chess();
  const out: { fenBefore: string; san: string; fenAfter: string }[] = [];
  for (const san of sans) {
    const fenBefore = chess.fen();
    chess.move(san);
    out.push({ fenBefore, san, fenAfter: chess.fen() });
  }
  return out;
}

/** Material the mover would concede, as the orchestrator computes it. */
function conceded(step: { fenBefore: string; san: string; fenAfter: string }): number {
  const chess = new Chess(step.fenBefore);
  const move = chess.move(step.san);
  return concededMaterialCp(step.fenBefore, step.fenAfter, move.to, step.fenBefore.split(' ')[1] !== 'b');
}

console.log('\nSacrifice detection (concededMaterialCp)');
{
  // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.d3 b5 7.Bb3 d6 8.Nc3 O-O
  // 9.Bg5 h6 10.Bh4 Re8 11.Nd5 — then Black recaptures: a plain trade.
  const ruy: string[] = [
    'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7',
    'd3', 'b5', 'Bb3', 'd6', 'Nc3', 'O-O', 'Bg5', 'h6', 'Bh4', 'Re8', 'Nd5',
  ];
  const steps = line(ruy);
  const trade = conceded(line([...ruy, 'Nxd5']).at(-1)!);
  check('knight recapture is not a sacrifice', trade < THRESHOLDS.brilliantMinOfferedCp, true);

  // ...Bxe7 Rxe7: a defended capture, also not a sacrifice.
  const bishopTrade = conceded(line([...ruy, 'Nxd5', 'Bxd5', 'Qd7', 'Bxe7']).at(-1)!);
  check('defended bishop capture is not a sacrifice', bishopTrade < THRESHOLDS.brilliantMinOfferedCp, true);

  // Morphy's 10.Nxb5: a pawn is offered for the knight — a real sacrifice.
  const opera = line(['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5']);
  const gambit = conceded(opera.at(-1)!);
  check('Nxb5 concedes at least a pawn', gambit >= THRESHOLDS.brilliantMinOfferedCp, true);

  // A knight thrown onto a defended square with no compensation.
  const sac = conceded(line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7']).at(-1)!);
  check('Nxf7 concedes a piece', sac >= 200, true);

  check('quiet move concedes nothing', conceded(line(['e4']).at(-1)!), 0);
  check('material balance ignores kings', materialBalance(new Chess().fen()), 0);
}

console.log('\nLabel decision tree');
{
  const base: Parameters<typeof classifyMove>[0] = {
    legalMoveCount: 30,
    isBook: false,
    playedUci: 'e2e4',
    bestUci: 'e2e4',
    winBefore: 60,
    winAfter: 60,
    winAltBest: 55,
    offeredCp: 0,
  };
  const label = (over: Partial<typeof base>) => classifyMove({ ...base, ...over });

  check('a move the engine did not choose is not tested for Brilliant', label({ bestUci: 'd2d4' }).label, 'Excellent');
  check('only legal move is Forced and excluded', label({ legalMoveCount: 1 }), {
    label: 'Forced',
    excluded: true,
    missedMate: false,
  });
  check('theory is Book and excluded', label({ isBook: true }), { label: 'Book', excluded: true, missedMate: false });
  check('engine move with no concession is Best', label({}).label, 'Best');
  check(
    'engine move that concedes a pawn is Brilliant',
    label({ offeredCp: 100, winBefore: 55, winAfter: 55 }).label,
    'Brilliant',
  );
  check(
    'no Brilliant when already winning',
    label({ offeredCp: 100, winBefore: 90, winAfter: 90, winAltBest: 88 }).label,
    'Best',
  );
  check('no Brilliant when it concedes nothing', label({ offeredCp: 90 }).label, 'Best');
  check('clearly superior move is Great', label({ winAltBest: 40 }).label, 'Great');
  check('small gap is Best', label({ winAltBest: 55 }).label, 'Best');
  check('quiet non-best move that keeps the edge is Excellent', label({ bestUci: 'd2d4' }).label, 'Excellent');
  check(
    'was winning then not is Miss',
    label({ bestUci: 'd2d4', winBefore: 70, winAfter: 40 }).label,
    'Miss',
  );
  check(
    'mate thrown away is Miss',
    label({ bestUci: 'd2d4', mateBefore: 3, winBefore: 99, winAfter: 90 }).label,
    'Miss',
  );
  check('tiny loss is Excellent', label({ bestUci: 'd2d4', winBefore: 60, winAfter: 59 }).label, 'Excellent');
  check('middling loss is Good', label({ bestUci: 'd2d4', winBefore: 60, winAfter: 57 }).label, 'Good');
  check('noticeable loss is Inaccuracy', label({ bestUci: 'd2d4', winBefore: 60, winAfter: 54 }).label, 'Inaccuracy');
  check('big loss is Mistake', label({ bestUci: 'd2d4', winBefore: 60, winAfter: 48 }).label, 'Mistake');
  check('huge loss is Blunder', label({ bestUci: 'd2d4', winBefore: 60, winAfter: 30 }).label, 'Blunder');
}

console.log('\nAccuracy and rating');
{
  check('a flawless move scores 100%', Math.round(moveAccuracyPct(0) * 10) / 10, 100);
  check('accuracy is monotone in the loss', moveAccuracyPct(5) > moveAccuracyPct(20), true);
  check('perfect game is ~100%', Math.round(computeAccuracy([{ winDrop: 0, weight: 1 }]) ?? 0), 100);
  check(
    'noise-level losses still read 100%',
    Math.round(computeAccuracy([{ winDrop: 0.4, weight: 1 }, { winDrop: 1, weight: 1 }]) ?? 0),
    100,
  );
  const withInaccuracy = computeAccuracy([
    ...Array.from({ length: 20 }, () => ({ winDrop: 0, weight: 1 })),
    { winDrop: 6, weight: 1 },
  ]);
  check(
    'an inaccuracy keeps the game strictly under 100%',
    (withInaccuracy ?? 100) < 100 && (withInaccuracy ?? 0) > 95,
    true,
  );
  check('no counted moves means no accuracy', computeAccuracy([]), null);
  const mixed = computeAccuracy([
    { winDrop: 0, weight: 1 },
    { winDrop: 0, weight: 1 },
    { winDrop: 25, weight: 1 },
  ]);
  check('one blunder drags accuracy down', (mixed ?? 100) < 85 && (mixed ?? 0) > 60, true);
  check('rating anchors are monotone', estimateRating(50) < estimateRating(70) && estimateRating(70) < estimateRating(95), true);
  check('rating stays in range', [estimateRating(0) >= 100, estimateRating(100) <= 2900], [true, true]);
}

console.log('\nPGN parsing');
{
  const pgn = `[Event "T"]
[White "A"]
[Black "B"]
[Result "1-0"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"]
[SetUp "1"]

2... Nc6 3. Bb5 a6 {[%clk 0:02:58]} 1-0`;
  const parsed = parsePgnGame(pgn);
  check('FEN start is honoured', parsed.startFen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  check('first move is black’s', parsed.moves[0].san, 'Nc6');
  check('move after it is white’s', parsed.moves[1].san, 'Bb5');
  check('clock comments are parsed', parsed.moves[2].clockMs, 178000);
  check('black starts on move 2', Number(parsed.startFen.split(' ')[5]), 2);

  // A clock comment annotates the move it follows, not the next one.
  const timed = parsePgnGame(`[Result "*"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} 2. Nf3 {[%clk 0:09:56]} *`);
  check('clocks land on their own moves', timed.moves.map((m) => m.clockMs), [598000, 597000, 596000]);
  check('move text is kept as a comment', timed.moves.map((m) => m.comment), [undefined, undefined, undefined]);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
