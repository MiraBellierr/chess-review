import { useEffect, useState } from 'react';
import { getHealth, getSettings, putSettings } from '../api';
import type { AppSettings, Health } from '../types';
import { MOVETIME_STEPS } from '../types';
import { fmtMovetime } from '../util';
import { Icon } from '../components/Icons';

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch((e) => setError(e.message));
    getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  if (!settings) {
    return (
      <div className="page">
        <h1>Settings</h1>
        {error ? <div className="error-text">✕ {error}</div> : <div className="loading">Loading…</div>}
      </div>
    );
  }

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const updated = await putSettings({
        defaultMovetimeMs: settings.defaultMovetimeMs,
        threads: settings.threads,
        hashMb: settings.hashMb,
        enginePath: settings.enginePath ?? '',
        lichessToken: settings.lichessToken ?? '',
      });
      setSettings(updated);
      setSaved(true);
      getHealth().then(setHealth).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {error && <div className="error-text">✕ {error}</div>}
      {saved && <div className="success-text">Saved. Settings apply from the next analysis.</div>}

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="sec">
          <h2>Engine</h2>
          <span className="sec-note">
            <span style={{ display: 'inline-flex', verticalAlign: '-3px', marginRight: 5 }}>
              <Icon name={health?.engine.available ? 'check' : 'alert'} size={15} />
            </span>
            {health?.engine.available ? health.engine.name ?? 'Stockfish' : 'not found'}
          </span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {health?.engine.available ? (
            <>
              Binary: <code>{health.engine.path}</code>
            </>
          ) : (
            <span className="error-text">Stockfish not found. Run "npm run setup" in the project root and restart the server.</span>
          )}
          <br />
          Opening book: {health?.book.loaded ? `${health.book.lines} lines` : 'not loaded — run "npm run setup"'}
        </p>

        <div className="field">
          <label htmlFor="set-depth">Default analysis depth (per position)</label>
          <select
            id="set-depth"
            value={settings.defaultMovetimeMs}
            onChange={(e) => setSettings({ ...settings, defaultMovetimeMs: Number(e.target.value) })}
          >
            {MOVETIME_STEPS.map((ms) => (
              <option key={ms} value={ms}>
                {fmtMovetime(ms)}s — {labelFor(ms)}
              </option>
            ))}
          </select>
          <div className="hint">
            Applied when you start a new analysis. 0.25s per position is the default and keeps a full game to
            roughly half a minute; raise it for important games.
          </div>
        </div>

        <div className="field">
          <label htmlFor="set-threads">Engine threads</label>
          <input
            id="set-threads"
            type="number"
            min={1}
            max={128}
            value={settings.threads}
            onChange={(e) => setSettings({ ...settings, threads: Number(e.target.value) })}
          />
          <div className="hint">More threads = deeper search, more CPU load. Half your cores keeps the desktop responsive.</div>
        </div>

        <div className="field">
          <label htmlFor="set-hash">Hash size (MB)</label>
          <input
            id="set-hash"
            type="number"
            min={16}
            max={8192}
            step={16}
            value={settings.hashMb}
            onChange={(e) => setSettings({ ...settings, hashMb: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="set-path">Stockfish binary path (optional override)</label>
          <input
            id="set-path"
            type="text"
            value={settings.enginePath ?? ''}
            placeholder="Use the bundled vendor/stockfish/stockfish.exe"
            onChange={(e) => setSettings({ ...settings, enginePath: e.target.value })}
          />
        </div>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <div className="sec">
          <h2>Opening explorer</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          The lichess explorer API requires a free personal token. Without one, the review page still has the fully
          offline <strong>Local book</strong> tab.
        </p>
        <div className="field">
          <label htmlFor="set-token">Lichess API token</label>
          <input
            id="set-token"
            type="password"
            value={settings.lichessToken ?? ''}
            placeholder="paste your lichess token"
            autoComplete="off"
            onChange={(e) => setSettings({ ...settings, lichessToken: e.target.value })}
          />
          <div className="hint">
            <a href="https://lichess.org/account/oauth/token/create" target="_blank" rel="noreferrer">
              Create a token
            </a>{' '}
            — no scopes needed. Stored locally in your SQLite database.
          </div>
        </div>

        <button className="btn primary" onClick={save}>
          Save settings
        </button>
      </div>
    </div>
  );
}

function labelFor(ms: number): string {
  if (ms <= 500) return 'fast';
  if (ms <= 1500) return 'quick';
  if (ms <= 2500) return 'balanced';
  if (ms <= 4000) return 'thorough';
  if (ms <= 6000) return 'deep';
  return 'maximum';
}
