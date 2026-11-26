#!/usr/bin/env node
// live-judge.js — after an admitted ruling, compare the live test before and after it, and flag a
// ruling (or the guard) for reopening without anyone reading the numbers (#715, design §5.1 the
// judge, §5.4 step 8, §7.4a rules 2–5, 12, 16).
//
// WHAT IT IS FOR. A ruling that moves code is admitted on a predicted structural effect. Nothing
// checked afterwards whether the agent's path on real tasks got shorter or longer, so the ratchet
// could only tighten the structure and never learn that a move made work costlier. The judge reads
// two live-test reports, one under the design before the ruling and one under the design after,
// and decides mechanically. Its exit code is the flag.
//
// THE ORDER IS THE DESIGN'S, AND IT IS NOT NEGOTIABLE.
//   1. Placement first. Every replay's edits must land in the home the ledger names. An out-of-home
//      edit after the move is a flag, whatever it did to cost:
//        - with a fall in files edited, it is SPRAWL — a refusal that failed to fire. It reopens
//          the GUARD, not the ruling, and it is never printed as an improvement;
//        - otherwise it is MISPLACED, and it reopens the RULING.
//   2. A refusal answered by a rewrite is sprawl caused by the guard (rule 2): a flag on the guard.
//   3. Principled cost only among placed tasks, and only against principled cost (rule 5): a task
//      that was misplaced before and is placed now is a BASELINE — the first placed measurement —
//      and is compared to nothing.
//   4. Cost per placed task: files read, files edited, components touched, attempts, edits outside
//      the blast radius. Each is compared range against range over the replays:
//        - after's lowest above before's highest by at least the smallest effect → RISE, and the
//          ruling is flagged (realized worse than before, Theorem 6);
//        - after's highest below before's lowest by at least the smallest effect → fall;
//        - separated by less than the smallest effect → no change (below the smallest effect);
//        - overlapping → "underpowered, n replays" (rule 12), unless the smallest effect is ruled
//          and both spreads are narrower than it, which makes it "no change". An unruled smallest
//          effect never yields "no change".
//   Refusals are counted and their outcomes printed, never summed into cost (rule 4). Edits outside
//   the radius print beside the radius size and the widening count (rule 16).
//
// THE REPORT IT READS (one per design; the live-test runner, #711, writes it):
//   { "designId": "<id>", "date": "<ISO>", "tasks": { "<task>": { "home": ["<component>", …],
//       "replays": [ { "inHome": <edits in the home>, "outOfHome": <edits writing the job elsewhere>,
//                      "filesRead": n, "filesEdited": n, "componentsTouched": n, "attempts": n,
//                      "outsideRadius": n, "radiusSize": n, "widenings": n,
//                      "refusals": [ { "outcome": "reuse" | "rewrite" | "abandon" } ] }, … ] } } }
// The two reports must hold the same tasks: the task set is fixed. A missing task, a replay
// missing a field, or fewer than two replays is NOT MEASURED for that task, never a pass.
//
// Usage:
//   node scripts/live-judge.js --before <report.json> --after <report.json> [--ruling <label>]
//        (--project <name> | --settings <file>) [--json <out.json>]
//
// Exit: 0 every task judged, nothing flagged · 1 a flag: a ruling or the guard to reopen (a person
//       acts on it) · 2 NOT MEASURED (bad arguments or input, a task missing from either report or
//       not judgeable) · 3 nothing flagged, but at least one verdict was underpowered — "could not
//       tell" never prints as "fine".
'use strict';

const fs = require('fs');
const path = require('path');
const PS = require('./project-settings.js');

const COST = ['filesRead', 'filesEdited', 'componentsTouched', 'attempts', 'outsideRadius'];
const NUMERIC = ['inHome', 'outOfHome', ...COST, 'radiusSize', 'widenings'];
const OUTCOMES = new Set(['reuse', 'rewrite', 'abandon']);
const MIN_REPLAYS = 2;

const range = xs => ({ min: Math.min(...xs), max: Math.max(...xs) });
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = r => r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;

// Why a replay cannot be read, or null.
function replayProblem(r, i) {
  if (!r || typeof r !== 'object') return `replay ${i + 1} is not an object`;
  for (const k of NUMERIC) if (!Number.isInteger(r[k]) || r[k] < 0) return `replay ${i + 1}: "${k}" must be a whole number ≥ 0, got ${JSON.stringify(r[k])}`;
  if (!Array.isArray(r.refusals)) return `replay ${i + 1}: "refusals" must be a list`;
  const bad = r.refusals.find(x => !x || !OUTCOMES.has(x.outcome));
  if (bad) return `replay ${i + 1}: a refusal's outcome must be reuse, rewrite or abandon, got ${JSON.stringify(bad && bad.outcome)}`;
  return null;
}
function taskProblem(t, side) {
  if (!t) return `absent from the ${side} report — the task set is fixed`;
  if (!Array.isArray(t.replays)) return `${side}: no "replays" list`;
  if (t.replays.length < MIN_REPLAYS) return `${side}: ${t.replays.length} replay(s) — a spread needs at least ${MIN_REPLAYS}`;
  for (let i = 0; i < t.replays.length; i++) { const p = replayProblem(t.replays[i], i); if (p) return `${side}: ${p}`; }
  return null;
}

