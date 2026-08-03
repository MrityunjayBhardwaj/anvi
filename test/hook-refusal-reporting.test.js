#!/usr/bin/env node
// A refusal must not be reported as an absence — asserted at the HOOK layer,
// which is where the enforcement actually reaches a reader.
//
// THE PROBLEM THIS EXISTS FOR:
// the resolver declines to serve a directory that cannot prove it owns a store
// project, and that decline arrives as `null` — the same value it returns when
// nothing exists at all. Three hooks merged the two and told the model the
// knowledge was MISSING, then offered, as the remedy for missing knowledge, to
// create some. `/anvi:ground` creates `ref/sources/` under the store project
// selected by this directory's NAME, so the advice aimed a write at exactly the
// project the caller had just failed to prove it owned. The guard held and its
// own outcome was reported as its opposite.
//
// It failed in the direction that erases the evidence: a project whose knowledge
// is withheld looked, in the transcript, exactly like a project that never had
// any — so the one signal that would prompt someone to fix the binding was the
// signal that disappeared. The true reason WAS written, to stderr, where nothing
// reads it; a true message nobody acts on is indistinguishable from silence.
//
// TWO HALVES, failing for different reasons:
//
//   BEHAVIOUR — real hook processes against a hermetic store in three states.
//               Every door is checked, and the door set is DERIVED from the code,
//               so a new hook that resolves and mis-reports fails here instead of
//               joining quietly. A hook is allowed to stay SILENT on a refusal;
//               it is not allowed to speak and claim absence.
//
//   CONTROL   — the verified caller must actually be served. Without that, every
//               "no leak" assertion below passes vacuously on a broken fixture.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-refuse-')));

const git = (cwd, ...a) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// --- fixtures ---------------------------------------------------------------
// A store project carrying knowledge, bound to ONE worktree. Every marker below
// is planted so a leak is detectable by content rather than by byte count.
const MARKERS = {
  boundary:  'REFUSETEST-BOUNDARY',
  pattern:   'REFUSETEST-PATTERN',
  invariant: 'REFUSETEST-INVARIANT',
  gt:        'REFUSETEST-GROUNDTRUTH',
  protocol:  'REFUSETEST-PROTOCOL',
};

function storeProject(name) {
  const d = path.join(TMP, '.anvideck', 'projects', name);
  fs.mkdirSync(path.join(d, '.anvi'), { recursive: true });
  fs.mkdirSync(path.join(d, 'ref'), { recursive: true });
  fs.mkdirSync(path.join(d, 'investigations'), { recursive: true });
  fs.writeFileSync(path.join(d, '.anvi', 'dharana.md'),
    `# Dharana\n### B1: ${MARKERS.boundary} engine boundary\nFILES: src/engine.js\n` +
    '**REF:** ref/GROUND_TRUTH_RUNTIME.md#stage-2\n' +
    `Silent failure modes: ${MARKERS.boundary} swallows an unknown parameter\nPatterns: H1\n`);
  fs.writeFileSync(path.join(d, '.anvi', 'hetvabhasa.md'),
    `# Hetvabhasa\n## H1: ${MARKERS.pattern} — a parameter renamed on one side\n` +
    '**REF:** src/engine.js\n**FIX:** n/a\n');
  fs.writeFileSync(path.join(d, '.anvi', 'vyapti.md'),
    `# Vyapti\n## V1: ${MARKERS.invariant} — one resolver\n**REF:** src/engine.js\n`);
  fs.writeFileSync(path.join(d, '.anvi', 'krama.md'), '# Krama\n');
  fs.writeFileSync(path.join(d, 'ref', 'GROUND_TRUTH_RUNTIME.md'),
    `# GT\n## stage-2\n${MARKERS.gt}\n`);
  // A COMPLETE protocol: the experiment guard stays silent when the latest one
  // is filled in, so the served case must be the quiet one and only the refused
  // case may speak. Anything less and "it spoke" would prove nothing.
  fs.writeFileSync(path.join(d, 'investigations', 'exp-001-thing.md'),
    `# exp-001 ${MARKERS.protocol}\n## Hypothesis\nThe rate is wrong.\n` +
    '## Predicted Outcome\nIt reads 44100.\n## Source Code Basis\nsrc/engine.js:1\n');
  return d;
}

function repo(dir, remote) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  git(dir, 'init', '-q', '.');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dir, 'src', 'engine.js'), 'module.exports = 1;\n');
  return dir;
}

