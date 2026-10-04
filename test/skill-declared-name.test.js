#!/usr/bin/env node
// Test: every installed skill declares the name its command is documented under (#614).
//
// The `name:` in a skill's frontmatter is not decoration. Observed on Claude Code 2.1.288,
// in fresh headless sessions, by reading how each typed prompt was received:
//
//   /anvi:help      declares `name: anvi:help`     → the skill loads
//   /anvi:explore   declared `name: anvi-explore`  → arrived as plain text, nothing ran
//   /anvi-explore   (the directory name)           → the skill loads
//
// So the colon form every doc teaches resolves through the DECLARED name, and the skill
// that declared something else answered only to its directory name. It shipped that way
// from the day it was added and nothing failed: both command checks derive a command's
// name from its directory, so a skill can declare any name at all and still pass them.
// This is the check that reads the declaration.
//
// The installed set mirrors install.sh's own selection — `for skill_dir in
// "$SCRIPT_DIR/skills/"anvi*/`, kept only when `skill_installable` finds a SKILL.md — so
// `skills/anvi/`, the bare `/anvi`, is held to the rule too.
'use strict';
require('./meter-sandbox');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

// `skills/anvi/` → `anvi`; `skills/anvi-debug/` → `anvi:debug`.
const expectedName = dir => dir === 'anvi' ? 'anvi' : 'anvi:' + dir.slice('anvi-'.length);

// The frontmatter is the block between the file's first two `---` lines. A `name:` further
// down the body is prose, not a declaration, and must not be read as one.
const declaredName = text => {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;
  const line = lines.slice(1, end).find(l => /^name:/.test(l));
  return line ? line.slice('name:'.length).trim().replace(/^(['"])(.*)\1$/, '$2') : null;
};

// ── The reader is proved before it is trusted ─────────────────────────────────
ok(declaredName('---\nname: anvi:debug\ndescription: x\n---\nbody') === 'anvi:debug',
   'the frontmatter reader finds a declared name');
ok(declaredName('---\nname: "anvi:debug"\n---\n') === 'anvi:debug',
   'and unquotes a quoted one');
ok(declaredName('---\ndescription: x\n---\nname: anvi:debug\n') === null,
   'and does not take a `name:` from the body for a declaration');
ok(declaredName('# no frontmatter\nname: anvi:debug\n') === null,
   'and reports no declaration when the file has no frontmatter');

// ── The installed set, derived the way the installer derives it ───────────────
const installed = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('anvi'))
  .filter(e => fs.existsSync(path.join(ROOT, 'skills', e.name, 'SKILL.md')))
  .map(e => e.name);
// A read that quietly came back empty would pass every assertion below.
ok(installed.length > 20 && installed.includes('anvi'),
   `found ${installed.length} installed skills, the bare anvi among them`);

// ── The assertion ─────────────────────────────────────────────────────────────
const wrong = [];
for (const dir of installed) {
  const got = declaredName(fs.readFileSync(path.join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8'));
  if (got !== expectedName(dir)) wrong.push(`skills/${dir}/SKILL.md declares ${got === null ? 'no name' : `"${got}"`}, documented as "${expectedName(dir)}"`);
}
ok(wrong.length === 0,
   `every installed skill declares the name its command is documented under` +
   (wrong.length ? ` — ${wrong.length} do not` : ''));
for (const w of wrong) console.log(`      │ ${w}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