// One cost metric, before against after. `effect` is the ruled smallest effect, or null.
function compare(b, a, effect, n) {
  const B = range(b), A = range(a);
  const gapUp = A.min - B.max, gapDown = B.min - A.max;
  const need = effect == null ? 1 : effect;     // with no ruling, any separation is a difference
  if (gapUp > 0) return gapUp >= need ? { verdict: 'RISE', B, A } : { verdict: 'no change', why: `separated by ${gapUp}, below the smallest effect ${effect}`, B, A };
  if (gapDown > 0) return gapDown >= need ? { verdict: 'fall', B, A } : { verdict: 'no change', why: `separated by ${gapDown}, below the smallest effect ${effect}`, B, A };
  if (effect != null && B.max - B.min < effect && A.max - A.min < effect) return { verdict: 'no change', why: `both spreads narrower than the smallest effect ${effect}`, B, A };
  return { verdict: 'underpowered', why: `the spreads overlap${effect == null ? ' and the smallest effect is not ruled' : ''}`, B, A };
}

function judgeTask(name, before, after, effect, radiusComparable = true) {
  const out = { task: name, flags: [], lines: [], verdicts: {} };
  const pb = taskProblem(before, 'before'), pa = taskProblem(after, 'after');
  if (pb || pa) { out.notMeasured = [pb, pa].filter(Boolean).join('; '); return out; }
  const rb = before.replays, ra = after.replays;
  const n = Math.min(rb.length, ra.length);
  const misB = rb.filter(r => r.outOfHome > 0).length, misA = ra.filter(r => r.outOfHome > 0).length;
  const edB = rb.map(r => r.filesEdited), edA = ra.map(r => r.filesEdited);
  out.lines.push(`placement   before: ${rb.length - misB} of ${rb.length} replays placed · after: ${ra.length - misA} of ${ra.length} placed (out-of-home edits after: ${fmt(range(ra.map(r => r.outOfHome)))})`);

  // 1. Placement first.
  if (misA) {
    const fell = median(edA) < median(edB);
    if (fell) {
      out.flags.push({ reopen: 'guard', why: 'SPRAWL' });
      out.lines.push(`SPRAWL      files edited fell (median ${median(edB)} → ${median(edA)}) WITH ${misA} replay(s) writing the job outside its home: a refusal that failed to fire — reopens the GUARD, not the ruling; not an improvement`);
    } else {
      out.flags.push({ reopen: 'ruling', why: 'MISPLACED' });
      out.lines.push(`MISPLACED   ${misA} of ${ra.length} replays wrote the job outside the home the ledger names (${(after.home || []).join(', ') || 'home not given'}) — reopens the RULING`);
    }
  }
  // 2. A rewrite after a refusal.
  const rewrites = ra.reduce((s, r) => s + r.refusals.filter(x => x.outcome === 'rewrite').length, 0);
  const outcomes = ['reuse', 'rewrite', 'abandon'].map(o => `${o} ${ra.reduce((s, r) => s + r.refusals.filter(x => x.outcome === o).length, 0)}`).join(' · ');
  out.lines.push(`refusals    after: ${ra.reduce((s, r) => s + r.refusals.length, 0)} over ${ra.length} replays (${outcomes}) — counted, never summed into cost`);
  if (rewrites) {
    out.flags.push({ reopen: 'guard', why: 'REWRITE AFTER REFUSAL' });
    out.lines.push(`SPRAWL      ${rewrites} refusal(s) answered by a rewrite: sprawl caused by the guard — reopens the GUARD`);
  }
  if (misA) return out;                         // cost is read only among placed tasks

  // 3. Principled cost only against principled cost.
  if (misB) {
    out.baseline = true;
    out.lines.push(`BASELINE    misplaced before (${misB} of ${rb.length} replays), placed now: the first placed measurement — compared to nothing`);
    return out;
  }
  // 4. Cost, range against range.
  for (const k of COST) {
    const c = compare(rb.map(r => r[k]), ra.map(r => r[k]), effect, n);
    out.verdicts[k] = c.verdict;
    const extra = k === 'outsideRadius' ? ` · radius ${radiusComparable ? `${fmt(range(rb.map(r => r.radiusSize)))} → ${fmt(range(ra.map(r => r.radiusSize)))}` : 'NOT COMPARABLE (the two reports size it in different units)'}, widenings ${fmt(range(rb.map(r => r.widenings)))} → ${fmt(range(ra.map(r => r.widenings)))}` : '';
    out.lines.push(`${k.padEnd(18)} ${fmt(c.B)} → ${fmt(c.A)}   ${c.verdict === 'underpowered' ? `underpowered, ${n} replays` : c.verdict}${c.why ? ` (${c.why})` : ''}${extra}`);
    if (c.verdict === 'RISE') out.flags.push({ reopen: 'ruling', why: `${k} ROSE` });
  }
  if (out.flags.some(f => f.reopen === 'ruling')) out.lines.push('REOPEN      realized worse than before on a placed task — reopens the RULING');
  return out;
}

