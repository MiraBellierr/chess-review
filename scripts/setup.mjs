/**
 * One-time setup:
 *   1. Downloads a native Stockfish binary for Windows into vendor/stockfish/
 *   2. Downloads the lichess opening book dataset into vendor/openings/
 *
 * Safe to re-run. Use --force to re-download everything.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const SF_DIR = path.join(VENDOR, 'stockfish');
const SF_EXE = path.join(SF_DIR, 'stockfish.exe');
const BOOK_DIR = path.join(VENDOR, 'openings');
const TMP = path.join(os.tmpdir(), 'chess-review-setup');
const FORCE = process.argv.includes('--force');

fs.mkdirSync(SF_DIR, { recursive: true });
fs.mkdirSync(BOOK_DIR, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function log(msg) {
  console.log(`[setup] ${msg}`);
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

/** Start the engine, send "uci", expect "uciok" back. */
function smokeTest(exePath) {
  return new Promise((resolve) => {
    let settled = false;
    let out = '';
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(ok);
    };
    let proc;
    try {
      proc = spawn(exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return resolve(false);
    }
    const timer = setTimeout(() => done(false), 15000);
    proc.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('uciok')) done(true);
    });
    proc.on('error', () => done(false));
    proc.on('exit', () => done(false));
    try { proc.stdin.write('uci\n'); } catch { done(false); }
  });
}

function findExe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findExe(p);
      if (found) return found;
    } else if (entry.name.toLowerCase().endsWith('.exe')) {
      return p;
    }
  }
  return null;
}

async function setupStockfish() {
  if (!FORCE && fs.existsSync(SF_EXE)) {
    const ok = await smokeTest(SF_EXE);
    if (ok) {
      log(`Stockfish already installed: ${SF_EXE}`);
      return;
    }
    log('Existing stockfish.exe failed its smoke test; re-downloading.');
  }

  log('Looking up latest Stockfish release...');
  const res = await fetch('https://api.github.com/repos/official-stockfish/Stockfish/releases/latest', {
    headers: { 'User-Agent': 'chess-review-setup' },
  });
  if (!res.ok) throw new Error(`GitHub API -> HTTP ${res.status}`);
  const release = await res.json();
  const zips = release.assets.filter((a) => /^stockfish-windows-x86-64.*\.zip$/i.test(a.name));
  if (zips.length === 0) throw new Error('No Windows x86-64 release asset found.');

  // Preference order: avx2 (fastest) > sse41-popcnt > plain x86-64.
  const rank = (name) => {
    const n = name.toLowerCase();
    if (n.includes('avx2')) return 0;
    if (n.includes('sse41')) return 1;
    return 2;
  };
  const sorted = [...zips].sort((a, b) => rank(a.name) - rank(b.name));

  for (const asset of sorted) {
    const zipPath = path.join(TMP, asset.name);
    const extractDir = path.join(TMP, asset.name.replace(/\.zip$/i, ''));
    log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
    try {
      await download(asset.browser_download_url, zipPath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      log(`Extracting ${asset.name}...`);
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ], { stdio: 'pipe' });
      const exe = findExe(extractDir);
      if (!exe) throw new Error('No .exe found inside the archive.');
      log('Running smoke test (uci handshake)...');
      const ok = await smokeTest(exe);
      if (!ok) {
        log(`Build ${asset.name} did not respond to UCI — trying the next one.`);
        continue;
      }
      fs.copyFileSync(exe, SF_EXE);
      log(`Stockfish installed: ${SF_EXE} (${release.tag_name}, ${asset.name})`);
      return;
    } catch (err) {
      log(`Failed with ${asset.name}: ${err.message}`);
    }
  }
  throw new Error('Could not install a working Stockfish build. Set STOCKFISH_PATH manually and re-run.');
}

async function setupOpenings() {
  const files = ['a', 'b', 'c', 'd', 'e'];
  const existing = files.every((f) => fs.existsSync(path.join(BOOK_DIR, `${f}.tsv`)));
  if (existing && !FORCE) {
    log(`Opening book already present in ${BOOK_DIR}`);
    return;
  }
  const branches = ['master', 'main'];
  const base = (branch) => `https://raw.githubusercontent.com/lichess-org/chess-openings/${branch}`;
  let branch = null;
  for (const b of branches) {
    try {
      const test = await fetch(`${base(b)}/a.tsv`, { method: 'HEAD' });
      if (test.ok) { branch = b; break; }
    } catch { /* try next */ }
  }
  if (!branch) {
    log('WARNING: could not reach the opening book dataset. Book/opening-name features will be disabled until you re-run setup.');
    return;
  }
  for (const f of files) {
    log(`Downloading openings ${f}.tsv...`);
    await download(`${base(branch)}/${f}.tsv`, path.join(BOOK_DIR, `${f}.tsv`));
  }
  log(`Opening book installed: ${BOOK_DIR}`);
}

try {
  await setupStockfish();
  await setupOpenings();
  const dest = path.join(SF_DIR, 'stockfish-license.txt');
  log('');
  log('Setup complete.');
  log('Next steps:');
  log('  npm run dev      -> development mode (hot reload)');
  log('  start.bat        -> production-style: build + serve at http://localhost:3001');
} catch (err) {
  console.error(`[setup] ERROR: ${err.message}`);
  process.exit(1);
}
