#!/usr/bin/env node
// Integration test: the currency verdict must actually reach the injector's output.
//
// WHY THIS EXISTS, separately from the mocked unit suite:
// the injector wraps its currency block in a blanket catch, because the hook's
// exit-0 contract is absolute — a freshness annotation must never cost the checks.
// That guard fails OPEN: any error in the block (a missing import, a renamed
// export, a bad path) deletes the whole feature and still exits 0, still injects
// the checks, and says nothing. The unit suite cannot see it — every function it
// tests passes in isolation while the wiring between them is broken.
//
// This is not hypothetical. A commit landed calling capNudges() without importing
// it: 59/59 green, hook exit 0, checks intact, currency silently gone.
//
// So the assertion is deliberately end-to-end: spawn the hook the way the harness
// does and require the verdict to come out the other side.
//
// The fixtures are hermetic — a throwaway repo the test builds and commits itself,
// never this checkout. An earlier version asserted against the real catalogues,
// which are untracked: in a fresh clone it found nothing and took a SKIP branch,
// exiting 0 with nothing to say. That reproduced the very defect it guards — a
// test that skips is a test that fails open, and silence read as health in the one
// environment (a fresh install) that matters most. Owning the fixtures also pins
// the expected verdicts, instead of asserting on whatever the live corpus says
// today.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const HOOK = path.join(__dirname, '..', 'hooks', 'catalogue-context-injector.js');

// fs.realpathSync: on macOS os.tmpdir() is a /var/folders symlink and the hook
// canonicalizes paths — the fixture must agree with it or the assertions test nothing.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-cur-')));

const git = (a, cwd) => execSync(`git ${a}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
const commit = (dir, msg) => {
  git('add -A', dir);
  git(`-c commit.gpgsign=false commit -qm ${JSON.stringify(msg)}`, dir);
  return git('rev-parse HEAD', dir).trim();
};

// --- the fixture project ----------------------------------------------------
// Drift is measured in commits, so the fixture needs real history: an entry is
// anchored at a sha, and the question is what happened to its REF files SINCE.
// The test therefore controls both halves — where each entry is anchored, and what
// moved afterwards — which is what makes the expected verdict knowable.
const P = path.join(tmp, 'project');
fs.mkdirSync(path.join(P, '.anvi'), { recursive: true });
fs.mkdirSync(path.join(P, 'src'), { recursive: true });

fs.mkdirSync(path.join(P, 'docs'), { recursive: true });
fs.writeFileSync(path.join(P, 'src', 'drifted.js'), 'export const a = 1\n');
fs.writeFileSync(path.join(P, 'src', 'steady.js'), 'export const b = 1\n');
fs.writeFileSync(path.join(P, 'docs', 'boundary.md'), '# Boundary\n');
git('init -q', P);
git('config user.email t@example.com', P);
git('config user.name t', P);
const ANCHOR = commit(P, 'init');

// The drift: some REF files move after the anchor, one never does. Every entry is
// anchored at the same commit, so the verdict difference can only come from the
// file's own history — not from the anchor.
fs.writeFileSync(path.join(P, 'src', 'drifted.js'), 'export const a = 2\n');
fs.writeFileSync(path.join(P, 'docs', 'boundary.md'), '# Boundary\nrewritten\n');
commit(P, 'move drifted.js and the boundary doc past the anchor');

// Catalogues are written AFTER the anchor sha is known, so entries can cite it.
// Each of the three catalogues the injector surfaces gets an entry, because the
// bug being guarded is partial coverage: annotating two of three teaches that
// silence means fresh.
// Mirrors the real shape: a boundary carries FILES: (the code it maps, and what the
// injector matches on) AND REF: (the doc that grounds it). They are not the same
// field and not the same claim. Currency reads REF: only — so this fixture's REF is
// what its verdict is computed from, and drifted.js moving is incidental to it.
// That is today's shipped behaviour, asserted here as it is rather than as it ought
// to be; #52 tracks the gap, since a boundary whose mapped code rotted can still
// read fresh while its doc sits still.
fs.writeFileSync(path.join(P, '.anvi', 'dharana.md'), [
  '# Dharana',
  '### B1: Source ↔ build',
  'FILES: src/drifted.js',
  '**REF:** docs/boundary.md',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  'Silent failure modes: a stale boundary map fires the wrong checks',
  'Patterns: H1',
  '',
].join('\n'));

// STALE is anchored at the first commit; its REF moved afterwards → drifted.
// FRESH is anchored at the same commit but its REF never moved → no nudge.
fs.writeFileSync(path.join(P, '.anvi', 'hetvabhasa.md'), [
  '# Hetvabhasa',
  `## H1: STALE-MARKER — a trap whose pointer rotted`,
  '**REF:** src/drifted.js',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  '',
  `## H2: FRESH-MARKER — a trap still anchored at its code`,
  '**REF:** src/steady.js',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  '',
].join('\n'));

