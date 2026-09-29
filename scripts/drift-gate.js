#!/usr/bin/env node
// drift-gate.js — is a project past its drift ceiling, and where would one batch start? (#530)
//
// Drift has no counter-pressure: entries drift faster than anyone re-validates them. The
// ruling puts a ceiling on it (references/drift-ceiling.json): past it, a session
// re-validates one BATCH before it wraps. A batch is a coherent group — the drifted
// entries citing one file — never a sweep, because a sweep becomes a rubber stamp.
// Grouped by FILE, not directory: on anvi a top directory held up to 157 drifted
// entries (a sweep by another name), while 132 of 140 cited files hold 15 or fewer.
//
// The count is read from the shipped currency report's --json, never re-derived here:
// drifted = primary entries (occurrence 1) whose verdict is YELLOW or RED, over every
// primary entry. A continuation shares its primary's verdict, so it is not counted twice.
//
// Usage: node scripts/drift-gate.js [--ceiling-file F] [project-dir]
//        node scripts/drift-gate.js --batch <file-or-path-prefix> [project-dir]
// Exit:  0 measured, at or under the ceiling (or: a --batch listing, even an empty one)
//        1 measured, over the ceiling — one batch is owed
//        2 NOT MEASURED — the report failed or found no entries, or the ceiling is unreadable.
//          Never 0: "could not look" must not read as "nothing drifted".
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const notMeasured = (why) => { console.log(`drift: NOT MEASURED — ${why}`); process.exit(2); };

const ceilingFile = take('--ceiling-file') || path.join(__dirname, '..', 'references', 'drift-ceiling.json');
const batch = take('--batch');
if (args.includes('--batch') || args.includes('--ceiling-file')) notMeasured('a flag was given without its value');
if (args.length > 1) notMeasured(`one project directory expected, got: ${args.join(' ')}`);
const dir = path.resolve(args[0] || process.cwd());

let ceiling;
try { ceiling = JSON.parse(fs.readFileSync(ceilingFile, 'utf8')).ceiling_percent; } catch (e) {
  notMeasured(`the ceiling could not be read from ${ceilingFile} (${e.message})`);
}
if (typeof ceiling !== 'number' || !(ceiling >= 0 && ceiling <= 100)) {
  notMeasured(`ceiling_percent in ${ceilingFile} is not a number from 0 to 100 (got ${JSON.stringify(ceiling)})`);
}

// The shipped report, from the same install tree as this script.
const REPORT = path.join(__dirname, 'currency-report.js');
const r = spawnSync(process.execPath, [REPORT, '--json', dir],
  { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) {
  const said = (r.stderr || r.stdout || '').trim().split('\n')[0] || (r.error && r.error.message) || 'no output';
  notMeasured(`the currency report exited ${r.status === null ? `by signal ${r.signal}` : r.status}: ${said}`);
}
let report;
try { report = JSON.parse(r.stdout); } catch { notMeasured('the currency report did not return JSON'); }

const primaries = (report.entries || []).filter(e => e.occurrence === 1);
if (!primaries.length) notMeasured(`no catalogue entries in ${report.catalogues_dir || dir} — nothing to count`);
const drifted = primaries.filter(e => e.status === 'YELLOW' || e.status === 'RED');
// The files that put an entry in a batch: those that changed (YELLOW) and those that are
// gone (RED — the report lists them in `gone`, not in `drifted`).
const filesOf = (e) => [...(e.drifted || []), ...(e.gone ? e.gone.split(', ') : [])];

if (batch !== undefined) {
  const hits = drifted.filter(e => filesOf(e).some(f => f.startsWith(batch)));
  if (!hits.length) { console.log(`no drifted primary entry cites a file under ${batch}`); process.exit(0); }
  console.log(`${hits.length} drifted primary ${hits.length === 1 ? 'entry cites' : 'entries cite'} a file under ${batch}:`);
  for (const e of hits) {
    console.log(`  ${e.catalogue} ${e.id}  [${e.anchor}]  ${e.status === 'RED' ? 'gone: ' : ''}${filesOf(e).filter(f => f.startsWith(batch)).join(', ')}`);
  }
  process.exit(0);
}

const pct = (100 * drifted.length) / primaries.length;
// Integer comparison, so 25% of 4 entries is exactly 1 and "at the ceiling" is within.
const over = drifted.length * 100 > ceiling * primaries.length;
console.log(`drift: ${drifted.length} of ${primaries.length} primary entries (${pct.toFixed(1)}%) are drifted (yellow or red)` +
  ` — ceiling ${ceiling}% (${Math.floor((ceiling * primaries.length) / 100)} entries) → ${over ? 'OVER' : 'within'}`);
const s = report.states;
if (s) {
  console.log(`  freshness: verified ${s.verified} · drifted ${s.drifted} · never confirmed ${s['never confirmed']} · not checked ${s['not checked']}`);
}
if (!over) process.exit(0);

// Where a batch could start: drifted primaries grouped by each file that changed or is
// gone. An entry citing two files is counted under both.
const groups = new Map();
for (const e of drifted) {
  for (const f of new Set(filesOf(e))) groups.set(f, (groups.get(f) || 0) + 1);
}
const ranked = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
console.log('  one batch is owed before this session wraps. Drifted entries by cited file (an entry citing two is under both):');
for (const [g, n] of ranked.slice(0, 8)) console.log(`    ${g.padEnd(40)} ${n}`);
if (ranked.length > 8) console.log(`    …and ${ranked.length - 8} more ${ranked.length - 8 === 1 ? 'file' : 'files'}`);
console.log(`  list one: node '${__filename}' --batch <file> '${dir}'`);
process.exit(1);
