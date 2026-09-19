#!/usr/bin/env node
// Test: the always-loaded rules keep the shape that earned them a place (issue #506).
//
// `cognitive-os/rules.md` holds judgements distilled from the catalogues, each a
// `WHEN <moment> → <move>` line. The shape is the point: a rule names a moment the
// reader will recognise, so it can fire without anything selecting it. A line that
// drifts into prose, grows past 160 characters, or carries a private catalogue key
// is no longer that — and every such line costs every session. The cap of 200 is the
// ceiling the programme set; the size limit test holds the file's growth separately.
//
// Also held: base-layer.md imports the file by the path installs resolve, because
// that import is the only thing that loads it. A renamed file with a stale import
// loads nothing and fails nowhere else.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const RULE = /^- WHEN \S.* → \S.*$/;
const CATALOGUE_KEY = /\b[HVK]\d{1,3}\b/;
function problems(line) {
  const text = line.slice(2);
  const out = [];
  if (!RULE.test(line)) out.push('not `- WHEN … → …`');
  if ([...text].length > 160) out.push(`${[...text].length} characters`);
  if (CATALOGUE_KEY.test(text)) out.push(`carries a catalogue key (${text.match(CATALOGUE_KEY)[0]})`);
  return out;
}

console.log('\n— the rules file —');
const file = path.join(ROOT, 'cognitive-os', 'rules.md');
const bullets = fs.readFileSync(file, 'utf8').split('\n').filter(l => /^\s*[-*]\s/.test(l));
ok(bullets.length > 0, `the file holds rules (${bullets.length})`);
ok(bullets.length <= 200, `at most 200 rules (${bullets.length})`);
const bad = bullets.map(l => [l, problems(l)]).filter(([, p]) => p.length);
ok(bad.length === 0, 'every bullet is a WHEN … → … rule of at most 160 characters with no catalogue key');
for (const [l, p] of bad) console.log(`      ${p.join('; ')}: ${l.slice(0, 70)}…`);
const seen = new Set(), dup = bullets.filter(l => seen.has(l) || !seen.add(l));
ok(dup.length === 0, 'no rule appears twice');

console.log('\n— the check can go red —');
ok(problems('- WHEN x → y').length === 0, 'a well-formed rule passes');
ok(problems('- Always check your work carefully').length > 0, 'prose without WHEN … → … is caught');
ok(problems(`- WHEN x → ${'y'.repeat(160)}`).length > 0, 'a rule over 160 characters is caught');
ok(problems('- WHEN a probe returns zero (see H999) → recheck').length > 0, 'a catalogue key is caught');

console.log('\n— it is loaded —');
const base = fs.readFileSync(path.join(ROOT, 'cognitive-os', 'base-layer.md'), 'utf8');
ok(base.includes('@~/.claude/anvi/cognitive-os/rules.md'),
   'base-layer.md imports the rules by the path installs resolve');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