const REMOTE = 'git@github.com:acme/victim.git';
const sp = storeProject('victim');
const served  = repo(path.join(TMP, 'work',      'victim'), REMOTE);
const mismatch = repo(path.join(TMP, 'elsewhere', 'victim'), 'git@github.com:mallory/other.git');

const IDENT = require(path.join(HOOKS, 'anvi-identity.js'));
IDENT.writeProvenance(sp, IDENT.identityOf(served));

// A third state: a store project with knowledge and NO record at all.
const spU = storeProject('unboundproj');
fs.rmSync(path.join(spU, IDENT.PROVENANCE), { force: true });
const unbound = repo(path.join(TMP, 'nowhere', 'unboundproj'), null);

// --- the door set, DERIVED --------------------------------------------------
// Anything in hooks/ that resolves through the shared resolver is a door. Listing
// them instead would let a new hook skip this file in silence, which is the exact
// failure mode the whole suite exists to prevent.
const REQUIRES_PATHS = /require\(\s*['"]\.\/anvi-paths\.js['"]\s*\)/;
const doors = fs.readdirSync(HOOKS)
  .filter(f => f.endsWith('.js') && f !== 'anvi-paths.js')
  .filter(f => REQUIRES_PATHS.test(fs.readFileSync(path.join(HOOKS, f), 'utf8')));

// One payload per door — the stdin that makes that hook SPEAK. A door with no
// payload is a failure, not a skip: that is how the derivation stays load-bearing.
const payloadFor = (hook, dir) => {
  const file = path.join(dir, 'src', 'engine.js');
  switch (hook) {
    case 'ground-truth-session-start.js':
      return { hook_event_name: 'SessionStart' };
    case 'catalogue-context-injector.js':
      return { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } };
    case 'debug-grounding-gate.js':
      return { hook_event_name: 'UserPromptSubmit', prompt: 'this is broken, debug the failing test' };
    case 'experiment-protocol-guard.js':
      return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'node tools/diagnose-rate.js' } };
    case 'catalogue-id-leak-guard.js':
      return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: "git commit -m 'fix H21 and V14'" } };
    case 'provenance-guard.js':
      return { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(sp, '.anvi', 'hetvabhasa.md') } };
    default:
      return null;
  }
};

let sid = 0;
function fire(hook, dir, extraEnv) {
  const p = payloadFor(hook, dir);
  if (!p) return null;
  const r = spawnSync(process.execPath, [path.join(HOOKS, hook)], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ session_id: `refuse-${++sid}`, cwd: dir, ...p }),
    env: { ...process.env, HOME: TMP, ...(extraEnv || {}) },
  });
  return { out: r.stdout || '', err: r.stderr || '', code: r.status };
}

// What the injected context says, not the wire format around it.
const contextOf = (r) => {
  try { return JSON.parse(r.out).hookSpecificOutput.additionalContext || ''; }
  catch { return r.out; }
};

// ---------------------------------------------------------------- control ---
// Assert the fixture can be served AT ALL before asserting anything is withheld.
// Every "no leak" check below is vacuously true against a store nobody can read.
console.log('control: the verified worktree is actually served');
{
  const inj = fire('catalogue-context-injector.js', served);
  const ctx = contextOf(inj);
  ok(ctx.includes(MARKERS.boundary), 'injector serves the boundary to the recorded worktree');
  ok(ctx.includes(MARKERS.pattern), 'injector serves the error pattern to the recorded worktree');

  const ss = contextOf(fire('ground-truth-session-start.js', served));
  ok(/GROUNDING: \d+\/\d+/.test(ss), `session-start reports grounding to the recorded worktree (${ss.slice(0, 40)})`);
  ok(ss.includes(MARKERS.gt.replace('REFUSETEST-', '')) || /GT docs:/.test(ss),
    'session-start names the Ground Truth doc it can see');

  const eg = fire('experiment-protocol-guard.js', served);
  ok(eg.out.length === 0, 'experiment guard is quiet when it can read a complete protocol');

  const dg = contextOf(fire('debug-grounding-gate.js', served));
  ok(dg.includes('Ground Truth docs available'), 'debug gate lists the docs it can see');
  ok(!/NOT BEING SERVED|NOT SERVED/.test(dg), 'debug gate says nothing about a refusal when there is none');
}

