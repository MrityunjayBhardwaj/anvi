#!/usr/bin/env node
// Test: every `/anvi:<command>` named in shipped text must be a command that exists
// (issue #241).
//
// The gap this closes: `install.sh`'s coexistence banner told users to run a command
// whose skill had stopped working, and a replacement banner written while fixing that
// named a migration command that exists only as a shell script under `scripts/`, never
// as a skill. Both were caught by a person looking, not by anything in the suite.
//
// ⚠ That second example is deliberately described rather than quoted, and this file is
// the reason the rule is worth stating: the first draft of this comment spelled the
// phantom command out in the real syntax, and THIS CHECK FAILED ON ITS OWN TEST FILE the
// first time it ran inside the suite — the file had just become tracked, so it entered
// its own corpus. Writing about a defect means producing an example of one, in the real
// syntax, in a surface nobody thinks of as under test. The fix is to describe the shape
// instead of minting a fake command; exempting this file would have been the easier
// route and would have put a hole in the only check that asks this question.
//
// A command named in shipped text is not a sentence a reader might skim past: it is an
// instruction they act on immediately, by typing it. And the failure is silent in the
// direction that hides it — a retired or misspelled command produces no error at
// install time, no test failure, and no signal at all until a user types it and gets
// nothing back.
//
// Both sides are DERIVED, neither is listed here:
//   referenced — every `/anvi:<name>` in the tracked text corpus
//   existing   — the `skills/anvi-*/` directories, which is what the installer deploys
// A hand-written list of either side would go stale the day a command is added, and it
// would do it quietly — which is the same shape as the defect.
//
// The corpus comes from `git ls-files` and is read in-process, not grepped. Both
// choices are deliberate: a hand-picked file list has missed whole classes in this repo
// before (every shell script, once), and `grep` silently contributes nothing for a file
// it decides is binary — absence indistinguishable from a clean file.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

// ── Exclusions, stated rather than silently applied ─────────────────────────────
// Two files describe the PAST, where naming a since-retired command is correct rather
// than broken. A changelog entry that says a command was retired must be free to name
// it; so must a superseded design spec. Every other tracked file is in scope.
//
// This list is the one place the check can be weakened into meaninglessness, so its
// effect is measured below: the excluded count is asserted to be small, and the corpus
// is asserted to still contain the files that matter most.
const HISTORICAL = new Set([
  'CHANGELOG.md',   // describes releases, including the retirement of commands
  'BUILD_v1.md',    // the v1.0.0 design spec — a superseded planning artifact
]);

// ── Both sides, derived ────────────────────────────────────────────────────────
let tracked;
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch { tracked = null; }
ok(tracked !== null, 'the tracked file set could be read from the index');

const REF_RE = /\/anvi:([a-z][a-z0-9-]*)/g;
const referenced = new Map(); // name → [files]
let scanned = 0, excluded = 0;
for (const rel of (tracked || [])) {
  if (HISTORICAL.has(rel)) { excluded++; continue; }
  const abs = path.join(ROOT, rel);
  let text;
  try {
    if (!fs.statSync(abs).isFile()) continue;
    text = fs.readFileSync(abs, 'utf8');
  } catch { continue; }
  scanned++;
  for (const m of text.matchAll(REF_RE)) {
    if (!referenced.has(m[1])) referenced.set(m[1], []);
    const files = referenced.get(m[1]);
    if (!files.includes(rel)) files.push(rel);
  }
}

const existing = new Set(
  fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('anvi-'))
    .map(e => e.name.slice('anvi-'.length))
);

// ── The domain must be real before anything is asserted about it ───────────────
// A count that could quietly become zero is the failure this file exists to prevent,
// so it is checked rather than assumed. Without these, "no phantom commands" would be
// exactly what an empty scan reports.
ok(scanned > 20, `scanned a plausible number of tracked files (${scanned})`);
ok(existing.size > 20, `found a plausible number of installed commands (${existing.size})`);
ok(referenced.size > 20, `found a plausible number of referenced commands (${referenced.size})`);
ok(excluded === HISTORICAL.size,
   `exactly the ${HISTORICAL.size} stated historical files were excluded (${excluded})`);
// The exclusions must not have removed the surfaces that matter. README is copied to the
// user's machine by the installer and install.sh prints commands to the terminal, so a
// phantom command in either reaches a user directly.
const inCorpus = f => (tracked || []).includes(f) && !HISTORICAL.has(f);
ok(inCorpus('README.md'), 'README.md is in the corpus (the installer copies it to the user)');
ok(inCorpus('install.sh'), 'install.sh is in the corpus (it prints commands to the terminal)');
ok(inCorpus('SYSTEM_ARCHITECTURE.md'), 'SYSTEM_ARCHITECTURE.md is in the corpus');

// ── The scanner must be provably able to find and to miss ─────────────────────
// A check whose regex matches nothing is indistinguishable from a clean tree, so the
// scanner is proved on a constructed positive and a constructed negative.
const probe = t => [...t.matchAll(REF_RE)].map(m => m[1]);
ok(probe('run `/anvi:debug` then /anvi:verify-work.').join(',') === 'debug,verify-work',
   'the scanner finds commands in ordinary prose');
