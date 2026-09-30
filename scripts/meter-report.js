#!/usr/bin/env node
// meter-report.js — what the hooks cost, from the rows the hook meter wrote (#527).
//
// Per hook: runs, the silent · informed · refused split (it sums to runs), bytes
// injected, the median size of an informed run, and time at p50 and p95. Every figure
// is printed beside its population — runs, sessions, the window, the directory — and a
// percentile over fewer than 20 runs says what it really is.
//
// What the rows cannot contain: a run killed from outside (the harness's timeout) ends
// before its exit handler, so it leaves no row. Every figure here is "of the runs that
// finished", and the report says so each time rather than only when it seems to matter.
//
// Usage: node scripts/meter-report.js [--session <id>] [--since <ISO date>] [--dir <meter dir>] [--json]
// Exit:  0 rows reported · 2 NO ROWS — nothing was metered in this scope. Never a table of
//        zeros: "the meter wrote nothing" and "the hooks cost nothing" ask different things.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFromCandidates(name) {
  const candidates = [
    path.join(__dirname, '..', 'hooks', name),          // repo: scripts/ ↔ hooks/ siblings
    path.join(os.homedir(), '.claude', 'hooks', name),  // installed hooks tree
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`cannot locate ${name} in ${candidates.join(' | ')}`);
}

const args = process.argv.slice(2);
// A flag given without a value, or a --since that is not a date, would silently widen or
// garble the filter while the header still claims it was applied. Refused instead.
const refuse = (msg) => { console.error(`meter-report: ${msg}`); process.exit(2); };
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) refuse(`${flag} needs a value`);
  return v;
};
const jsonOnly = args.includes('--json');
const session = take('--session');
const since = take('--since');
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(since)) refuse(`--since must be an ISO date (2026-09-29 or 2026-09-29T10:00:00Z), got "${since}"`);
// The directory rule is the meter's own, so the report reads where the hooks write.
const meter = loadFromCandidates('hook-meter.js');
const OUTCOMES = meter.OUTCOMES;
const dir = take('--dir') || meter.meterDir();

const noRows = (why) => {
  const msg = `no meter rows ${why} (${dir}). Nothing was metered in this scope — that is not a cost of zero.`;
  if (jsonOnly) process.stdout.write(JSON.stringify({ dir, runs: 0, reason: msg }) + '\n');
  else console.log(msg);
  process.exit(2);
};

let files = [];
try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort(); } catch { noRows('— the directory cannot be read'); }

const rows = [];
const unreadable = {};
for (const f of files) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { unreadable[f] = (unreadable[f] || 0) + 1; continue; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { unreadable[f] = (unreadable[f] || 0) + 1; continue; }
    // An outcome outside the meter's three is a malformed row, not a quiet one: counting
    // it as silent would hide it inside a split that is supposed to sum to the runs.
    if (!r || typeof r.hook !== 'string' || typeof r.bytes !== 'number' || typeof r.ms !== 'number'
      || !OUTCOMES.includes(r.outcome)) {
      unreadable[f] = (unreadable[f] || 0) + 1; continue;
    }
    rows.push(r);
  }
}
const kept = rows.filter(r => (!session || r.sid === session) && (!since || String(r.ts) >= since));
const unreadableTotal = Object.values(unreadable).reduce((a, b) => a + b, 0);
if (!kept.length) noRows(session || since ? 'match the filter' : 'in the directory');

// Nearest rank: the smallest value with at least p% of runs at or below it.
const rank = (sorted, p) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
const SMALL = 20;

const hooks = {};
for (const r of kept) {
  const h = hooks[r.hook] || (hooks[r.hook] = { runs: 0, silent: 0, informed: 0, refused: 0, bytes: 0, ms: [], informedBytes: [] });
  h.runs++;
  h[r.outcome]++;
  h.bytes += r.bytes;
  h.ms.push(r.ms);
  if (r.outcome === 'informed') h.informedBytes.push(r.bytes);
}
const summary = {};
for (const [name, h] of Object.entries(hooks)) {
  const ms = [...h.ms].sort((a, b) => a - b);
  const ib = [...h.informedBytes].sort((a, b) => a - b);
  summary[name] = {
    runs: h.runs, silent: h.silent, informed: h.informed, refused: h.refused, bytes: h.bytes,
    median_informed_bytes: ib.length ? rank(ib, 50) : null,
    p50_ms: rank(ms, 50), p95_ms: rank(ms, 95),
  };
}
const sessions = new Set(kept.map(r => r.sid)).size;
const stamps = kept.map(r => String(r.ts)).sort();
const window = { from: stamps[0], to: stamps[stamps.length - 1] };

if (jsonOnly) {
  process.stdout.write(JSON.stringify({ dir, session: session || null, since: since || null, runs: kept.length, sessions, window, unreadable: unreadableTotal, hooks: summary }, null, 2) + '\n');
  process.exit(0);
}

const scope = [session && `session ${session}`, since && `since ${since}`].filter(Boolean).join(', ');
console.log(`hook meter — ${kept.length} runs in ${sessions} session${sessions === 1 ? '' : 's'}, ${window.from} → ${window.to}${scope ? ` (${scope})` : ''}`);
console.log(`  read from ${dir}`);
console.log('  Only runs that finished are here: a run killed from outside (a harness timeout) leaves no row.');
console.log('  Bytes are what each hook wrote to stdout; a refusal\'s copy of its reason on stderr is not counted.');
if (unreadableTotal) {
  console.log(`  ⚠ ${unreadableTotal} unreadable row${unreadableTotal === 1 ? '' : 's'}, not counted: ${Object.entries(unreadable).map(([f, n]) => `${f} ×${n}`).join(', ')}`);
}
console.log('');
const names = Object.keys(summary).sort((a, b) => summary[b].bytes - summary[a].bytes || a.localeCompare(b));
const width = Math.max(...names.map(n => n.length));
for (const n of names) {
  const s = summary[n];
  const p95 = s.runs < SMALL ? `p95 ${s.p95_ms} ms (n=${s.runs}: the max)` : `p95 ${s.p95_ms} ms`;
  const med = s.median_informed_bytes == null ? 'median informed —' : `median informed ${s.median_informed_bytes} B`;
  console.log(`${n.padEnd(width)}  ${String(s.runs).padStart(5)} runs  ${s.silent} silent · ${s.informed} informed · ${s.refused} refused  ${s.bytes} B  ${med}  p50 ${s.p50_ms} ms  ${p95}`);
}
