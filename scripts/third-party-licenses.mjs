// Writes THIRD_PARTY_LICENSES.txt: the licence texts of everything compiled into a release
// (Rust crates for this platform, the JS packages bundled into the web view, the colour data).
// MIT and Apache-2.0 ask for their notices to travel with binaries. Identical texts are printed once.
// node scripts/third-party-licenses.mjs [rust target triple]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;
const target = process.argv[2] ?? /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))[1];

// ---- Rust: the crates reachable from the app through normal (not build or dev) dependencies.
const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', target],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const root = meta.resolve.root;
const reached = new Set();
const stack = [root];
while (stack.length) {
  const id = stack.pop();
  if (reached.has(id)) continue;
  reached.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
}
reached.delete(root);

const entries = []; // { who, licence, texts[] }
const textsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort().map((f) => readFileSync(join(dir, f), 'utf8').trim()) : []);
for (const id of reached) {
  const p = byId.get(id);
  entries.push({ who: `${p.name} ${p.version}`, licence: p.license ?? p.license_file ?? 'see text', texts: textsIn(dirname(p.manifest_path)), repo: p.repository ?? '' });
}

// ---- JS bundled into the web view: the runtime dependencies and theirs.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const seenJs = new Set();
const jsStack = Object.keys(pkg.dependencies ?? {});
while (jsStack.length) {
  const name = jsStack.pop();
  if (seenJs.has(name)) continue;
  seenJs.add(name);
  const dir = join('node_modules', name);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  entries.push({ who: `${name} ${pj.version} (npm)`, licence: pj.license ?? 'see text', texts: textsIn(dir), repo: typeof pj.repository === 'string' ? pj.repository : pj.repository?.url ?? '' });
  jsStack.push(...Object.keys(pj.dependencies ?? {}));
}

// ---- Data: team colours.
entries.push({ who: 'colorr team colour data', licence: 'MIT', texts: [readFileSync('styles/team-colors/NOTICE.md', 'utf8').trim()], repo: 'https://github.com/lobsterbush/colorr' });

// ---- Group identical texts.
const groups = new Map();
const noText = [];
for (const e of entries.sort((a, b) => a.who.localeCompare(b.who))) {
  if (!e.texts.length) { noText.push(e); continue; }
  for (const t of e.texts) {
    const g = groups.get(t) ?? [];
    g.push(e);
    groups.set(t, g);
  }
}
const rule = '-'.repeat(78);
const out = [
  'Basesmall: third-party licences',
  '',
  `Everything below is compiled into, or shipped with, Basesmall for ${target}. Basesmall itself is MIT licensed (see LICENSE).`,
  `${entries.length} components; ${groups.size} distinct licence texts.`,
  '',
];
for (const [text, users] of groups) {
  out.push(rule, `Used by: ${users.map((u) => `${u.who} (${u.licence})`).join(', ')}`, rule, '', text, '');
}
if (noText.length) {
  out.push(rule, 'Components that ship no licence file; their declared licence and source:', rule, '');
  for (const e of noText) out.push(`${e.who}: ${e.licence}${e.repo ? ` <${e.repo}>` : ''}`);
  out.push('');
}
writeFileSync('THIRD_PARTY_LICENSES.txt', out.join('\n'));
console.log(`THIRD_PARTY_LICENSES.txt: ${entries.length} components, ${groups.size} distinct texts, ${noText.length} without a licence file`);
