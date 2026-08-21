#!/usr/bin/env node
// Test: every file a shipped command points at must be there when the user runs it,
// and every workflow must be reachable from a command (issue #321).
//
// A skill's body is a pointer — `Execute the workflow from ~/.claude/anvi/workflows/
// <name>.md`. Nothing checked that the file on the other end existed. A skill naming a
// renamed or deleted workflow installs cleanly, appears in the command list, is offered
// to the user, and fails only when someone runs it — at which point the agent has a
// command with no instructions and improvises. That is the shape this repo keeps
// meeting: a well-formed artifact naming something absent, invisible precisely because
// the pointer still looks healthy.
//
// The gap was an ASYMMETRY, not an oversight. `slash-command-parity.test.js` already
// closes the mirror image one layer up — every `/anvi:<command>` named in shipped text
// must exist as a skill — and was written because a banner told users to run a command
// whose skill had stopped working. The same failure one layer down was uncovered.
//
// ── Two decisions worth stating ────────────────────────────────────────────────
//
// 1. Pointers are resolved against a REAL INSTALL, not against the repo. They are
//    written as `~/.claude/anvi/...`, and that directory is populated by install.sh
//    from a whitelist of directories — not by copying the repo. So a file can exist in
//    the repo and still be absent for every user, and repo-resolution would call that
//    green. Both currently agree; the install is the one that will still be right after
//    someone moves a file into a directory the installer does not copy. When a pointer
//    does fail, the report says WHICH of the two it failed, because "renamed" and
//    "moved out of the installed set" are different repairs.
//
// 2. Reachability, not "named by a skill". The reverse direction asks whether a
//    workflow can be reached from something that RUNS — a skill, or a workflow a skill
//    reaches. A workflow invoked only by another workflow is wired, not orphaned, and a
//    check that ignored that would report false orphans and get ignored in turn.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