function judge(before, after, effect) {
  const names = [...new Set([...Object.keys(before.tasks || {}), ...Object.keys(after.tasks || {})])].sort();
  // A report with no radiusUnit was scored before #785, with the radius in another unit.
  const radiusComparable = (before.radiusUnit || null) === (after.radiusUnit || null);
  return names.map(n => judgeTask(n, (before.tasks || {})[n], (after.tasks || {})[n], effect, radiusComparable));
}

function parse(argv) {
  const args = {}, bad = [];
  const VALUED = new Set(['before', 'after', 'ruling', 'project', 'settings', 'json']);
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i]).replace(/^--/, '');
    if (!String(argv[i]).startsWith('--') || !VALUED.has(k)) { bad.push(`unknown argument ${argv[i]}`); continue; }
    const v = argv[++i];
    if (v === undefined || String(v).startsWith('--')) { bad.push(`--${k} needs a value`); i--; continue; }
    if (args[k] !== undefined) bad.push(`--${k}: given twice`); else args[k] = v;
  }
  return { args, bad };
}

function main(argv) {
  const print = s => console.log(s);
  const stop = why => { print(`live-judge: NOT MEASURED — ${why}`); return 2; };
  const { args, bad } = parse(argv);
  if (bad.length) return stop(bad.join('; '));
  if (!args.before || !args.after) return stop('give --before <report.json> and --after <report.json>');
  if (!args.project && !args.settings) return stop('give --project <name> or --settings <file>: the smallest effect is a ruling');
  const read = (f, what) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (!d || typeof d.tasks !== 'object' || Array.isArray(d.tasks) || !d.tasks) throw new Error('no "tasks" object'); return d; } catch (e) { throw new Error(`the ${what} report ${f}: ${e.message}`); } };
  let before, after;
  try { before = read(args.before, 'before'); after = read(args.after, 'after'); } catch (e) { return stop(e.message); }
  if (!before.designId || !after.designId) return stop('each report must name the design it was measured under ("designId")');
  if (before.designId === after.designId) print(`live-judge: note — both reports name design ${before.designId}; a ruling that changed nothing in the design is judged as a re-run`);
  const settings = PS.load(args.settings ? { file: args.settings } : { project: args.project });
  if (settings.refused) return stop(`settings refused: ${settings.refused.join('; ')}`);
  const e = PS.need(settings, 'judge.smallestEffect');
  const effect = e.notMeasured ? null : e.value;

  print(`live-judge.js · ${new Date().toISOString()}${args.ruling ? ` · ruling ${args.ruling}` : ''}`);
  print(`before      design ${before.designId} · ${before.date || 'no date'} · ${path.resolve(args.before)}`);
  print(`after       design ${after.designId} · ${after.date || 'no date'} · ${path.resolve(args.after)}`);
  print(PS.headline(settings));
  print(`effect      ${effect == null ? `NOT RULED — ${e.notMeasured}; no difference inside a spread can read "no change"` : `smallest effect worth acting on: ${effect} (${e.source})`}`);

  const results = judge(before, after, effect);
  for (const r of results) {
    print(`\n── task ${r.task}`);
    if (r.notMeasured) { print(`   NOT MEASURED — ${r.notMeasured}`); continue; }
    for (const l of r.lines) print(`   ${l}`);
  }
  const flagged = results.filter(r => r.flags.length), unread = results.filter(r => r.notMeasured);
  const under = results.filter(r => !r.notMeasured && Object.values(r.verdicts).includes('underpowered'));
  const ruling = flagged.filter(r => r.flags.some(f => f.reopen === 'ruling')).map(r => r.task);
  const guard = flagged.filter(r => r.flags.some(f => f.reopen === 'guard')).map(r => r.task);
  print(`\nTASKS ${results.length}: ${flagged.length} flagged · ${unread.length} NOT MEASURED · ${under.length} with an underpowered verdict · ${results.filter(r => r.baseline).length} baseline`);
  print(`REOPEN THE RULING: ${ruling.length ? ruling.join(', ') : 'no task'}`);
  print(`REOPEN THE GUARD:  ${guard.length ? guard.join(', ') : 'no task'}`);
  const code = flagged.length ? 1 : unread.length ? 2 : under.length ? 3 : 0;
  print(`VERDICT     ${['nothing flagged, every task judged', 'FLAGGED — a person acts on it', 'NOT MEASURED — a task could not be judged, so nothing is cleared', 'nothing flagged, but UNDERPOWERED — could not tell is not fine'][code]}`);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify({ tool: 'live-judge.js', ruling: args.ruling || null, before: before.designId, after: after.designId,
    settingsId: settings.id, smallestEffect: effect, exit: code, tasks: results }, null, 1) + '\n');
  return code;
}

module.exports = { judge, judgeTask, compare, main };

if (require.main === module) {
  process.on('uncaughtException', err => { console.log(`live-judge: NOT MEASURED — the judge crashed: ${(err && err.message || String(err)).split('\n')[0]}`); process.exit(2); });
  process.exitCode = main(process.argv.slice(2));
}
