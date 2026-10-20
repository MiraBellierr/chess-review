import { useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { getHealth } from './api';
import type { Health } from './types';
import { Icon } from './components/Icons';
import Library from './pages/Library';
import ImportPage from './pages/Import';
import Review from './pages/Review';
import Settings from './pages/Settings';

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const engineOk = health?.engine.available ?? false;

  return (
    <BrowserRouter>
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ♞
            </span>
            <span>Chess Review</span>
          </Link>
          <nav>
            <NavLink to="/" end>
              Library
            </NavLink>
            <NavLink to="/import">Import</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          <div
            className={`engine-status${engineOk ? '' : ' offline'}`}
            title={health?.engine.path ?? (health?.engine.error || '')}
          >
            <span className="status-icon">
              <Icon name={engineOk ? 'check' : 'alert'} size={15} />
            </span>
            {engineOk ? `${health?.engine.name ?? 'Stockfish'} ready` : 'Engine offline'}
          </div>
        </header>

        {health && !health.engine.available && (
          <div className="banner warn">
            Stockfish is not available{health.engine.error ? `: ${health.engine.error}` : '.'} Run{' '}
            <code>npm run setup</code> in the project root, then restart the server.
          </div>
        )}

        <main>
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/review/:id" element={<Review />} />
            <Route path="/settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <div className="notfound">
                  <h1>Page not found</h1>
                  <p className="muted prose" style={{ margin: '0 auto 18px' }}>
                    That route does not exist in this library.
                  </p>
                  <Link className="btn" to="/">
                    Back to the library
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
