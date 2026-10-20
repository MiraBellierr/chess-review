import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { evalFen, getGame, getSettings, openAnalysisStream } from '../api';
import type { AnalysisData, EvalOutcome, PlyAnalysis, StoredGame } from '../types';
import { BoardPanel, type FigureInfo } from '../components/BoardPanel';
import { MoveList } from '../components/MoveList';
import { EvalGraph } from '../components/EvalGraph';
import { SummaryCards } from '../components/SummaryCards';
import { KeyMoments } from '../components/KeyMoments';
import { OpeningExplorer } from '../components/OpeningExplorer';
import { DepthSlider } from '../components/DepthSlider';
import { Icon } from '../components/Icons';
import { arrowsFromUci, fmtMovetime, moveNo, scoreText, uciLineToSan, whitePovWin, winFromScore } from '../util';
import { altLineAccuracy, deriveAltMove, type AltMove } from '../altLine';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Stable empty arrow list: a fresh array would wipe the user's right-click arrows. */
const NO_ARROWS: string[][] = [];

/**
 * The line being played on the board. It is page state only: the moves are
 * judged from engine evals as they land and never written to the database.
 */
interface ExploreState {
  /** Position on the board. */
  fen: string;
  /** Its engine eval, white POV — null until the search lands. */
  eval: EvalOutcome | null;
  error?: string;
  /** Position the line branched from, for move numbering. */
  baseFen: string;
  /** Game ply the line branched from — board move numbers are basePly + cursor. */
  basePly: number;
  baseEval: EvalOutcome | null;
  /** Moves played in this line, oldest first. */
  moves: AltMove[];
  /** How many of them are on the board — 0 is the branch point. */
  cursor: number;
}

/** Fold a fresh engine eval into whichever part of the line it belongs to. */
function applyEval(prev: ExploreState, fen: string, outcome: EvalOutcome): ExploreState {
  let next: ExploreState = prev;
  if (prev.fen === fen) next = { ...next, eval: outcome, error: undefined };
  if (prev.baseFen === fen) next = { ...next, baseEval: outcome };

  let touched = false;
  const moves = next.moves.map((move) => {
    if (move.fenBefore !== fen && move.fenAfter !== fen) return move;
    touched = true;
    return deriveAltMove({
      ...move,
      beforeEval: move.fenBefore === fen ? outcome : move.beforeEval,
      afterEval: move.fenAfter === fen ? outcome : move.afterEval,
    });
  });
  return touched ? { ...next, moves } : next;
}

/**
 * The line showing the position after `cursor` moves, clamped to its ends.
 * Stepping is pure state: the evals travel with the move they belong to, and a
 * position whose eval never landed is picked up by the board's eval effect.
 */
function altStateAt(line: ExploreState, cursor: number): ExploreState {
  const at = Math.max(0, Math.min(line.moves.length, Math.round(cursor)));
  const move = at > 0 ? line.moves[at - 1] : null;
  return {
    ...line,
    cursor: at,
    fen: move ? move.fenAfter : line.baseFen,
    eval: move ? move.afterEval : line.baseEval,
    error: undefined,
  };
}

