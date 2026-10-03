// Polite fetcher for the MLB Stats API probe.
// One request in flight, fixed gap between requests, every response cached on disk
// so re-running an analysis never hits the network twice for the same URL.
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = join(ROOT, 'fixtures', 'mlb', 'raw');
export const BASE = 'https://statsapi.mlb.com';
const GAP_MS = 1500;
const UA = 'DesktopMLB-probe/0.1 (open-source, personal non-commercial use)';

mkdirSync(CACHE_DIR, { recursive: true });

let lastRequestAt = 0;
let queue = Promise.resolve();

function keyFor(url, headers) {
  return createHash('sha1').update(url + JSON.stringify(headers ?? {})).digest('hex').slice(0, 16);
}

/**
 * GET a path on statsapi.mlb.com. Returns { json, bytes, ms, status, headers, cached }.
 * `ms` and `headers` are from the original network request even when served from cache.
 */
export function get(path, { headers, noCache = false } = {}) {
  const url = path.startsWith('http') ? path : BASE + path;
  const key = keyFor(url, headers);
  const file = join(CACHE_DIR, key + '.json');
  if (!noCache && existsSync(file)) {
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    return Promise.resolve({ ...rec.meta, json: rec.body, cached: true });
  }
  const run = async () => {
    const wait = lastRequestAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t0 = performance.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    lastRequestAt = Date.now();
    const meta = {
      url,
      status: res.status,
      ms,
      bytes: Buffer.byteLength(text, 'utf8'),
      headers: Object.fromEntries(res.headers.entries()),
      fetchedAt: new Date().toISOString(),
    };
    let body;
    try { body = JSON.parse(text); } catch { body = { __nonJson: text.slice(0, 2000) }; }
    if (!noCache) writeFileSync(file, JSON.stringify({ meta, body }));
    process.stderr.write(`  GET ${url} -> ${res.status} ${meta.bytes}B ${ms}ms\n`);
    return { ...meta, json: body, cached: false };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Collect every distinct key path (arrays collapsed to []) under an object. */
export function keyPaths(obj, prefix = '', out = new Set(), depth = 0) {
  if (depth > 8 || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj.slice(0, 50)) keyPaths(v, prefix + '[]', out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    keyPaths(v, p, out, depth + 1);
  }
  return out;
}

export const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
