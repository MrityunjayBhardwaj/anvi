#!/usr/bin/env node
// Test: the write-scope check (#716) — a write outside the placed task's radius is refused with the
// radius named; a write inside is not; every other answer prints in its own words.
//
// TWO PARTS. The hook and the record run everywhere: a fixture package, a design with ruled jobs,
// synthetic signatures (as in place.test.js), the radius drawn by scripts/write-scope.js's own
// radiusFor/recordFor, and the hook driven through real stdin with a hermetic HOME. The command
// (--place over the project's TypeScript) runs when STRUCTURE_TS_FROM names a directory TypeScript 5
// resolves from; otherwise the skip says how many cases and why.
//
// MUST BE ABLE TO FAIL. Two mutant copies of the hook — the radius predicate forced to "inside",
// and forced to "outside" — are run on the same inputs, and the cases that separate them are
// asserted to flip. A radius test that a hook answering "inside" to everything also passes is no test.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'write-scope-guard.js');
const SCRIPT = path.join(ROOT, 'scripts', 'write-scope.js');
const WSS = require(SCRIPT);
const WS = require(HOOK);
const PL = require(path.join(ROOT, 'scripts', 'place.js'));
const SV = require(path.join(ROOT, 'scripts', 'signature-vectors.js'));
const R = require(path.join(ROOT, 'hooks', 'structure-rules.js'));
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-scope-')));
const HOME = path.join(DIR, 'home');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });

// ── the fixture package and its design ──────────────────────────────────────────────────────
const P = path.join(DIR, 'pkg');
const put = (rel, text) => { const f = path.join(P, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
for (const f of ['src/engine/audio.ts', 'src/engine/decode.ts', 'src/viz/scope.ts', 'src/viz/bars.ts', 'src/viz/peaks.ts', 'src/ws/registry.ts']) put(f, '// fixture\n');
put('README.md', '# fixture\n');
const purpose = n => ({ dirs: [n], purpose: `the ${n} part of the fixture` });
const lib = () => ({ kind: 'library', reach: 'process', owner: null });
const job = (home, resources, doors = []) => ({ home, resources, doors, reason: 'ownership', ruled: '2026-11-05' });
const D = { root: 'src', components: { engine: purpose('engine'), viz: purpose('viz'), ws: purpose('ws') }, allowed: [],
  resources: { snd: lib(), codec: lib(), p5: lib(), chart: lib(), 'src/ws/registry.ts#register': { kind: 'door', reach: 'process', owner: 'ws' } },
  jobs: { load: job('engine', ['snd']), decode: job('engine', ['codec']), scope: job('viz', ['p5']), reg: job('ws', ['chart'], ['src/ws/registry.ts#register']) } };
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify(D));
ok(R.designProblem(D) === null, `the fixture design can be judged against (${R.designProblem(D)})`);

const M = o => new Map(Object.entries(o));
const F = (file, component, res) => ({ file, component, passthrough: false, doors: new Map(), unresolved: {}, direct: new Set(Object.keys(res)),
  views: { resources: M(res), types: M({}), calls: M({}), vocabulary: M({}) } });
// peaks.ts is a second home of sound loading: a viz file touching snd directly.
const sig = new Map([F('src/engine/audio.ts', 'engine', { 'lib:snd': 1 }), F('src/engine/decode.ts', 'engine', { 'lib:codec': 1 }),
  F('src/viz/scope.ts', 'viz', { 'lib:p5': 1 }), F('src/viz/bars.ts', 'viz', { 'lib:chart': 1 }), F('src/viz/peaks.ts', 'viz', { 'lib:snd': 1 }),
  F('src/ws/registry.ts', 'ws', {})].map(s => [s.file, s]));
const OPTS = { far: 0.8, band: 0.1, central: 0.2 };
const owners = PL.ownersOf(sig, D).owners;

// A scope record exactly as the script writes one, for a placement `p` (real or constructed).
function placeRecord(sid, p, task, { design = D, designPath = DESIGN, prior = null } = {}) {
  const r = WSS.radiusFor({ p, sig, design, task, ix: null, changesDoors: [], pkgDir: P });
  const rec = WSS.recordFor({ sid, pkgDir: P, designPath, design, settingsId: 'fixture00000', typescript: 'none', task, p,
    notes: r.notes, radius: r.radius, ruledJobs: r.ruledJobs, prior });
  WSS.writeRecord(STATE, sid, rec);
  return rec;
}
const fire = (sid, rel, { tool = 'Edit', hook = HOOK, home = HOME, raw = null } = {}) => {
  const r = spawnSync(process.execPath, [hook], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: home },
    input: raw !== null ? raw : JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: tool, cwd: P,
      tool_input: { file_path: path.isAbsolute(rel) ? rel : path.join(P, rel), old_string: 'fixture', new_string: 'x', replace_all: false } }) });
  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { out = { unparsed: r.stdout }; }
  const h = out.hookSpecificOutput || {};
  return { code: r.status, denied: h.permissionDecision === 'deny', reason: h.permissionDecisionReason || '', ctx: h.additionalContext || '', stdout: r.stdout || '', stderr: r.stderr || '' };
};
const runScript = (args, home = HOME) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, HOME: home } }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

