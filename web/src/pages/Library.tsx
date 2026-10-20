import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteGame, getLibrary } from '../api';
import type { GameSummary } from '../types';
import { fmtAccuracy, fmtResult, sourceLabel } from '../util';
import { Icon } from '../components/Icons';

export default function Library() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    getLibrary()
      .then((r) => setGames(r.games))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the library.'));
  }, []);

  useEffect(load, [load]);

  const onDelete = async (game: GameSummary) => {
    if (!confirm(`Delete ${game.white} vs ${game.black}? This removes its analysis too.`)) return;
    try {
      await deleteGame(game.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Library</h1>
        <Link className="btn primary" to="/import">
          <span className="ico">
            <Icon name="plus" size={16} />
          </span>
          Import game
        </Link>
      </div>

      {error && <div className="banner warn">{error}</div>}

      {!games ? (
        <div className="loading">Loading…</div>
      ) : games.length === 0 ? (
        <div className="empty">
          <h2>No games yet</h2>
          <p className="prose">Paste a PGN, or pull your recent games from chess.com or lichess.</p>
          <Link className="btn primary" to="/import">
            Import your first game
          </Link>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
                <th>Source</th>
                <th>Accuracy (W – B)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr
                  key={g.id}
                  className="clickable"
                  onClick={() => navigate(`/review/${g.id}${g.analyzed ? '' : '?auto=1'}`)}
                >
                  <td className="num muted">{g.date ?? '—'}</td>
                  <td>
                    {g.white}
                    {g.whiteElo ? <span className="muted"> ({g.whiteElo})</span> : null}
                  </td>
                  <td>
                    {g.black}
                    {g.blackElo ? <span className="muted"> ({g.blackElo})</span> : null}
                  </td>
                  <td>
                    <span className="result">{fmtResult(g.result)}</span>
                  </td>
                  <td>
                    <span className="chip">{sourceLabel(g.source)}</span>
                  </td>
                  <td className="num muted">
                    {g.analyzed ? `${fmtAccuracy(g.whiteAccuracy)} – ${fmtAccuracy(g.blackAccuracy)}` : 'not analysed'}
                  </td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn"
                      onClick={() => navigate(`/review/${g.id}${g.analyzed ? '' : '?auto=1'}`)}
                    >
                      {g.analyzed ? 'Open review' : 'Analyse'}
                    </button>
                    <a className="btn" href={`/api/games/${g.id}/export.pgn`} title="Download annotated PGN">
                      PGN
                    </a>
                    <button className="btn danger" onClick={() => onDelete(g)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
