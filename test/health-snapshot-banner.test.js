#!/usr/bin/env node
// The snapshot-series line's four states (anvi #318).
//
// WHY THIS FILE EXISTS. The catalogue-health report's product is a diff against
// the previous snapshot, so the series only continues while snapshots keep being
// taken — and a series that stopped produces no output at all, which is exactly
// what a healthy quiet week produces. Nothing distinguished them.
//
// WHAT IS ASSERTED HARDEST. Not that a line appears — that it is SILENT while the
// series is healthy, and that the ways of not-knowing are never folded together.
// "No snapshot has been taken" and "the directory could not be read" look alike
// and mean opposite things about whether anything is wrong. A standing line that
// reported health every session would be the wallpaper this whole subsystem
// exists to avoid, so the silence is the load-bearing assertion here.
//
// EVERY CASE DRIVES THE SHIPPED HOOK over stdin: the claim is about what a
// session is told, and a session is told whatever this hook emits.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const has = (hay, n, m) => { const y = String(hay).includes(n); ok(y, y ? m : `${m} (missing ${JSON.stringify(n)}, got ${JSON.stringify(String(hay).slice(0, 200))})`); };
const hasNot = (hay, n, m) => ok(!String(hay).includes(n), m);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-health-')));
const HOOK = path.join(__dirname, '..', 'hooks', 'ground-truth-session-start.js');
const TOOL = path.join(__dirname, '..', 'scripts', 'catalogue-health.js');

/** A throwaway HOME whose store holds exactly the snapshots named. */
function home(name, snapshots, opts = {}) {
  const h = path.join(TMP, name);
  const inst = path.join(h, '.anvideck', 'projects', 'anvi', 'instances');
  if (opts.noStore) fs.mkdirSync(h, { recursive: true });
  else if (opts.noInstances) fs.mkdirSync(path.join(h, '.anvideck', 'projects'), { recursive: true });
  else {
    fs.mkdirSync(inst, { recursive: true });
    for (const s of snapshots) fs.writeFileSync(path.join(inst, s), '{}\n');
    if (opts.chmod !== undefined) fs.chmodSync(inst, opts.chmod);
  }
  return h;
}

/** A project with catalogue entries, so the banner gets past its early exit. */
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, '.anvi'), { recursive: true });
fs.writeFileSync(path.join(PROJ, '.anvi', 'hetvabhasa.md'), '# H\n## H1: x\n**REF:** src/a.js\nbody\n');

/** Just the health segment of the banner, or '' when none is emitted. */
function healthLine(h) {
  const r = spawnSync('node', [HOOK], {
    cwd: PROJ, encoding: 'utf8', env: { ...process.env, HOME: h },
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  const i = ctx.indexOf('📅');
  return { line: i >= 0 ? ctx.slice(i) : '', all: ctx, exit: r.status };
}

const today = new Date();
const iso = d => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);

console.log('\nsilence is the healthy state, and it is the point');
{
  const r = healthLine(home('fresh', [`health-${iso(1)}.json`]));
  ok(r.line === '', 'a snapshot taken yesterday produces NO health line at all');
  has(r.all, 'GROUNDING', 'control: the banner itself was still emitted');
  ok(r.exit === 0, 'and the hook exits 0');
}
{
  const r = healthLine(home('edge', [`health-${iso(6)}.json`]));
  ok(r.line === '', 'six days is inside the cadence — still silent');
}

console.log('\nan aged series says how old, and names the command that clears it');
{
  const r = healthLine(home('stale', [`health-${iso(12)}.json`]));
  has(r.line, '12d old', 'it reports the age');
  has(r.line, iso(12), 'and names the snapshot it measured from');
  has(r.line, '/anvi:refresh', 'and names the command');
}
{
  // The NEWEST wins: an old snapshot sitting beside a recent one is not staleness.
  const r = healthLine(home('mixed', [`health-${iso(40)}.json`, `health-${iso(2)}.json`]));
  ok(r.line === '', 'an old snapshot beside a recent one is still current');
}

console.log('\nthe ways of not-knowing are kept apart');
{
  const r = healthLine(home('empty', [], { noInstances: true }));
  has(r.line, 'no catalogue-health snapshot yet', 'a store with no snapshot says the series has not started');
  hasNot(r.line, 'could not be read', 'and does not claim it failed to read anything');
}
{
  const r = healthLine(home('nostore', [], { noStore: true }));
  ok(r.line === '', 'no store at all is silence — there is no fleet to measure');
}
{
  const r = healthLine(home('locked', [`health-${iso(30)}.json`], { chmod: 0o000 }));
  has(r.line, 'could not be read', 'an unreadable directory says so');
  has(r.line, 'UNKNOWN, not fine', 'and refuses to read as healthy');
  hasNot(r.line, '0d old', 'and never renders as an age');
  fs.chmodSync(path.join(TMP, 'locked', '.anvideck', 'projects', 'anvi', 'instances'), 0o755);
}
{
  const r = healthLine(home('junk', ['health-notadate.json', 'README.md']));
  has(r.line, 'no catalogue-health snapshot yet', 'files that are not snapshots do not count as one');
}

console.log('\nage is read from the NAME, not from mtime');
{
  const h = home('mtime', [`health-${iso(30)}.json`]);
  // A fresh checkout stamps every file with the time it was written locally.
  const f = path.join(h, '.anvideck', 'projects', 'anvi', 'instances', `health-${iso(30)}.json`);
  fs.utimesSync(f, new Date(), new Date());
  has(healthLine(h).line, '30d old', 'a just-touched file 30 days old by name still reads as 30d');
}

console.log('\nthe reader and the writer agree on where the series lives');
{
  // Two definitions of one path drift apart in silence, so the writer is ASKED
  // rather than assumed — this executes the real resolution in catalogue-health.js.
  const where = execFileSync('node', [TOOL, '--where'], { encoding: 'utf8' }).trim();
  const expected = path.join(os.homedir(), '.anvideck', 'projects', 'anvi', 'instances');
  ok(where === expected, `the writer writes where the banner reads (${where})`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