ok(probe('nothing here, just a path like skills/anvi-debug/SKILL.md').length === 0,
   'and does not invent them from directory names');
// The check must be able to FAIL: a name that does not exist must be reported as such.
ok(!existing.has('definitely-not-a-real-command'),
   'a fabricated command name is correctly absent from the installed set');

// ── The assertion ─────────────────────────────────────────────────────────────
const phantom = [...referenced.keys()].filter(n => !existing.has(n)).sort();
if (phantom.length) {
  console.log('');
  console.log(`  shipped text names ${phantom.length} command(s) that do not exist:`);
  for (const n of phantom) {
    console.log(`    /anvi:${n}`);
    for (const f of referenced.get(n)) console.log(`        ${f}`);
  }
  console.log('');
}
ok(phantom.length === 0,
   `every referenced command exists${phantom.length ? ` — phantom: ${phantom.map(n => '/anvi:' + n).join(', ')}` : ''}`);

// ── The reverse direction: every installed command is listed in /anvi:help (#612) ──
// Being named SOMEWHERE is too weak to enforce — a command mentioned once in a workflow
// is named, and still undiscoverable. The surface that claims to be complete is the
// help listing, so that is where the reverse direction is enforced. (It replaced an
// informational "named in no shipped text" line, which this check makes always empty:
// help.md is in the corpus above.)
//
// The installed side mirrors install.sh's own selection — `for skill_dir in
// "$SCRIPT_DIR/skills/"anvi*/`, filtered by `skill_installable` (a SKILL.md must be
// there) — rather than the `anvi-*` set above. That takes in `skills/anvi/`, which
// installs as the bare `/anvi`, so the session-activation command is held to the same
// rule instead of being carved out.
console.log('\nreverse — every installed command is listed in /anvi:help');
{
  const commandOf = dir => dir === 'anvi' ? '/anvi' : '/anvi:' + dir.slice('anvi-'.length);
  const installed = new Set(
    fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('anvi'))
      .filter(e => fs.existsSync(path.join(ROOT, 'skills', e.name, 'SKILL.md')))
      .map(e => commandOf(e.name))
  );

  // A listing row is a command at the start of an indented line, inside the display
  // block. Prose that mentions a command, and a description wrapped onto the next line,
  // are not rows: counting them would let a command pass by being talked about.
  const ROW_RE = /^ {2}(\/anvi(?::[a-z][a-z0-9-]*)?)(?=\s)/;
  const rowsOf = text => {
    const lines = text.split('\n');
    const step = lines.findIndex(l => l.includes('<step name="display">'));
    const open = lines.findIndex((l, i) => i > step && l.startsWith('```'));
    const close = lines.findIndex((l, i) => i > open && l.startsWith('```'));
    if (step === -1 || open === -1 || close === -1) return null;
    return lines.slice(open + 1, close).map(l => (l.match(ROW_RE) || [])[1]).filter(Boolean);
  };

  // The parser is proved on constructed text before it is trusted on the real file.
  // Only REAL command names appear in it: this file is in its own corpus, and a made-up
  // name in the real syntax would be reported as a phantom by the check above.
  const sample = '<step name="display">\n```\n  /anvi:debug   Debug\n' +
                 '                        /anvi:fast in a wrapped description\n  /anvi    Activate\n```\n' +
                 '  /anvi:quick   after the block\n';
  ok(JSON.stringify(rowsOf(sample)) === '["/anvi:debug","/anvi"]',
     'the row parser reads listing rows (bare /anvi included) and skips continuations and text outside the block');

  const rows = rowsOf(fs.readFileSync(path.join(ROOT, 'workflows', 'help.md'), 'utf8'));
  ok(rows !== null, 'workflows/help.md has the display block the listing lives in');
  const listed = new Set(rows || []);
  // Both sides asserted non-trivial: a parser that stopped matching would otherwise
  // report every command missing, and an empty skills read would report none.
  ok(installed.size > 20 && installed.has('/anvi'),
     `found ${installed.size} installed commands, the bare /anvi among them`);
  ok(listed.size > 20, `found ${listed.size} commands listed in /anvi:help`);

  const unlisted = [...installed].filter(c => !listed.has(c)).sort();
  ok(unlisted.length === 0,
     `every installed command is listed in /anvi:help` +
     (unlisted.length ? ` — unlisted: ${unlisted.join(', ')} (add a row to workflows/help.md)` : ''));
  // The forward check above cannot see the bare `/anvi` (its pattern needs the colon),
  // so a stale row is checked here too, for the whole listing.
  const stale = [...listed].filter(c => !installed.has(c)).sort();
  ok(stale.length === 0,
     `and every row in /anvi:help is an installed command` +
     (stale.length ? ` — not installed: ${stale.join(', ')}` : ''));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
