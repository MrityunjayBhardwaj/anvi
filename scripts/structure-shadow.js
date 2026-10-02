#!/usr/bin/env node
// Read a project check's SHADOW run (issue #600): what it would have refused, and whether the run
// has seen enough to say anything.
//
// The edit-time hook runs a registered package's own check in shadow — it refuses nothing and
// prints nothing, and writes one row per edit to a log (`structure-guard-hook.js` `shadowCheck`).
// This reads that log. It is its own command, not a flag of `structure-refusals.js`, because its
// input is different: the hook's own record, not the session transcripts — a shadow run tells the
// session nothing, so a transcript holds no trace of it.
//
// THE GATE (ruled on #600): the run lasts 7 days or until 10 edits have been judged, whichever is
// later; every would-be refusal is then put to the owner as right or wrong; the check may refuse
// only with zero wrong ones AND at least one chance. So this never prints a pass. A run with no
// chance to refuse is UNTESTED; one with chances has something for the owner to rule on.
//
// Usage: node scripts/structure-shadow.js --package <dir> --since <iso> [--days 7] [--judged 10]
// Exit: 1 something to read (a would-be refusal, an edit to the check, or a row that could not
//       look) · 2 not measured (no check registered for the package, unreadable input) ·
//       3 UNTESTED (nothing to read and no chance to refuse) — never 0.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function loadHook() {
  for (const c of [path.join(__dirname, '..', 'hooks', 'structure-guard-hook.js'), path.join(os.homedir(), '.claude', 'hooks', 'structure-guard-hook.js')]) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error('cannot locate structure-guard-hook.js');
}

function parseArgs(argv) {
  const a = { days: 7, judged: 10 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value`); return argv[++i]; };
    if (k === '--package') a.package = v();
    else if (k === '--since') a.since = v();
    else if (k === '--days') a.days = Number(v());
    else if (k === '--judged') a.judged = Number(v());
    else if (k === '--registry') a.registry = v();
    else if (k === '--state') a.state = v();
    else throw new Error(`unrecognised argument — ${k}`);
  }
  if (!a.package) throw new Error('--package is required');
  if (!a.since || Number.isNaN(Date.parse(a.since))) throw new Error('--since <iso time> is required — the run is read from when the check was registered');
  if (!(a.days >= 0) || !(a.judged >= 0)) throw new Error('--days and --judged take numbers');
  return a;
}

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// The reading, from the rows alone — exported so the test drives it without a filesystem.
function read(rows, { since, now, days, judged: needJudged }) {
  const by = o => rows.filter(r => r.outcome === o);
  const judged = by('judged');
  const chances = [];
  const onList = [];
  for (const r of judged) for (const a of r.added || []) (a.onList ? onList : chances).push({ ...a, row: r });
  const landed = new Set(judged.flatMap(r => (r.landed || []).map(x => `${r.rel} ${x}`)));
  const why = {};
  for (const r of by('not-measured')) why[r.why] = (why[r.why] || 0) + 1;
  const elapsed = (now - Date.parse(since)) / 864e5;
  const periodMet = elapsed >= days && judged.length >= needJudged;
  const toRead = chances.length > 0 || by('check-file').length > 0 || by('not-measured').length > 0;
  return { rows: rows.length, judged, outside: by('outside').length, checkFile: by('check-file'), shape: by('edit-shape').length,
    notMeasured: by('not-measured').length, why, chances, onList, landed: [...landed], elapsed, periodMet,
    ms: { p50: pct(rows.map(r => r.ms).filter(Number.isFinite), 0.5), max: pct(rows.map(r => r.ms).filter(Number.isFinite), 1) },
    exit: toRead ? 1 : 3 };
}

function report(rd, a, logPath) {
  const out = [];
  out.push(`structure-shadow: ${a.package} · ${a.since} → now (${rd.elapsed.toFixed(1)} days)`);
  out.push(`  log: ${logPath}`);
  out.push(`  edits recorded: ${rd.rows} — ${rd.judged.length} judged · ${rd.outside} outside the check's population · ` +
    `${rd.checkFile.length} to the check's own files · ${rd.shape} in an edit shape not modelled · ${rd.notMeasured} NOT MEASURED`);
  for (const [w, n] of Object.entries(rd.why)) out.push(`    not measured ×${n}: ${w}`);
  out.push(`  time per edit: median ${rd.ms.p50 === null ? '—' : rd.ms.p50 + ' ms'} · slowest ${rd.ms.max === null ? '—' : rd.ms.max + ' ms'}`);
  out.push(`  reaches added: ${rd.chances.length + rd.onList.length} — ${rd.onList.length} on the project's exception list · ` +
    `${rd.chances.length} NOT on it (each a chance to refuse)`);
  if (rd.landed.length) out.push(`  already on disk and off the list (landed outside any edit hook, not charged to an edit): ${rd.landed.length}`);
  if (rd.chances.length) {
    out.push('', '  WOULD-BE REFUSALS — the owner rules each one right or wrong:');
    for (const c of rd.chances)
      out.push(`    ${c.row.ts} · ${c.row.session || 'no session'} · ${c.row.checkout === 'registered' ? '' : 'worktree · '}${c.row.rel} · ${c.rule} ${c.reach}` +
        (c.row.graph === 'deny' ? ' (the graph rule refused this edit too)' : ''));
  }
  if (rd.checkFile.length) {
    out.push('', '  EDITS TO THE CHECK ITSELF — a design change, put to the owner, never judged by the check:');
    for (const r of rd.checkFile) out.push(`    ${r.ts} · ${r.session || 'no session'} · ${r.checkout === 'registered' ? '' : 'worktree · '}${r.rel}`);
  }
  out.push('', `  period: ${rd.elapsed.toFixed(1)} of ${a.days} days · ${rd.judged.length} of ${a.judged} edits judged — ` +
    (rd.periodMet ? 'MET' : 'NOT YET (whichever is later)'));
  out.push(rd.chances.length
    ? `  SHADOW READING: ${rd.chances.length} would-be refusal${rd.chances.length === 1 ? '' : 's'} to rule on. It may refuse only if every one is ruled right${rd.periodMet ? '' : ', and the period is not yet over'}.`
    : `  SHADOW READING: UNTESTED — 0 chances to refuse in ${rd.judged.length} judged edits. This is neither a pass nor a failure.`);
  return out.join('\n');
}