// ------------------------------------------------------------- no leaking ---
// The guard's own job, re-asserted here because the reporting fix must not have
// loosened it. Content, not size: a byte count cannot tell knowledge from prose.
console.log('\nbehaviour: nothing is served to a caller that cannot prove ownership');
const SECRETS = Object.values(MARKERS);
for (const [label, dir] of [['MISMATCH', mismatch], ['UNBOUND', unbound]]) {
  for (const hook of doors) {
    const r = fire(hook, dir);
    if (!r) { ok(false, `${hook} has no payload in this file — add one (derived door set)`); continue; }
    const leaked = SECRETS.filter(s => r.out.includes(s));
    ok(leaked.length === 0, `${label}: ${hook} serves no knowledge${leaked.length ? ' — LEAKED ' + leaked.join(',') : ''}`);
  }
}

// -------------------------------------------------- refusal is not absence ---
// The rule, over EVERY door: a hook may stay silent on a refusal, but if it
// speaks it must not assert the knowledge is missing, and must not advise
// creating what was actually withheld.
console.log('\nbehaviour: a refusal is never reported as an absence');
const ABSENCE_CLAIMS = [
  /NO Ground Truth docs found/i,
  /No experiment protocol found/i,
  /Consider running \/anvi:ground first/i,
  /NO Ground Truth docs — consider/i,
];
for (const [label, dir] of [['MISMATCH', mismatch], ['UNBOUND', unbound]]) {
  for (const hook of doors) {
    const r = fire(hook, dir);
    if (!r) continue; // already failed above
    const ctx = contextOf(r);
    const claimed = ABSENCE_CLAIMS.filter(re => re.test(ctx));
    ok(claimed.length === 0,
      `${label}: ${hook} claims no absence${claimed.length ? ' — SAID ' + claimed[0] : ''}`);
  }
}

// The three reporting hooks must go further than silence: they are the ones a
// reader consults for this exact information, so they must NAME the state and
// carry a remedy that will work.
console.log('\nbehaviour: the reporting hooks name the state and a remedy that works');
for (const [label, dir, state] of [['MISMATCH', mismatch, 'MISMATCH'], ['UNBOUND', unbound, 'UNBOUND']]) {
  for (const hook of ['ground-truth-session-start.js', 'debug-grounding-gate.js', 'experiment-protocol-guard.js']) {
    const ctx = contextOf(fire(hook, dir));
    ok(ctx.includes(state), `${label}: ${hook} names the state`);
    // UNBOUND is fixed by binding; MISMATCH is deliberately NOT automated, so the
    // remedy there is the record's path. Either way a reader gets a next action.
    ok(/bind-store\.js|PROVENANCE\.json/.test(ctx), `${label}: ${hook} carries an actionable remedy`);
  }
}

// The specifically harmful advice, checked by name in the one hook that gave it.
console.log('\nbehaviour: the refused caller is not sent to a command that writes');
{
  const ctx = contextOf(fire('debug-grounding-gate.js', mismatch));
  ok(/Do NOT run \/anvi:ground/.test(ctx), 'debug gate warns against the command that would write into the store');
  const eg = contextOf(fire('experiment-protocol-guard.js', mismatch));
  ok(!/Create investigations\/exp-NNN\.md/.test(eg), 'experiment guard does not tell a refused caller to create a protocol');
  ok(/Fix the binding/.test(eg), 'experiment guard sends the refused caller at the binding instead');
}

// ------------------------------------------------------------ falsification ---
// Each assertion must be capable of failing. The absence-claim checks are the
// ones at risk of passing vacuously — if a hook simply never speaks, "it claimed
// no absence" is trivially true. So drive the hooks at a caller that genuinely
// HAS nothing, and require the very phrases forbidden above to appear there.
console.log('\nfalsification: the forbidden phrases are still said where they are TRUE');
{
  const bare = repo(path.join(TMP, 'bare', 'noproject'), null);
  fs.mkdirSync(path.join(bare, '.anvi'), { recursive: true });
  fs.writeFileSync(path.join(bare, '.anvi', 'hetvabhasa.md'),
    '# Hetvabhasa\n## H1: a local entry\n**REF:** src/engine.js\n**FIX:** n/a\n');
  const dg = contextOf(fire('debug-grounding-gate.js', bare));
  ok(/NO Ground Truth docs found/.test(dg),
    'a project with a local .anvi and genuinely no docs still gets the plain absence message');
  const eg = contextOf(fire('experiment-protocol-guard.js', bare));
  ok(/No experiment protocol found/.test(eg) && /Create investigations\/exp-NNN\.md/.test(eg),
    'a project genuinely without a protocol is still told to create one');
}

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(fail === 0 ? 0 : 1);
