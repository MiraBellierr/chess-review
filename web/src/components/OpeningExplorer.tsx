import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getBook, getExplorer, type BookData, type ExplorerData } from '../api';

interface Props {
  fen: string;
  onPlay: (uci: string) => void;
}

type Tab = 'masters' | 'lichess' | 'book';

export function OpeningExplorer({ fen, onPlay }: Props) {
  const [tab, setTab] = useState<Tab>('masters');
  const [online, setOnline] = useState<ExplorerData | null>(null);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [book, setBook] = useState<BookData | null>(null);
  const [bookLoading, setBookLoading] = useState(false);

  useEffect(() => {
    if (tab === 'book') return;
    let cancelled = false;
    setOnlineLoading(true);
    setOnlineError(null);
    setNeedsToken(false);
    getExplorer(fen, tab)
      .then((d) => {
        if (cancelled) return;
        setOnline(d);
        setOnlineLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setOnline(null);
        setOnlineError(e instanceof Error ? e.message : 'Explorer unavailable.');
        setNeedsToken(e instanceof ApiError && (e.payload as { needsToken?: boolean } | null)?.needsToken === true);
        setOnlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fen, tab]);

  useEffect(() => {
    if (tab !== 'book') return;
    let cancelled = false;
    setBookLoading(true);
    getBook(fen)
      .then((d) => {
        if (!cancelled) {
          setBook(d);
          setBookLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBook(null);
          setBookLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fen, tab]);

  return (
    <div>
      <div className="tabs">
        <button className={`tab ${tab === 'masters' ? 'active' : ''}`} onClick={() => setTab('masters')}>
          Masters
        </button>
        <button className={`tab ${tab === 'lichess' ? 'active' : ''}`} onClick={() => setTab('lichess')}>
          Lichess
        </button>
        <button className={`tab ${tab === 'book' ? 'active' : ''}`} onClick={() => setTab('book')}>
          Local book
        </button>
      </div>

      {tab !== 'book' && onlineLoading && <div className="muted">Loading…</div>}
      {tab !== 'book' && onlineError && (
        <div className="error-text" style={{ marginBottom: 8 }}>
          ✕ {onlineError}
          {needsToken && (
            <>
              {' '}
              <a href="https://lichess.org/account/oauth/token/create" target="_blank" rel="noreferrer">
                Create a token
              </a>{' '}
              then paste it in <Link to="/settings">Settings</Link>.
            </>
          )}
        </div>
      )}

      {tab !== 'book' && !onlineLoading && !onlineError && online && <OnlineView data={online} onPlay={onPlay} />}

      {tab === 'book' &&
        (bookLoading ? (
          <div className="muted">Loading…</div>
        ) : !book || book.moves.length === 0 ? (
          <p className="muted">This position is not in the bundled opening book.</p>
        ) : (
          <LocalBookView data={book} onPlay={onPlay} />
        ))}
    </div>
  );
}

function OnlineView({ data, onPlay }: { data: ExplorerData; onPlay: (uci: string) => void }) {
  const total = data.white + data.draws + data.black;
  if (total === 0 || data.moves.length === 0) {
    return <p className="muted">No games reach this position in this database.</p>;
  }
  return (
    <>
      {data.opening?.name && (
        <p className="muted" style={{ margin: '0 0 10px' }}>
          {data.opening.eco ? `${data.opening.eco} · ` : ''}
          {data.opening.name}
        </p>
      )}
      <div
        className="wdl-bar"
        style={{ marginBottom: 10 }}
        title={`White ${pct(data.white, total)}% · Draw ${pct(data.draws, total)}% · Black ${pct(data.black, total)}%`}
      >
        <div className="w" style={{ width: `${(data.white / total) * 100}%` }} />
        <div className="d" style={{ width: `${(data.draws / total) * 100}%` }} />
        <div className="b" style={{ width: `${(data.black / total) * 100}%` }} />
      </div>
      <table className="explorer-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <tbody>
          {data.moves.slice(0, 8).map((move) => {
            const moveTotal = move.white + move.draws + move.black;
            return (
              <tr key={move.uci} onClick={() => onPlay(move.uci)} title="Play this move">
                <td className="explorer-san" style={{ width: 62 }}>
                  {move.san}
                </td>
                <td style={{ width: 70 }} className="muted">
                  {shortCount(moveTotal)}
                </td>
                <td>
                  <div className="wdl-bar">
                    <div className="w" style={{ width: `${(move.white / Math.max(1, moveTotal)) * 100}%` }} />
                    <div className="d" style={{ width: `${(move.draws / Math.max(1, moveTotal)) * 100}%` }} />
                    <div className="b" style={{ width: `${(move.black / Math.max(1, moveTotal)) * 100}%` }} />
                  </div>
                </td>
                <td style={{ width: 66 }} className="muted">
                  {pct(move.white, moveTotal)}% / {pct(move.draws, moveTotal)}% / {pct(move.black, moveTotal)}%
                </td>
                <td style={{ width: 52 }} className="muted">
                  {move.averageRating ? `${move.averageRating}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function LocalBookView({ data, onPlay }: { data: BookData; onPlay: (uci: string) => void }) {
  const total = Math.max(1, data.total);
  return (
    <>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {data.eco ? `${data.eco} · ` : ''}
        {data.name ?? 'Bundled ECO book'} — counts are book lines, not games.
      </p>
      <table className="explorer-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <tbody>
          {data.moves.slice(0, 10).map((move) => (
            <tr key={move.uci} onClick={() => onPlay(move.uci)} title={move.name ? `${move.name}${move.eco ? ` (${move.eco})` : ''}` : 'Play this move'}>
              <td className="explorer-san" style={{ width: 62 }}>
                {move.san}
              </td>
              <td style={{ width: 60 }} className="muted">
                {move.count}×
              </td>
              <td>
                <div className="wdl-bar">
                  <div className="w" style={{ width: `${(move.count / total) * 100}%` }} />
                </div>
              </td>
              <td className="muted" style={{ textAlign: 'right' }}>
                {move.eco ? `${move.eco} ` : ''}
                {move.name ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function shortCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}