console.log('\nA RADIUS DRAWN FROM A HOME PLACEMENT — inside allowed, outside refused with the radius named:');
const texts = {};
{
  const task = { id: 'load-a-sound', about: 'fixture: load a sound', resources: ['snd'], files: [] };
  const p = PL.place(PL.taskVector(sig, D, task, { weights: { direct: 1 } }).vec, owners, OPTS);
  ok(p.outcome === 'home' && p.home === 'engine' && p.job === 'load', `PLACE answers HOME engine, nearest job load (${PL.describe(p)})`);
  const rec = placeRecord('home-1', p, task);
  // The ledger's own answer, computed here apart from the record: job load's member files.
  const ledger = SV.jobMembers(sig, D.jobs.load, D.resources).members.map(s => s.file).sort();
  ok(ledger.join() === 'src/engine/audio.ts,src/viz/peaks.ts', `the ledger derives job load's member files: ${ledger.join(', ')}`);
  ok(rec.radius.jobs.length === 1 && rec.radius.jobs[0].files.join() === ledger.join(), 'the record holds exactly those files for job load');

  const out = fire('home-1', 'src/viz/scope.ts');
  texts.outside = out.reason;
  ok(out.code === 2 && out.denied, `a write to src/viz/scope.ts (job scope, not placed) is REFUSED (exit ${out.code})`);
  const listed = (out.reason.match(/job load \(home engine\), no door ruled: ([^\n]*)/) || [])[1];
  ok(listed === ledger.join(', '), `the printed radius matches the ledger (${listed})`);
  ok(/radius_size 2 files \(1 placed job, 0 door callers, 0 declared new\) · widenings 0 · placements 1/.test(out.reason), 'the radius size, widenings and placements print on the refusal');
  ok(/src\/viz\/scope\.ts belongs to job scope \(home viz\)\. No door into job scope is ruled/.test(out.reason), 'it names the job the file belongs to, and that no door is ruled into it');
  ok(/--widen src\/viz\/scope\.ts --why/.test(out.reason), 'it gives the widening command for that file');
  ok(/second homes, in the radius so the task can remove them\): src\/viz\/peaks\.ts/.test(out.reason), 'a second home of the job is in the radius and printed apart as one');

  const door = fire('home-1', 'src/ws/registry.ts');
  ok(door.denied && /belongs to job reg \(home ws\)\. Reach it through its door src\/ws\/registry\.ts#register from a file inside the radius/.test(door.reason),
    'a file of a job with a ruled door: refused, and the door to use is named');
  const inside = fire('home-1', 'src/engine/audio.ts');
  ok(inside.code === 0 && !inside.denied && inside.stdout === '', 'a write inside the radius (src/engine/audio.ts) is NOT refused, and nothing is said');
  const second = fire('home-1', 'src/viz/peaks.ts');
  ok(second.code === 0 && !second.denied, 'a write to the job\'s second home (src/viz/peaks.ts) is inside the radius');
  const multi = fire('home-1', 'src/viz/bars.ts', { tool: 'MultiEdit' });
  ok(multi.denied && /belongs to no ruled job|belongs to job/.test(multi.reason), 'MultiEdit is judged by its file_path like Write and Edit');
  const write = fire('home-1', 'src/viz/scope.ts', { tool: 'Write' });
  ok(write.denied, 'a Write outside the radius is refused too');
  const read = fire('home-1', 'src/viz/scope.ts', { tool: 'Read' });
  ok(read.code === 0 && read.stdout === '', 'a Read is none of its business');

  const readme = fire('home-1', 'README.md');
  texts.corpus = readme.ctx;
  ok(readme.code === 0 && !readme.denied && /outside the ledger's corpus/.test(readme.ctx), 'a file outside the ledger\'s corpus is allowed and SAID, not passed as inside');
  const elsewhere = fire('home-1', path.join(DIR, 'other', 'x.ts'));
  ok(elsewhere.code === 0 && !elsewhere.denied && /outside .* the package this session's task was placed in/.test(elsewhere.ctx), 'a file in another package is allowed and said');

  // Widening: a request with a reason, counted, printed on the next refusal.
  const noWhy = runScript(['--widen', 'src/viz/scope.ts', '--session', 'home-1']);
  ok(noWhy.code === 2 && /needs --why/.test(noWhy.out), 'a widening without a reason is refused (exit 2)');
  const w = runScript(['--widen', 'src/viz/scope.ts', '--why', 'fixture: the owner said the scope view loads its own sound', '--session', 'home-1']);
  ok(w.code === 0 && /radius_size 3 files .* widenings 1 .* \(was 2 files\)/.test(w.out), `widening prints the new size and the count (${(w.out.match(/radius_size.*/) || [''])[0]})`);
  ok(!fire('home-1', 'src/viz/scope.ts').denied, 'the widened file is now inside');
  const after = fire('home-1', 'src/viz/bars.ts');
  ok(after.denied && /widenings 1/.test(after.reason) && /widened [^\n]*: src\/viz\/scope\.ts — "fixture: the owner said/.test(after.reason), 'the next refusal prints the widening and its reason');
  const wj = runScript(['--widen', 'scope', '--why', 'fixture: a whole job', '--session', 'home-1']);
  ok(wj.code === 0 && /widenings 2/.test(wj.out), 'a job id widens by the job\'s member files, counted');
  const show = runScript(['--show', '--session', 'home-1']);
  ok(show.code === 0 && /judged writes: 8 = 3 inside \+ 5 refused outside the radius/.test(show.out) && /refused files: .*src\/viz\/scope\.ts/.test(show.out),
    `--show counts the hook's own rows (${(show.out.match(/judged writes: .*/) || [''])[0]})`);

  // Re-placing in the same session keeps the widenings and is counted.
  const again = placeRecord('home-1', p, task, { prior: WSS.readRecord(STATE, 'home-1') });
  ok(again.placements === 2 && again.widenings.length === 2 && /placements 2 \(re-placed 1 time this session\)/.test(WS.sizeLine(again)), 'a re-placement is counted and keeps the widenings');
}

console.log('\nANSWERS THAT NEED THE OWNER\'S RULING — refused, each in its own words:');
{
  const ct = { outcome: "couldn't tell", why: 'calls disagrees with resources; the owner rules', views: [], lead: 'resources',
    disagreement: [{ view: 'calls', verdict: 'one', owners: ['viz'], d: 0.1, lead: { verdict: 'one', owners: ['engine'], d: 0.5 } }] };
  placeRecord('ct-1', ct, { id: 'odd', resources: ['snd'] });
  const r = fire('ct-1', 'src/engine/audio.ts');
  texts.couldnt = r.reason;
  ok(r.denied && /NO RADIUS YET — PLACE COULDN'T TELL/.test(r.reason) && /disagreement: calls says viz \(0\.100\), resources says engine \(0\.500\)/.test(r.reason),
    'couldn\'t tell: even the file PLACE leaned toward is refused, the disagreement printed');
  ok(!/is outside this task's radius/.test(r.reason), 'couldn\'t tell never reads as "outside a radius"');

  const task = { id: 'stranger', resources: ['lib:zzz'] };
  const none = PL.place(PL.taskVector(sig, D, task, { weights: { direct: 1 } }).vec, owners, OPTS);
  ok(none.outcome === 'no existing home', `a task sharing nothing with any owner: ${PL.describe(none)}`);
  placeRecord('none-1', none, task);
  const n = fire('none-1', 'src/engine/audio.ts');
  texts.none = n.reason;
  ok(n.denied && /NO EXISTING HOME/.test(n.reason) && /never the nearest/.test(n.reason), 'no existing home: refused, never sent to the nearest owner');

  const nj = { outcome: 'home', home: 'engine', source: 'ruled', job: null, jobNote: 'new job in engine', views: [] };
  const rec = placeRecord('new-1', nj, { id: 'new', resources: ['snd'], files: ['src/engine/fresh.ts', 'src/viz/fresh.ts'] });
  ok(rec.radius.newFiles.map(x => x.file).join() === 'src/engine/fresh.ts' && rec.notes.some(x => /src\/viz\/fresh\.ts: a declared new file in viz, which the placement did not name as a home/.test(x)),
    'a declared new file counts only inside a named home; one elsewhere is noted, not added');
  ok(!fire('new-1', 'src/engine/fresh.ts', { tool: 'Write' }).denied, 'new job: the declared new file in the home is inside');
  const nv = fire('new-1', 'src/viz/fresh.ts', { tool: 'Write' });
  texts.newjob = nv.reason;
  ok(nv.denied && /No ruled job is near the task in engine/.test(nv.reason), 'new job: a declared file outside the home is refused, and why is said');
  ok(nv.denied && fire('new-1', 'src/engine/audio.ts').denied, 'new job: an existing engine file is not in the radius either (no job was ruled)');
}

console.log('\nTHE GUARD\'S OWN IGNORANCE — allowed, and said, never printed as "inside" or "no radius":');
{
  // No record, the package registered: NO RADIUS, once.
  const regHome = path.join(DIR, 'home-reg');
  fs.mkdirSync(path.join(regHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(regHome, '.claude', 'structure-guard.json'), JSON.stringify({ packages: [{ dir: P, design: DESIGN, baseline: path.join(DIR, 'baseline.json') }] }));
  const nr = fire('noplace-1', 'src/viz/scope.ts', { home: regHome });
  texts.noradius = nr.ctx;
  ok(nr.code === 0 && !nr.denied && /NO RADIUS — this session placed no task/.test(nr.ctx) && /--place --design/.test(nr.ctx), 'no placed task in a registered package: allowed, NO RADIUS said with the command to place');
  ok(fire('noplace-1', 'src/viz/bars.ts', { home: regHome }).stdout === '', 'said once per session, not on every write');
  ok(fire('noplace-2', 'src/viz/scope.ts').stdout === '', 'no record and no registry: silent (inert)');

  WSS.writeRecord(STATE, 'np-1', WSS.recordFor({ sid: 'np-1', pkgDir: P, designPath: DESIGN, design: D, settingsId: 'x', typescript: 'none', task: { id: 't' },
    p: { outcome: 'not placed', why: 'could not look: no view has both a task feature and an owner prototype', views: [] }, notes: [], radius: null, ruledJobs: {}, prior: null }));
  const np = fire('np-1', 'src/viz/scope.ts');
  texts.unplaced = np.ctx;
  ok(np.code === 0 && !np.denied && /NOT MEASURED — PLACE could not look/.test(np.ctx), 'PLACE could not look: allowed, NOT MEASURED said');

  const D2 = path.join(DIR, 'design-moving.json');
  fs.writeFileSync(D2, JSON.stringify(D));
  const task = { id: 'load-a-sound', resources: ['snd'] };
  placeRecord('stale-1', PL.place(PL.taskVector(sig, D, task, { weights: { direct: 1 } }).vec, owners, OPTS), task, { designPath: D2 });
  ok(fire('stale-1', 'src/viz/scope.ts').denied, 'CONTROL: before the design moves, the outside write is refused');
  fs.writeFileSync(D2, JSON.stringify({ ...D, jobs: { ...D.jobs, load: job('engine', ['snd'], ['src/engine/audio.ts#play']) } }));
  const st = fire('stale-1', 'src/viz/bars.ts');
  texts.stale = st.ctx;
  ok(st.code === 0 && !st.denied && /NOT MEASURED — the design changed since this task was placed/.test(st.ctx) && /jobs \w{12} → \w{12}/.test(st.ctx),
    'a jobs table changed since placement (a door added; the design id alone would not move): allowed, NOT MEASURED, the change named');

  fs.mkdirSync(WS.scopeDir(STATE), { recursive: true });
  fs.writeFileSync(WS.recordPath(STATE, 'bad-1'), '{ not json');
  const bad = fire('bad-1', 'src/viz/scope.ts');
  ok(bad.code === 0 && !bad.denied && /NOT MEASURED — this session's scope record is not valid JSON/.test(bad.ctx), 'an unreadable record: allowed, NOT MEASURED said');
  const junk = fire('x', '', { raw: 'not json at all{{' });
  ok(junk.code === 0 && junk.stdout === '', 'malformed stdin: exit 0, silent');
}

console.log('\nDISTINCT WORDS — no outcome prints another outcome\'s marker:');
{
  const MARK = { outside: /is outside this task's radius/, couldnt: /COULDN'T TELL/, none: /NO EXISTING HOME/, newjob: /No ruled job is near the task/,
    noradius: /NO RADIUS —/, unplaced: /PLACE could not look/, stale: /the design changed since/, corpus: /outside the ledger's corpus/ };
  // One overlap is the truth, not a collision: a "new job" placement HAS a radius (its declared new
  // files), so a write beyond it is outside that radius, and the refusal says both.
  const SHARES = { newjob: ['outside'] };
  for (const [k, t] of Object.entries(texts)) {
    const others = Object.entries(MARK).filter(([j, re]) => j !== k && !(SHARES[k] || []).includes(j) && re.test(t)).map(([j]) => j);
    ok(MARK[k].test(t) && !others.length, `${k}: carries its own marker and none of ${others.length ? others.join(', ') : 'the others'}`);
  }
}

console.log('\nMUTANTS — the radius predicate forced each way must turn these cases red:');
{
  const mutant = (name, from, to) => {
    const dir = path.join(DIR, `hooks-${name}`);
    fs.cpSync(path.join(ROOT, 'hooks'), dir, { recursive: true });
    const f = path.join(dir, 'write-scope-guard.js');
    const src = fs.readFileSync(f, 'utf8');
    ok(src.includes(from), `${name}: the predicate line is found to mutate`);
    fs.writeFileSync(f, src.replace(from, to));
    return f;
  };
  const LINE = 'if (radius.has(rel)) return';
  const always = mutant('always-inside', LINE, 'if (true) return');
  const never = mutant('never-inside', LINE, 'if (false) return');
  ok(!fire('home-1', 'src/viz/bars.ts', { hook: always }).denied, 'always-inside: the outside write is NOT refused — the refusal case above would go red');
  ok(fire('home-1', 'src/engine/audio.ts', { hook: never }).denied, 'never-inside: the inside write IS refused — the inside case above would go red');
}

const GATED = 8;
console.log('\nTHE COMMAND ON REAL TYPESCRIPT — run when STRUCTURE_TS_FROM names a directory TypeScript 5 resolves from:');
{
  const from = process.env.STRUCTURE_TS_FROM;
  let tsDir = null;
  try { tsDir = from && path.dirname(require.resolve('typescript/package.json', { paths: [from] })); } catch { tsDir = null; }
  if (!tsDir) console.log(`  – SKIPPED ${GATED} cases, NOT MEASURED here: ${from ? `no TypeScript resolvable from ${from}` : 'STRUCTURE_TS_FROM is not set'}`);
  else {
    const before = pass + fail;
    const Q = path.join(DIR, 'tspkg');
    const q = (rel, text) => { const f = path.join(Q, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    q('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true }, include: ['src'] }));
    q('src/engine/audio.ts', "import { samples } from 'snd';\nexport function loadSound(n: string) { return samples(n); }\n");
    q('src/engine/decode.ts', "import { decode } from 'codec';\nexport function decodeSound(b: ArrayBuffer) { return decode(b); }\n");
    q('src/viz/scope.ts', "import p5 from 'p5';\nexport function drawScopeSound() { return new p5(); }\n");
    q('src/viz/player.ts', "import { loadSound } from '../engine/audio';\nexport function play() { return loadSound('kick'); }\n");
    const TD = { root: 'src', components: { engine: purpose('engine'), viz: purpose('viz') }, allowed: [['viz', 'engine']],
      resources: { snd: lib(), codec: lib(), p5: lib(), 'src/engine/audio.ts#loadSound': { kind: 'door', reach: 'process', owner: 'engine' } },
      jobs: { load: job('engine', ['snd'], ['src/engine/audio.ts#loadSound']), decode: job('engine', ['codec']), scope: job('viz', ['p5']) } };
    const td = path.join(DIR, 'ts-design.json');
    fs.writeFileSync(td, JSON.stringify(TD));
    const base = ['--design', td, '--package', Q, '--typescript', tsDir];
    const r1 = runScript(['--place', ...base, '--task-resources', 'snd', '--changes-door', 'src/engine/audio.ts#loadSound', '--session', 'ts-1']);
    ok(r1.code === 0 && /outcome: HOME engine — nearest job load/.test(r1.out), `--place: HOME engine, job load (exit ${r1.code}; ${(r1.out.match(/outcome: .*/) || ['none'])[0]})`);
    ok(/job load \(home engine\), doors src\/engine\/audio\.ts#loadSound: src\/engine\/audio\.ts\n/.test(r1.out) && /callers of changed door src\/engine\/audio\.ts#loadSound: src\/viz\/player\.ts/.test(r1.out),
      'the radius is job load\'s member file, plus the caller of the door the task changes');
    // The ledger's answer from the index command itself, beside the record's.
    const ix = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ownership-index.js'), ...base, '--task-resources', 'snd'], { encoding: 'utf8', timeout: 120000 });
    ok(/job load \(home engine\): 1 member file/.test(ix.stdout || ''), 'ownership-index.js counts the same 1 member file for job load');
    const tsFire = rel => { const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME },
      input: JSON.stringify({ session_id: 'ts-1', tool_name: 'Edit', cwd: Q, tool_input: { file_path: path.join(Q, rel), old_string: 'a', new_string: 'b' } }) });
      return { code: r.status, out: r.stdout || '' }; };
    const out = tsFire('src/viz/scope.ts');
    ok(out.code === 2 && /src\/viz\/scope\.ts belongs to job scope \(home viz\)/.test(out.out), 'the hook refuses a write to the visualizer file, naming its job');
    ok(tsFire('src/viz/player.ts').code === 0 && tsFire('src/engine/audio.ts').code === 0, 'the door\'s caller and the job\'s file are inside');
    const r2 = runScript(['--place', ...base, '--task-resources', 'lib:nothing-here', '--session', 'ts-2']);
    ok(r2.code === 3 && /NO EXISTING HOME/.test(r2.out), `a task far from every owner: exit 3, NO EXISTING HOME (${(r2.out.match(/outcome: .*/) || ['none'])[0]})`);
    const r3 = runScript(['--place', ...base, '--session', 'ts-3']);
    ok(r3.code === 2 && /names no resource and no file/.test(r3.out), 'a task naming nothing: NOT MEASURED, exit 2');
    const ran = pass + fail - before;
    ok(ran + 1 === GATED, `the skip count matches the cases this block runs (${ran + 1} of ${GATED})`);
  }
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
