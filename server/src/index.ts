import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { PORT, WEB_DIST, resolveStockfishPath } from './config.js';
import { api } from './api.js';
import { openingBook } from './analysis/book.js';

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/api', api);

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      'Chess Review server is running, but the web UI is not built yet.\n' +
        'Run "npm run build" (production) or "npm run dev" (development) in the project root.',
    );
  });
}

// JSON error handler
app.use(
  (err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    res.status(err.status ?? 500).json({ error: err.message || 'Internal error.' });
  },
);

app.listen(PORT, () => {
  const sfPath = resolveStockfishPath();
  console.log('----------------------------------------------');
  console.log('  Chess Review server');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Stockfish: ${sfPath ?? 'NOT FOUND — run "npm run setup"'}`);
  console.log('----------------------------------------------');
  if (process.env.OPEN_BROWSER === '1') {
    exec(`start "" http://localhost:${PORT}`);
  }
  // Load the opening book in the background (it takes a moment to replay the lines).
  setTimeout(() => {
    try {
      openingBook.load();
      console.log(`[book] Opening book loaded: ${openingBook.lineCount} lines.`);
    } catch (err) {
      console.warn('[book] Could not load opening book:', err instanceof Error ? err.message : err);
    }
  }, 10);
});
