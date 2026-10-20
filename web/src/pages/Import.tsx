import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { importChessCom, importLichess, parsePgn, storeGame, type ParsePreview } from '../api';
import type { ImportPreview } from '../types';
import { fmtResult } from '../util';

type Tab = 'pgn' | 'chesscom' | 'lichess';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>('pgn');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // PGN tab
  const [pgnText, setPgnText] = useState('');
  const [previews, setPreviews] = useState<ParsePreview[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  // Remote tabs
  const [username, setUsername] = useState('');
  const [remoteGames, setRemoteGames] = useState<ImportPreview[] | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const reset = () => {
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPgnText(await file.text());
    setPreviews(null);
  };

  const doParse = async () => {
    reset();
    setBusy(true);
    try {
      const r = await parsePgn(pgnText);
      setPreviews(r.games);
      const firstOk = r.games.find((g) => !g.error);
      setSelected(firstOk ? firstOk.index : 0);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const importPgnGame = async (index: number) => {
    reset();
    setBusy(true);
    try {
      const r = await storeGame({ pgn: pgnText, source: 'pgn', gameIndex: index });
      navigate(`/review/${r.id}?auto=1`);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const loadRemote = async () => {
    reset();
    setRemoteBusy(true);
    setRemoteGames(null);
    try {
      const r = tab === 'chesscom' ? await importChessCom(username) : await importLichess(username);
      setRemoteGames(r.games);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const importRemote = async (game: ImportPreview) => {
    reset();
    setRemoteBusy(true);
    try {
      const r = await storeGame({
        pgn: game.pgn,
        source: tab,
        sourceUrl: game.sourceUrl,
      });
      navigate(`/review/${r.id}?auto=1`);
    } catch (e) {
      setError(errMsg(e));
      setRemoteBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Import a game</h1>
      </div>

      <div className="tabs lg">
        <button className={`tab ${tab === 'pgn' ? 'active' : ''}`} onClick={() => { setTab('pgn'); reset(); }}>
          PGN paste / upload
        </button>
        <button className={`tab ${tab === 'chesscom' ? 'active' : ''}`} onClick={() => { setTab('chesscom'); reset(); }}>
          chess.com
        </button>
        <button className={`tab ${tab === 'lichess' ? 'active' : ''}`} onClick={() => { setTab('lichess'); reset(); }}>
          lichess
        </button>
      </div>

      {error && <div className="error-text">✕ {error}</div>}

      {tab === 'pgn' && (
        <div className="card">
          <div className="sec">
            <h2>Paste a PGN</h2>
            <span className="sec-note">one game or a whole file</span>
          </div>
          <textarea
            value={pgnText}
            onChange={(e) => {
              setPgnText(e.target.value);
              setPreviews(null);
            }}
            placeholder={'[Event "..."]\n[White "..."]\n[Black "..."]\n\n1. e4 e5 2. Nf3 ...'}
          />
          <div className="form-row">
            <input
              type="file"
              accept=".pgn,text/plain"
              aria-label="PGN file"
              style={{ width: 'auto' }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button className="btn" onClick={doParse} disabled={!pgnText.trim() || busy}>
              {busy ? 'Parsing…' : 'Parse'}
            </button>
          </div>

          {previews && (
            <div style={{ marginTop: 18 }}>
              <h3>
                Found {previews.length} game{previews.length === 1 ? '' : 's'}
              </h3>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>White</th>
                      <th>Black</th>
                      <th>Result</th>
                      <th>Moves</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {previews.map((g) => (
                      <tr key={g.index} className={!g.error ? 'clickable' : ''} onClick={() => !g.error && setSelected(g.index)}>
                        <td>
                          {!g.error && (
                            <input type="radio" checked={selected === g.index} onChange={() => setSelected(g.index)} />
                          )}
                        </td>
                        <td colSpan={g.error ? 4 : 1}>{g.error ? <span className="error-text">✕ {g.error}</span> : g.white}</td>
                        {!g.error && <td>{g.black}</td>}
                        {!g.error && <td className="num">{fmtResult(g.result)}</td>}
                        {!g.error && <td className="num muted">{g.plyCount}</td>}
                        <td className="actions">
                          {!g.error && (
                            <button className="btn primary" disabled={busy} onClick={(e) => { e.stopPropagation(); importPgnGame(g.index); }}>
                              Analyse this game
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {(tab === 'chesscom' || tab === 'lichess') && (
        <div className="card">
          <div className="sec">
            <h2>Your {tab === 'chesscom' ? 'chess.com' : 'lichess'} username</h2>
          </div>
          <div className="inline-form">
            <input
              type="text"
              value={username}
              placeholder={tab === 'chesscom' ? 'e.g. hikaru' : 'e.g. DrNykterstein'}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && username.trim() && loadRemote()}
            />
            <button className="btn primary" onClick={loadRemote} disabled={!username.trim() || remoteBusy}>
              {remoteBusy ? 'Loading…' : 'Load recent games'}
            </button>
          </div>
          <div className="note">
            Pulls up to 40 recent standard games via the public {tab === 'chesscom' ? 'chess.com' : 'lichess'} API.
            Needs an internet connection.
          </div>

          {remoteGames && (
            <div style={{ marginTop: 18 }}>
              {remoteGames.length === 0 ? (
                <p className="muted">No recent standard games found.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>White</th>
                        <th>Black</th>
                        <th>Result</th>
                        <th>TC</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {remoteGames.map((g, i) => (
                        <tr key={i}>
                          <td className="num muted">{g.date ?? '—'}</td>
                          <td>
                            {g.white}
                            {g.whiteElo ? <span className="muted"> ({g.whiteElo})</span> : null}
                          </td>
                          <td>
                            {g.black}
                            {g.blackElo ? <span className="muted"> ({g.blackElo})</span> : null}
                          </td>
                          <td className="num">{fmtResult(g.result)}</td>
                          <td className="muted">{g.timeClass ?? '—'}</td>
                          <td className="actions">
                            <button className="btn primary" disabled={remoteBusy} onClick={() => importRemote(g)}>
                              Analyse
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