// vyapti is matched by TEXT, not by an ID scrape — which is exactly how it was
// missed when the wiring was first written. The body must therefore mention the
// edited file's name for the injector to surface it at all.
fs.writeFileSync(path.join(P, '.anvi', 'vyapti.md'), [
  '# Vyapti',
  '## V1: VYAPTI-MARKER — every drifted.js write goes through the resolver',
  '**REF:** src/drifted.js',
  `**VALIDATED:** ${ANCHOR} 2026-01-01`,
  '',
].join('\n'));
commit(P, 'add catalogues');

function inject(cwd, filePath) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { file_path: filePath }, session_id: 'cur-test' }),
    encoding: 'utf8',
  });
  let ctx = '';
  try { ctx = JSON.parse(r.stdout || '{}').hookSpecificOutput.additionalContext || ''; } catch { ctx = ''; }
  return { exit: r.status, ctx, currency: (ctx.split('Currency (is this entry STILL real')[1] || '') };
}

console.log('injector × currency (hermetic fixture, hook spawned as the harness spawns it)');

const r = inject(P, path.join(P, 'src', 'drifted.js'));

ok(r.exit === 0, 'hook exits 0');
ok(/DHYANA/.test(r.ctx), 'the checks still inject (the thing currency must never cost)');
ok(/Currency \(is this entry STILL real/.test(r.ctx),
  'the currency section reaches the output — the wiring is live, not silently caught');

// Every catalogue the injection reasons from must be annotated.
ok(/B1:/.test(r.currency), 'the dharana boundary carries a verdict');
ok(/H1:/.test(r.currency), 'a surfaced trap carries a verdict');
ok(/V1:/.test(r.currency), 'a surfaced invariant carries a verdict too — the coverage gap that hid once already');

// The verdicts are pinned, not whatever the live corpus happens to say.
ok(/🟡/.test(r.currency), 'the drifted entry reads yellow');
ok(/drifted\.js/.test(r.currency), 'the nudge names the file that actually moved');
ok(!/steady\.js/.test(r.currency), 'the entry anchored at unmoved code produces no nudge — silence is earned here, not faked');

// Class-aware presentation: same computation, different stakes.
ok(/RE-MAP/.test(r.currency.split('H1:')[0]), 'dharana drift is loud — it rots silently, so it must not read like pointer-rot');
ok(/Re-point/.test(r.currency.split('H1:')[1] || ''), 'trap drift is quiet — the pattern usually outlives the pointer');

// The hook flags; the agent updates.
ok(!/\b(auto-?updated|I (?:updated|stamped)|has been stamped)\b/i.test(r.currency),
  'no nudge claims to have re-validated anything');

// --- degradation ------------------------------------------------------------
// Outside a git repo the ladder cannot run. Currency must fall to silence rather
// than to an error — and the checks must still inject.
const NOGIT = path.join(tmp, 'nogit');
fs.cpSync(P, NOGIT, { recursive: true });
fs.rmSync(path.join(NOGIT, '.git'), { recursive: true, force: true });
const bare = inject(NOGIT, path.join(NOGIT, 'src', 'drifted.js'));
ok(bare.exit === 0 && /DHYANA/.test(bare.ctx), 'outside a git repo the checks still inject');
ok(!/Currency/.test(bare.ctx), 'and currency degrades to silence rather than erroring');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