// A pointer is only ever written fully qualified, so that is what is matched. The
// trailing-punctuation trim is because these appear mid-sentence and inside backticks.
const POINTER = /~\/\.claude\/anvi\/([A-Za-z0-9._/-]+)/g;
const trimEnd = p => p.replace(/[.,`)]+$/, '');

// The surfaces that are EXECUTED. Deliberately not the whole tree: README and CHANGELOG
// describe the past, where naming a since-retired file is correct rather than broken —
// the same reason slash-command-parity excludes them.
const CORPUS_DIRS = ['skills', 'workflows', 'cognitive-os', 'agents'];

// ── Unreachable workflows: stated, never silent ────────────────────────────────
// One entry, with its reason and the issue deciding its fate (#325). This is the single
// place the reverse check can be weakened into meaninglessness, so its size is asserted
// below rather than left to grow.
const ALLOWED_UNREACHABLE = new Map([
  ['workflows/execute-plan.md',
   'no skill names it and no workflow executes it — quick.md only cross-references it in prose. Wire it or retire it: #325'],
]);

// ── Corpus, derived ────────────────────────────────────────────────────────────
let tracked;
try {
  tracked = execFileSync('git', ['ls-files', ...CORPUS_DIRS], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch { tracked = null; }
ok(tracked !== null, 'the executed-surface file list could be read from the git index');
tracked = tracked || [];

const pointers = new Map();  // target path → [files naming it]
for (const rel of tracked) {
  let text;
  try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
  for (const m of text.matchAll(POINTER)) {
    const target = trimEnd(m[1]);
    if (!pointers.has(target)) pointers.set(target, []);
    if (!pointers.get(target).includes(rel)) pointers.get(target).push(rel);
  }
}

// The domain is asserted before anything is asserted ABOUT it. A green over a corpus
// that quietly became empty is the most reassuring output this suite can produce, and
// it is the defect the runner's own discovery count exists to prevent. Floors rather
// than equalities: a fixed number would go stale the day a skill is added, quietly.
// `anvi*` is install.sh's own glob (install.sh:646). Matching it here means the two
// sides agree by construction: a directory the installer would deploy is a directory
// this check reads. Deriving it differently would leave a class the installer ships and
// nothing verifies — every directory happens to match today, which is exactly the kind
// of agreement that stops being true without anyone noticing.
const skillFiles = tracked.filter(f => /^skills\/anvi[^/]*\/SKILL\.md$/.test(f));
const skillDirs = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name.startsWith('anvi')).length;
ok(skillFiles.length === skillDirs,
   `every one of the ${skillDirs} skill directories the installer deploys contributed a tracked SKILL.md`);
ok(pointers.size >= skillFiles.length,
   `${pointers.size} distinct pointers found across ${tracked.length} executed files — the corpus is not empty`);

// ── A real install, because that is where the pointers resolve ─────────────────
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ptr-')) + '/home';
fs.mkdirSync(HOME, { recursive: true });
const inst = spawnSync('bash', [path.join(ROOT, 'install.sh'), '--only=all'], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME }, stdio: ['ignore', 'pipe', 'pipe'],
});
const ANVI = path.join(HOME, '.claude', 'anvi');
ok(inst.status === 0, 'install.sh succeeded into a throwaway HOME');
if (inst.status !== 0) {
  // Every pointer assertion below resolves against this tree, so a failed install would
  // otherwise report 75 broken pointers and bury its own cause under them.
  const tail = ((inst.stdout || '') + (inst.stderr || '')).trimEnd().split('\n').slice(-6);
  console.log(tail.map(l => `      │ ${l}`).join('\n'));
}
ok(fs.existsSync(ANVI), 'and produced the ~/.claude/anvi tree the pointers are written against');

const exists = p => { try { fs.statSync(p); return true; } catch { return false; } };

// ── Forward: no pointer may name something the user will not have ──────────────
console.log('\nforward — every pointer resolves where it is written to resolve');
{
  const broken = [];
  for (const [target, namedBy] of pointers) {
    if (exists(path.join(ANVI, target))) continue;
    // Naming which of the two failed is the difference between a report and a repair
    // instruction: absent from both is a rename or a deletion; present in the repo but
    // absent from the install means it was moved somewhere install.sh does not copy,
    // which no repo-only check could ever have seen.
    broken.push({
      target, namedBy,
      why: exists(path.join(ROOT, target))
        ? 'exists in the repo but install.sh never copies it there'
        : 'does not exist in the repo either — renamed or deleted',
    });
  }
  ok(broken.length === 0,
     `all ${pointers.size} pointers resolve in the installed tree`);
  for (const b of broken) console.log(`      │ ${b.target} — ${b.why}\n      │   named by: ${b.namedBy.join(', ')}`);

  // The forward check must actually be looking at workflows, which is the case #321 was
  // filed about. Without this it could pass by finding no workflow pointers at all.
  const wf = [...pointers.keys()].filter(t => t.startsWith('workflows/'));
  ok(wf.length > 0, `and ${wf.length} of them are workflow pointers — the case this was filed for`);
}

// ── The pointer must be written in the shape this check can see ────────────────
// The forward check matches only FULLY QUALIFIED `~/.claude/anvi/...` paths, so a skill
// whose instruction named a bare `<name>.md` would be invisible to it — a blind spot,
// not a pass. 47 of the skills carry the "Execute the workflow" instruction and every
// one of them qualifies its path; that convention is what makes the check total, so it
// is asserted rather than assumed. State the limitation or close it: this closes it.
console.log('\nshape — the instruction is written the way the check can follow');
{
  const unqualified = skillFiles.filter(f => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /execute the workflow/i.test(text) && !text.includes('~/.claude/anvi/workflows/');
  });
  const instructing = skillFiles.filter(f =>
    /execute the workflow/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok(instructing.length > 0, `${instructing.length} of ${skillFiles.length} skills carry the workflow instruction`);
  ok(unqualified.length === 0, 'and every one of them qualifies its path, so none is invisible to the check above');
  for (const f of unqualified) console.log(`      │ ${f} — instructs a workflow without a ~/.claude/anvi/ path`);
}

// ── Reverse: every workflow must be reachable from a command ───────────────────
console.log('\nreverse — no workflow is stranded where nothing can run it');
{
  const wfRefs = f => {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return []; }
    return [...text.matchAll(POINTER)].map(m => trimEnd(m[1])).filter(t => t.startsWith('workflows/'));
  };
  const seen = new Set();
  const frontier = skillFiles.flatMap(wfRefs);
  while (frontier.length) {
    const w = frontier.pop();
    if (seen.has(w)) continue;
    seen.add(w);
    for (const next of wfRefs(w)) if (!seen.has(next)) frontier.push(next);
  }

  const onDisk = fs.readdirSync(path.join(ROOT, 'workflows'))
    .filter(f => f.endsWith('.md')).map(f => `workflows/${f}`);
  const unreachable = onDisk.filter(w => !seen.has(w));
  const unexpected = unreachable.filter(w => !ALLOWED_UNREACHABLE.has(w));

  ok(onDisk.length > 0 && seen.size > 0, `${seen.size} of ${onDisk.length} workflows are reachable from a skill`);
  ok(unexpected.length === 0, 'every unreachable workflow is one that is already accounted for');
  for (const w of unexpected) console.log(`      │ ${w} — no skill or workflow reaches it`);
  for (const [w, why] of ALLOWED_UNREACHABLE) {
    if (unreachable.includes(w)) console.log(`      · known: ${w} — ${why}`);
  }

  // The exception list is measured, not trusted. It is small, and it does not carry
  // entries that have stopped being true — an exception for a reachable workflow would
  // sit there forever excusing a hole nobody remembers opening.
  ok(ALLOWED_UNREACHABLE.size <= 2,
     `the unreachable exception list holds ${ALLOWED_UNREACHABLE.size} entry — small enough to still mean something`);
  for (const w of ALLOWED_UNREACHABLE.keys()) {
    ok(unreachable.includes(w), `the exception for ${w} is still earning its place (it is still unreachable)`);
    ok(onDisk.includes(w), `and ${w} still exists — a stale exception is a hole with a note on it`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
