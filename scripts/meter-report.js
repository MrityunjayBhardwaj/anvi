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
// With --workflows it reports workflow reads instead (#527 step 6): per workflow, reads,
// sessions and the last read, beside when recording began. That is a PROXY for command
// use — a skill reads its workflow to run it, but a read is not a completed run — and
// the report says so every time. A command unused for a window is only evidence once
// recording began before the window did.
//
// With --summary it prints ONE line — runs, hooks, bytes to the context, the slowest p95
// — for the wrap and the session report to quote (#527 step 5); no rows is one line too.
//
// Usage: node scripts/meter-report.js [--workflows] [--summary] [--session <id>] [--since <ISO date>] [--dir <meter dir>] [--json]
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
  // An empty value is refused too (#593): an unset shell variable expands to "", and ""
  // would switch the filter off — "this session" silently becoming "every session".
  if (v === undefined || v === '' || v.startsWith('--')) refuse(`${flag} needs a value`);
  return v;
};
const jsonOnly = args.includes('--json');
const summaryOnly = args.includes('--summary');
const session = take('--session');
const since = take('--since');
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(since)) refuse(`--since must be an ISO date (2026-09-29 or 2026-09-29T10:00:00Z), got "${since}"`);
// The directory rule is the meter's own, so the report reads where the hooks write.
const meter = loadFromCandidates('hook-meter.js');
const OUTCOMES = meter.OUTCOMES;
const dir = take('--dir') || meter.meterDir();

const noRows = (why) => {
  const msg = summaryOnly
    ? `hook cost${session ? `, session ${session}` : ''}: NOT MEASURED — no meter rows ${why} (${dir}); that is not a cost of zero.`
    : `no meter rows ${why} (${dir}). Nothing was metered in this scope — that is not a cost of zero.`;
  if (jsonOnly) process.stdout.write(JSON.stringify({ dir, runs: 0, reason: msg }) + '\n');
  else console.log(msg);
  process.exit(2);
};

if (args.includes('--workflows')) workflowReport();

function workflowReport() {
  const wdir = meter.workflowReadsDir({ ANVI_METER_DIR: dir });
  const none = (why) => {
    const msg = `no workflow-read rows ${why} (${wdir}). Nothing was recorded in this scope — that is not evidence a command went unused.`;
    if (jsonOnly) process.stdout.write(JSON.stringify({ dir: wdir, reads: 0, proxy: true, reason: msg }) + '\n');
    else console.log(msg);
    process.exit(2);
  };
  let wfiles = [];
  try { wfiles = fs.readdirSync(wdir).filter(f => f.endsWith('.jsonl')).sort(); } catch { none('— the directory cannot be read'); }
  const all = [];
  const bad = {};
  for (const f of wfiles) {
    let text = '';
    try { text = fs.readFileSync(path.join(wdir, f), 'utf8'); } catch { bad[f] = (bad[f] || 0) + 1; continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch { bad[f] = (bad[f] || 0) + 1; continue; }
      if (!r || typeof r.workflow !== 'string' || typeof r.ts !== 'string') { bad[f] = (bad[f] || 0) + 1; continue; }
      all.push(r);
    }
  }
  const badTotal = Object.values(bad).reduce((a, b) => a + b, 0);
  if (!all.length) none('in the directory');
  // When recording began is never filtered: it is what any "unused for N days" is measured against.
  const began = all.map(r => r.ts).sort()[0];
  const kept = all.filter(r => (!session || r.sid === session) && (!since || r.ts >= since));
  if (!kept.length) none('match the filter');
  const per = {};
  for (const r of kept) {
    const w = per[r.workflow] || (per[r.workflow] = { reads: 0, sids: new Set(), last: r.ts });
    w.reads++; w.sids.add(r.sid);
    if (r.ts > w.last) w.last = r.ts;
  }
  const workflows = {};
  for (const [n, w] of Object.entries(per)) workflows[n] = { reads: w.reads, sessions: w.sids.size, last: w.last };
  const sessions = new Set(kept.map(r => r.sid)).size;
  const days = Math.floor((Date.now() - Date.parse(began)) / 86400000);
  if (jsonOnly) {
    process.stdout.write(JSON.stringify({ dir: wdir, proxy: true, session: session || null, since: since || null,
      reads: kept.length, sessions, recording_began: began, unreadable: badTotal, workflows }, null, 2) + '\n');
    process.exit(0);
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const scope = [session && `session ${session}`, since && `since ${since}`].filter(Boolean).join(', ');
  console.log(`workflow reads — ${plural(kept.length, 'read')} of ${plural(Object.keys(workflows).length, 'workflow')} in ${plural(sessions, 'session')}${scope ? ` (${scope})` : ''}`);
  console.log(`  read from ${wdir}`);
  console.log('  A PROXY for command use: a Read of ~/.claude/anvi/workflows/<name>.md. A read is not a completed run, and');
  console.log('  a long workflow read in parts is several reads — sessions is the closer figure.');
  console.log(`  recording began ${began} (${plural(days, 'day')} ago); no command can be called unused for longer than that.`);
  if (badTotal) console.log(`  ⚠ ${plural(badTotal, 'unreadable row')}, not counted: ${Object.entries(bad).map(([f, n]) => `${f} ×${n}`).join(', ')}`);
  console.log('');
  const names = Object.keys(workflows).sort((a, b) => workflows[b].sessions - workflows[a].sessions || workflows[b].reads - workflows[a].reads || a.localeCompare(b));
  const width = Math.max(...names.map(n => n.length));
  for (const n of names) {
    const w = workflows[n];
    console.log(`${n.padEnd(width)}  ${plural(w.reads, 'read').padStart(9)}  ${plural(w.sessions, 'session').padStart(11)}  last ${w.last}`);
  }
  process.exit(0);
}

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

if (summaryOnly) {
  const n = Object.keys(summary).length;
  const slow = Object.entries(summary).sort((a, b) => b[1].p95_ms - a[1].p95_ms || a[0].localeCompare(b[0]))[0];
  const bytes = Object.values(summary).reduce((a, h) => a + h.bytes, 0);
  const small = slow[1].runs < SMALL ? ` (n=${slow[1].runs}: the max)` : '';
  const where = [session && `session ${session}`, since && `since ${since}`].filter(Boolean).join(', ') || `${sessions} session${sessions === 1 ? '' : 's'}`;
  console.log(`hook cost, ${where}: ${kept.length} runs of ${n} hook${n === 1 ? '' : 's'} · ${bytes} B to the context · `
    + `slowest p95 ${slow[0]} ${slow[1].p95_ms} ms${small}`
    + `${unreadableTotal ? ` · ⚠ ${unreadableTotal} unreadable row${unreadableTotal === 1 ? '' : 's'} not counted` : ''}`
    + ' · a run killed by a timeout leaves no row');
  process.exit(0);
}

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