function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (e) { console.log(`structure-shadow: NOT MEASURED — ${e.message}`); process.exit(2); }
  const H = loadHook();
  const regPath = a.registry || H.REGISTRY;
  let registry;
  try { registry = JSON.parse(fs.readFileSync(regPath, 'utf8')); }
  catch (e) { console.log(`structure-shadow: NOT MEASURED — cannot read the registry ${regPath}: ${e.message}`); process.exit(2); }
  let pkg;
  try { pkg = fs.realpathSync(a.package); } catch { console.log(`structure-shadow: NOT MEASURED — no such package ${a.package}`); process.exit(2); }
  const entry = (registry.packages || []).find(e => { try { return fs.realpathSync(e.dir) === pkg; } catch { return false; } });
  if (!entry || !entry.check) {
    console.log(`structure-shadow: NOT MEASURED — ${regPath} registers no check for ${pkg}, so there is no shadow run to read`);
    process.exit(2);
  }
  const logPath = H.shadowLogPath(a.state || H.STATE_DIR, entry.dir);
  let text = '';
  try { text = fs.readFileSync(logPath, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') { console.log(`structure-shadow: NOT MEASURED — cannot read ${logPath}: ${e.message}`); process.exit(2); } }
  const rows = [];
  let bad = 0;
  for (const line of text.split('\n').filter(Boolean)) { try { rows.push(JSON.parse(line)); } catch { bad++; } }
  if (bad) { console.log(`structure-shadow: NOT MEASURED — ${bad} unreadable line${bad === 1 ? '' : 's'} in ${logPath}`); process.exit(2); }
  const since = Date.parse(a.since);
  const rd = read(rows.filter(r => Date.parse(r.ts) >= since), { since: a.since, now: Date.now(), days: a.days, judged: a.judged });
  console.log(report(rd, a, logPath));
  process.exit(rd.exit);
}

module.exports = { read, report, parseArgs };
if (require.main === module) main();