export default function Review() {
  const { id } = useParams();
  const gameId = Number(id);
  const [searchParams] = useSearchParams();

  const [game, setGame] = useState<StoredGame | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [tab, setTab] = useState<'moves' | 'explorer'>('moves');
  const [pane, setPane] = useState<'review' | 'moves'>('review');
  const [explore, setExplore] = useState<ExploreState | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [streamPlies, setStreamPlies] = useState<PlyAnalysis[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const closeStreamRef = useRef<(() => void) | null>(null);

  const [movetimeMs, setMovetimeMs] = useState(250);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const autoStartedRef = useRef(false);

  // ------------------------------------------------------------ load ----

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.allSettled([getGame(gameId), getSettings()]).then(([gameRes, settingsRes]) => {
      if (cancelled) return;
      if (gameRes.status === 'fulfilled') {
        setGame(gameRes.value.game);
        setAnalysis(gameRes.value.analysis);
        setPly(gameRes.value.analysis ? Math.min(1, gameRes.value.game.moves.length) : 0);
        setMovetimeMs(
          gameRes.value.analysis?.movetimeMs ??
            (settingsRes.status === 'fulfilled' ? settingsRes.value.defaultMovetimeMs : 250),
        );
      } else {
        setError(gameRes.reason instanceof Error ? gameRes.reason.message : 'Could not load the game.');
      }
      setSettingsLoaded(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(
    () => () => {
      closeStreamRef.current?.();
    },
    [],
  );

  // ------------------------------------------------------- analysis ----

  const startAnalysis = useCallback(
    (movetime: number) => {
      if (!game) return;
      closeStreamRef.current?.();
      setExplore(null);
      setError(null);
      setAnalysis(null);
      setStreamPlies([]);
      setStreaming(true);
      setProgress({ done: 0, total: game.moves.length + 1 });
      closeStreamRef.current = openAnalysisStream(game.id, movetime, {
        onStarted: (d) => setProgress({ done: 0, total: d.plies + 1 }),
        onProgress: (d) => {
          setProgress({ done: d.done, total: d.total });
          if (d.ply) setStreamPlies((prev) => [...prev, d.ply as PlyAnalysis]);
        },
        onDone: () => {
          void (async () => {
            try {
              const fresh = await getGame(game.id);
              setAnalysis(fresh.analysis);
            } catch {
              /* keep streamed state; a refresh will recover */
            }
            setStreaming(false);
            setProgress(null);
            setStreamPlies([]);
          })();
        },
        onError: (message) => {
          setStreaming(false);
          setProgress(null);
          setError(message);
        },
      });
    },
    [game],
  );

  useEffect(() => {
    if (autoStartedRef.current || !game || !settingsLoaded) return;
    if (searchParams.get('auto') === '1' && !analysis && !streaming) {
      autoStartedRef.current = true;
      startAnalysis(movetimeMs);
    }
  }, [game, settingsLoaded, analysis, streaming, searchParams, movetimeMs, startAnalysis]);

  // ------------------------------------------------------- position ----

  const moves = game?.moves ?? [];
  const plies = analysis?.plies ?? streamPlies;
  const currentMove = ply > 0 ? moves[ply - 1] : undefined;
  const currentFen = explore ? explore.fen : ply === 0 ? game?.startFen ?? START_FEN : moves[ply - 1]?.fenAfter ?? START_FEN;
  const currentPlyAnalysis = ply > 0 ? plies[ply - 1] : undefined;

  const selectPly = useCallback(
    (next: number) => {
      setExplore(null);
      setPly(Math.max(0, Math.min(moves.length, next)));
    },
    [moves.length],
  );

  // -------------------------------------------------------- explore ----

  // Evals are queued rather than fired blind: the position a move creates is
  // searched first, and if its "before" position was never searched (fast play,
  // or the first move out of the game) that search follows, so the move can
  // still be judged.
  const evalQueueRef = useRef<string[]>([]);
  const evalQueuedRef = useRef<Set<string>>(new Set());
  const evalBusyRef = useRef(false);

  const pumpEvals = useCallback(function pump() {
    if (evalBusyRef.current) return;
    const fen = evalQueueRef.current.shift();
    if (!fen) return;
    evalQueuedRef.current.delete(fen);
    evalBusyRef.current = true;
    evalFen(fen, 1200)
      .then((outcome) => {
        setExplore((prev) => (prev ? applyEval(prev, fen, outcome) : prev));
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Engine error.';
        setExplore((prev) => (prev && prev.fen === fen ? { ...prev, error: message } : prev));
      })
      .finally(() => {
        evalBusyRef.current = false;
        pump();
      });
  }, []);

  const enqueueEval = useCallback(
    (fen: string) => {
      if (evalQueuedRef.current.has(fen)) return;
      evalQueuedRef.current.add(fen);
      evalQueueRef.current.push(fen);
      if (!evalBusyRef.current) pumpEvals();
    },
    [pumpEvals],
  );

  // Whatever is on the board always wants an engine eval of its own.
  useEffect(() => {
    if (explore && !explore.eval && !explore.error) enqueueEval(explore.fen);
  }, [explore, enqueueEval]);

  const toggleExplore = useCallback(() => {
    if (explore) {
      setExplore(null);
      return;
    }
    const fen = currentFen;
    setExplore({ fen, eval: null, baseFen: fen, basePly: ply, baseEval: null, moves: [], cursor: 0 });
  }, [explore, currentFen, ply]);

  const playUserMove = useCallback(
    (from: string, to: string, promotion?: string) => {
      const line = explore;
      const shownFen = line ? line.fen : currentFen;
      const chess = new Chess(shownFen);
      let move: Move;
      try {
        move = chess.move({ from, to, promotion: promotion ?? 'q' });
      } catch {
        return false;
      }
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;

      // Playing the line's own next move just walks forward along it.
      if (line && line.cursor < line.moves.length && line.moves[line.cursor].uci === uci) {
        setExplore(altStateAt(line, line.cursor + 1));
        return true;
      }

      // Playing the game's own move just moves the review on; anything else is a
      // line of your own, judged on the spot.
      if (!line && ply < moves.length && moves[ply].uci === uci) {
        selectPly(ply + 1);
        return true;
      }

      const nextFen = chess.fen();
      const kept = line ? line.moves.slice(0, line.cursor) : [];
      const beforeEval = line?.eval ?? null;
      setExplore({
        fen: nextFen,
        eval: null,
        error: undefined,
        baseFen: line ? line.baseFen : shownFen,
        basePly: line ? line.basePly : ply,
        baseEval: line ? line.baseEval : null,
        moves: [
          ...kept,
          {
            san: move.san,
            uci,
            from: move.from,
            to: move.to,
            fenBefore: shownFen,
            fenAfter: nextFen,
            beforeEval,
            afterEval: null,
          },
        ],
        cursor: kept.length + 1,
      });
      enqueueEval(nextFen);
      if (!beforeEval) enqueueEval(shownFen);
      return true;
    },
    [explore, currentFen, ply, moves, selectPly, enqueueEval],
  );

  const handleExplorerPlay = useCallback(
    (uci: string) => {
      playUserMove(uci.slice(0, 2), uci.slice(2, 4), uci.length > 4 ? uci.slice(4, 5) : undefined);
    },
    [playUserMove],
  );

  /** Show the position after move `index` of the explored line (`-1` = the branch point). */
  const selectAltMove = useCallback((index: number) => {
    setExplore((prev) => (prev ? altStateAt(prev, index + 1) : prev));
  }, []);

  /** Step one position back (-1) or forward along the line. The ends clamp. */
  const stepAlt = useCallback((delta: number) => {
    setExplore((prev) => (prev ? altStateAt(prev, prev.cursor + delta) : prev));
  }, []);

  /** Board navigation while the line is on the board — the target is a game ply. */
  const navigateAlt = useCallback((worldPly: number) => {
    setExplore((prev) => (prev ? altStateAt(prev, worldPly - prev.basePly) : prev));
  }, []);

  // Keyboard: once the line has a move on the board the arrows walk the line
  // (clamped at both ends); otherwise they move through the game, which leaves
  // the line as before. The explore button is the way out of the line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (explore && explore.moves.length > 0) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          stepAlt(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          stepAlt(1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          navigateAlt(0); // clamps to the branch point
        } else if (e.key === 'End') {
          e.preventDefault();
          navigateAlt(explore.basePly + explore.moves.length);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectPly(ply - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectPly(ply + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        selectPly(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        selectPly(moves.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explore, ply, moves.length, selectPly, stepAlt, navigateAlt]);

  // ---------------------------------------------------------- derived ----

  /** The explored move currently on the board, if any. */
  const exploreMove = explore && explore.cursor > 0 ? explore.moves[explore.cursor - 1] : undefined;
  const explorePending = !!explore && !explore.eval && !explore.error;

  /** Board-control coordinates: while the line has moves the board walks it. */
  const walkingLine = explore !== null && explore.moves.length > 0;
  const boardPly = walkingLine ? explore.basePly + explore.cursor : ply;
  const boardTotal = walkingLine ? explore.basePly + explore.moves.length : moves.length;

  const { winPct, evalText } = useMemo(() => {
    if (explore) {
      const line = explore.eval?.lines[0];
      if (line) return { winPct: winFromScore(line), evalText: scoreText(line.cp, line.mate) };
      return { winPct: null as number | null, evalText: explore.error ? '—' : '…' };
    }
    if (ply === 0) {
      const p = plies[0];
      if (p) return { winPct: whitePovWin(p.winBefore, p.fenBefore), evalText: scoreText(p.cpBefore, p.mateBefore) };
      return { winPct: null as number | null, evalText: '—' };
    }
    const p = plies[ply - 1];
    if (p) return { winPct: whitePovWin(p.winAfter, p.fenBefore), evalText: scoreText(p.cpAfter, p.mateAfter) };
    return { winPct: null as number | null, evalText: '—' };
  }, [explore, plies, ply]);

  // The engine's suggestion is drawn as the one arrow on the board; the move
  // actually played is marked by the square rings and its label badge. The empty
  // list keeps its identity so re-evaluating doesn't clear the user's own arrows.
  const arrows = useMemo(() => {
    if (explore || !showArrows || !currentPlyAnalysis?.bestUci) return NO_ARROWS;
    const arrow = arrowsFromUci(currentPlyAnalysis.bestUci);
    return arrow ? [[arrow[0], arrow[1], '#1f2933']] : NO_ARROWS;
  }, [explore, showArrows, currentPlyAnalysis]);

  const squareStyles = useMemo<Record<string, CSSProperties>>(() => {
    if (explore || !currentMove) return {};
    return {
      [currentMove.from]: { backgroundColor: 'var(--hl-last)' },
      [currentMove.to]: {
        backgroundColor: 'var(--hl-last)',
        boxShadow: 'inset 0 0 0 2px var(--accent-deep)',
        borderRadius: 4,
      },
    };
  }, [explore, currentMove]);

  const engineLines = useMemo(() => {
    if (!explore?.eval) return null;
    return explore.eval.lines.slice(0, 3).map((line) => ({
      score: scoreText(line.cp, line.mate),
      san: uciLineToSan(explore.fen, line.pvUci),
    }));
  }, [explore]);

  const altAccuracy = useMemo(() => (explore ? altLineAccuracy(explore.moves) : null), [explore]);

  const figure = useMemo<FigureInfo>(() => {
    if (explore) {
      if (!exploreMove) return { move: 'Exploring' };
      const head = `${moveNo(0, exploreMove.fenBefore)} ${exploreMove.san}`;
      if (exploreMove.winBefore === undefined || exploreMove.winAfter === undefined) {
        return { move: `Exploring — ${head}` };
      }
      return {
        move: `Exploring — ${head}`,
        label: exploreMove.label,
        swing: `win ${Math.round(exploreMove.winBefore)}% → ${Math.round(exploreMove.winAfter)}%`,
      };
    }
    if (ply === 0 || !currentMove) return { move: 'Starting position' };
    const moveText = `${moveNo(ply - 1, currentPlyAnalysis?.fenBefore ?? moves[ply - 2]?.fenAfter ?? game?.startFen ?? START_FEN)} ${currentMove.san}`;
    if (!currentPlyAnalysis) return { move: moveText };
    return {
      move: moveText,
      label: currentPlyAnalysis.label,
      swing: `win ${Math.round(currentPlyAnalysis.winBefore)}% → ${Math.round(currentPlyAnalysis.winAfter)}%`,
      note: currentPlyAnalysis.caption,
    };
  }, [explore, exploreMove, ply, currentMove, currentPlyAnalysis, moves, game?.startFen]);

  // ----------------------------------------------------------- render ----

  if (loading) {
    return (
      <div className="page">
        <div className="loading">Loading…</div>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="page">
        <div className="error-text">✕ {error ?? 'Game not found.'}</div>
      </div>
    );
  }

  const meta = game.meta;
  const opening = analysis?.opening ?? (meta.eco || meta.opening ? { eco: meta.eco, name: meta.opening } : undefined);

  return (
    <div className="page">
      <div className="review-head">
        <div>
          <h1 className="review-players">
            {meta.white}
            {meta.whiteElo ? <span className="muted"> ({meta.whiteElo})</span> : null} <span className="vs">vs</span>{' '}
            {meta.black}
            {meta.blackElo ? <span className="muted"> ({meta.blackElo})</span> : null}
            <span className="muted"> · {meta.result}</span>
          </h1>
          <div className="review-meta">
            {meta.date && <span>{meta.date}</span>}
            {meta.event && <span>{meta.event}</span>}
            {opening?.name && (
              <span>
                {opening.eco ? `${opening.eco} ` : ''}
                {opening.name}
              </span>
            )}
            {game.sourceUrl && (
              <a href={game.sourceUrl} target="_blank" rel="noreferrer">
                {game.source}
              </a>
            )}
          </div>
        </div>
        <div className="review-actions">
          <a className="btn" href={`/api/games/${game.id}/export.pgn`}>
            <span className="ico">
              <Icon name="download" size={16} />
            </span>
            Export PGN
          </a>
          <Link className="btn" to="/">
            Library
          </Link>
        </div>
      </div>

      {error && <div className="banner warn">{error}</div>}

      <div className="review-body">
        <div className="board-col">
          <BoardPanel
            fen={currentFen || START_FEN}
            flipped={flipped}
            onFlip={() => setFlipped((f) => !f)}
            exploring={!!explore}
            onToggleExplore={toggleExplore}
            onUserMove={playUserMove}
            engineLoading={explorePending}
            engineError={explore?.error}
            arrows={arrows}
            squareStyles={squareStyles}
            showArrows={showArrows}
            onToggleArrows={() => setShowArrows((v) => !v)}
            winPct={winPct}
            evalText={evalText}
            engineLines={engineLines}
            ply={boardPly}
            totalPlies={boardTotal}
            onNavigate={walkingLine ? navigateAlt : selectPly}
            figure={figure}
            destSquare={explore ? exploreMove?.to : currentMove ? currentMove.to : undefined}
          />
        </div>

        <div className="side-col">
          <div className="card action-box">
            <div className="sec">
              <h2>Analysis</h2>
              {analysis && (
                <span className="sec-note">
                  {`${fmtMovetime(analysis.movetimeMs)}s/pos · depth ${analysis.depthReached ?? '?'} · ${analysis.engine ?? 'Stockfish'}`}
                </span>
              )}
              {streaming && progress && <span className="sec-note">{progress.done}/{progress.total} positions</span>}
            </div>

            {streaming ? (
              <>
                <div className="progress-row">
                  <span>Analysing with Stockfish…</span>
                  <span className="muted">{progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0}%</span>
                </div>
                <div className="bar">
                  <div
                    style={{
                      width: `${progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <DepthSlider value={movetimeMs} onChange={setMovetimeMs} />
                  {analysis ? (
                    <button
                      className="btn"
                      onClick={() => {
                        if (confirm('Re-run the analysis at the selected depth? The current analysis will be replaced.')) {
                          startAnalysis(movetimeMs);
                        }
                      }}
                    >
                      Re-analyse (replaces current)
                    </button>
                  ) : (
                    <button className="btn primary" onClick={() => startAnalysis(movetimeMs)}>
                      Analyse this game
                    </button>
                  )}
                </div>
                {!analysis && (
                  <p className="muted" style={{ margin: '8px 0 0' }}>
                    Pick how hard Stockfish thinks per position.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="tabs lg review-tabs" role="tablist" aria-label="Review panes">
            <button
              role="tab"
              id="pane-review-tab"
              aria-controls="pane-review"
              aria-selected={pane === 'review'}
              className={`tab ${pane === 'review' ? 'active' : ''}`}
              onClick={() => setPane('review')}
            >
              Review
            </button>
            <button
              role="tab"
              id="pane-moves-tab"
              aria-controls="pane-moves"
              aria-selected={pane === 'moves'}
              className={`tab ${pane === 'moves' ? 'active' : ''}`}
              onClick={() => setPane('moves')}
            >
              Moves
            </button>
          </div>

          {pane === 'review' ? (
            <div id="pane-review" role="tabpanel" aria-labelledby="pane-review-tab">
              {analysis ? (
                <SummaryCards analysis={analysis} meta={meta} />
              ) : (
                !streaming && (
                  <div className="card">
                    <div className="sec">
                      <h2>Accuracy & game rating</h2>
                    </div>
                    <p className="muted" style={{ margin: 0 }}>
                      Start an analysis to see accuracy, game rating and move-by-move labels.
                    </p>
                  </div>
                )
              )}

              {(plies.length > 0 || streaming) && (
                <EvalGraph
                  plies={plies}
                  totalMoves={moves.length}
                  selected={ply}
                  onSelect={selectPly}
                  keyMoments={analysis?.keyMoments ?? []}
                />
              )}

              {analysis && (
                <KeyMoments moments={analysis.keyMoments} plies={plies} selected={ply} onSelect={selectPly} />
              )}
            </div>
          ) : (
            <div id="pane-moves" role="tabpanel" aria-labelledby="pane-moves-tab">
              <div className="card">
                <div className="sec">
                  <h2>Moves</h2>
                  <div className="tabs" role="tablist" aria-label="Moves panes">
                    <button
                      role="tab"
                      id="moves-score-tab"
                      aria-controls="moves-score"
                      aria-selected={tab === 'moves'}
                      className={`tab ${tab === 'moves' ? 'active' : ''}`}
                      onClick={() => setTab('moves')}
                    >
                      Score
                    </button>
                    <button
                      role="tab"
                      id="moves-explorer-tab"
                      aria-controls="moves-explorer"
                      aria-selected={tab === 'explorer'}
                      className={`tab ${tab === 'explorer' ? 'active' : ''}`}
                      onClick={() => setTab('explorer')}
                    >
                      Opening explorer
                    </button>
                  </div>
                </div>
                {tab === 'moves' ? (
                  <div id="moves-score" role="tabpanel" aria-labelledby="moves-score-tab">
                    <MoveList
                      plies={plies}
                      moves={moves}
                      startFen={game?.startFen ?? START_FEN}
                      selected={ply}
                      onSelect={selectPly}
                      streaming={streaming}
                      alt={
                        explore && explore.moves.length > 0
                          ? {
                              baseFen: explore.baseFen,
                              moves: explore.moves,
                              cursor: explore.cursor,
                              accuracy: altAccuracy,
                              onSelect: selectAltMove,
                            }
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <div id="moves-explorer" role="tabpanel" aria-labelledby="moves-explorer-tab">
                    <OpeningExplorer fen={currentFen || START_FEN} onPlay={handleExplorerPlay} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
