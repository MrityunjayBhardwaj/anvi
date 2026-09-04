#!/usr/bin/env node
'use strict';
// named-entry-delivery — the hook that delivers the catalogue entries a prompt names.
//
// WHAT THIS SUITE HAS TO PROVE, ordered by how much damage the defect would do.
//
//   1. IT SELECTS NOTHING. Every entry it delivers must be one the prompt named,
//      and every entry the prompt named must be delivered or explicitly accounted
//      for. A delivery hook that quietly adds or drops an entry is worse than no
//      hook: the reader believes the list in front of them is the list they asked
//      for.
//
//   2. IT IS SILENT WHEN IT SHOULD BE. This fires on EVERY user prompt. A hook
//      that speaks when no entry was named spends context on every turn, which is
//      exactly the always-on injection this project already measured and killed.
//      Every "it speaks" assertion below is paired with an "it stays quiet" one.
//
//   3. IT DOES NOT MISTAKE A PLANNING LABEL FOR AN ENTRY. Briefs are full of
//      id-shaped tokens that are not ids — P0, D1, S4, C4. Measured on real
//      briefs: of 834 id-shaped tokens matching no entry, 772 carried a prefix the
//      catalogue never uses. Reporting those as missing entries would put a false
//      warning on nearly every fire, and a warning that is usually wrong is
//      trained away.
//
//   4. WHAT IT DROPS, IT NAMES. The caps exist because a p90 brief of long entries
//      reaches ~93 KB. A cap that silently truncates re-creates the original
//      defect one level down: the reader is told entries were delivered and some
//      were not.
//
//   5. IT NEVER BLOCKS. Malformed payload, missing catalogues, unreadable file —
//      all exit 0 with no output.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'hooks', 'named-entry-delivery.js');
const H = require(HOOK);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-ned-'));
const anvi = path.join(TMP, '.anvi');
fs.mkdirSync(anvi, { recursive: true });

// A synthetic catalogue in the shapes the fleet actually authors, so the parser is
// exercised against real variety rather than one house style.
fs.writeFileSync(path.join(anvi, 'hetvabhasa.md'), [
  '# Hetvabhasa', '',
  '## H1: the first pattern', 'BODY-H1 distinctive line', '',
  '## H2 — an em-dash heading', 'BODY-H2 distinctive line', '',
  '### [H3] a bracketed id', 'BODY-H3 distinctive line', '',
  '## H4: a very long one', 'x'.repeat(20000), '',
].join('\n'));
fs.writeFileSync(path.join(anvi, 'vyapti.md'), [
  '# Vyapti', '', '## V1. "a quoted title"', 'BODY-V1 distinctive line', '',
  '### [[V2]]: a wiki-linked id', 'BODY-V2 distinctive line', '',
].join('\n'));
fs.writeFileSync(path.join(anvi, 'krama.md'), ['# Krama', '', '## K1 — a lifecycle', 'BODY-K1 distinctive line', ''].join('\n'));
fs.writeFileSync(path.join(anvi, 'dharana.md'), [
  '# Dharana', '',
  '## Boundary B1: a boundary whose id is not adjacent to the hashes', 'BODY-B1 distinctive line', '',
  '### Boundary: L1 Prompt ↔ No-Hands Images', 'BODY-NOT-AN-ENTRY', '',
  '## 4. ORGANIZATIONAL HEALTH', 'BODY-NOT-AN-ENTRY-EITHER', '',
].join('\n'));

// ── GROUP 1 — the heading parser: an id, or nothing ─────────────────────────
console.log('\nGROUP 1 — an id-shaped token in a heading is not automatically an entry id');
{
  eq(H.idInHeading('## H1: the first pattern'), 'H1', 'a colon heading');
  eq(H.idInHeading('## H2 — an em-dash heading'), 'H2', 'an em-dash heading');
  eq(H.idInHeading('### [H3] a bracketed id'), 'H3', 'a bracketed id');
  eq(H.idInHeading('### [[V2]]: a wiki-linked id'), 'V2', 'a wiki-linked id');
  eq(H.idInHeading('## V1. "a quoted title"'), 'V1', 'a full-stop heading');
  eq(H.idInHeading('## Boundary B1: not adjacent'), 'B1', 'an id behind one label word');
  // The paired negatives. Without them a parser that returned the first id-shaped
  // token anywhere in the line would pass every assertion above.
  eq(H.idInHeading('### Boundary: L1 Prompt ↔ No-Hands Images'), null,
    'PROSE containing an id-shaped token is NOT an entry heading');
  eq(H.idInHeading('## 4. ORGANIZATIONAL HEALTH'), null, 'a numbered section heading is not an entry');
  eq(H.idInHeading('## Provenance'), null, 'a plain heading is not an entry');
}

// ── GROUP 2 — the catalogue loads, and only real entries are in it ──────────
console.log('\nGROUP 2 — the catalogue index');
{
  const { entries, prefixes } = H.loadEntries(anvi);
  eq(entries.size, 8, 'eight entries across four files (H1 H2 H3 H4 V1 V2 K1 B1)');
  ok(entries.has('B1'), 'a boundary entry whose id trails a label word is indexed');
  ok(!entries.has('L1'), 'the prose heading contributed NO entry');
  eq([...prefixes].sort().join(','), 'B,H,K,V', 'the prefix vocabulary is derived from the catalogue itself');
  ok(/BODY-H1 distinctive line/.test(entries.get('H1').text), 'an entry carries its BODY, not just its heading');
  eq(entries.get('B1').file, 'dharana.md', 'an entry knows which catalogue it came from');
}

// ── GROUP 3 — it delivers exactly what was named ────────────────────────────
console.log('\nGROUP 3 — every entry delivered was named, and every entry named is accounted for');
{
  const out = H.build('read .anvi entries H1, V2 and B1 before starting', anvi);
  ok(/BODY-H1 distinctive line/.test(out), 'the named entry arrives as TEXT — the entire point');
  ok(/BODY-V2 distinctive line/.test(out), 'a second named entry arrives');
  ok(/BODY-B1 distinctive line/.test(out), 'and a boundary entry arrives');
  ok(!/BODY-K1/.test(out), 'an entry that was NOT named is not delivered');
  ok(!/BODY-NOT-AN-ENTRY/.test(out), 'prose that is not an entry is never delivered');
  eq((out.match(/^--- \S+ \(/gm) || []).length, 3, 'exactly three entries, no more');

  const dup = H.build('.anvi H1 and H1 again and H1', anvi);
  eq((dup.match(/^--- \S+ \(/gm) || []).length, 1, 'an id named three times is delivered once');
}

// ── GROUP 4 — silence, which is the expensive direction to get wrong ────────
console.log('\nGROUP 4 — it fires on every prompt, so it must be silent on almost all of them');
{
  eq(H.build('please fix the failing catalogue test', anvi), null,
    'a prompt about catalogues that names NO id is silent');
  eq(H.build('bump to V2 and H1 in the changelog', anvi), null,
    'ids with no catalogue word are silent — a version string is not a request');
  eq(H.build('', anvi), null, 'an empty prompt is silent');
  eq(H.build('go', anvi), null, 'a continuation is silent');
  // ⚠ THERE ARE TWO SILENCE PATHS AND THEY ARE NOT THE SAME GUARD. A prompt with
  // no id-shaped token at all leaves early; a prompt whose tokens all FAIL to
  // resolve travels the whole lookup and must still say nothing. A falsification
  // matrix that mutates the second guard is caught only by this case — the ones
  // above exit before reaching it.
  eq(H.build('read .anvi entries P0, S4, D1 and C4', anvi), null,
    'PLANNING LABELS alone are silent — prefixes this catalogue never uses are not ids');
  eq(H.build('read .anvi entries H9999 and V4242 in full', anvi) === null, false,
    'but ids that COULD be entries and are not still speak, to report the miss');
}

// ── GROUP 5 — a named id that does not exist ────────────────────────────────
console.log('\nGROUP 5 — a miss is reported, but only when it could really be an entry');
{
  const out = H.build('read .anvi H1 and H9999 and V4242 and S4 and P0', anvi);
  ok(/NAMED BUT NOT FOUND/.test(out), 'an id in the catalogue\'s own vocabulary that is absent is REPORTED');
  ok(/H9999/.test(out) && /V4242/.test(out), 'and both misses are named');
  ok(!/S4/.test(out) && !/P0/.test(out),
    'planning labels are NOT reported as missing entries — 772 of 834 real absent tokens are these');
  ok(/BODY-H1 distinctive line/.test(out), 'and the id that DID resolve is still delivered alongside');
}

// ── GROUP 6 — the caps name what they drop ─────────────────────────────────
console.log('\nGROUP 6 — a silent truncation would re-create the defect one level down');
{
  const big = H.build('read .anvi H4', anvi);
  ok(/truncated at \d+ chars of 20\d\d\d/.test(big), 'an over-long entry says it was truncated, and by how much');
  ok(big.length < 20000, 'and the payload is actually smaller than the entry');

  // Fill past the total budget with distinct entries.
  const many = path.join(TMP, 'many');
  fs.mkdirSync(many, { recursive: true });
  const parts = ['# H'];
  for (let i = 1; i <= 40; i++) parts.push(`## H${i}: entry ${i}`, 'y'.repeat(4000), '');
  fs.writeFileSync(path.join(many, 'hetvabhasa.md'), parts.join('\n'));
  const ids = Array.from({ length: 40 }, (_, i) => `H${i + 1}`).join(' ');
  const capped = H.build(`.anvi ${ids}`, many);
  ok(/NOT delivered, budget reached/.test(capped), 'past the budget it stops and SAYS it stopped');
  ok(capped.length <= H.TOTAL_CHARS + 4000, 'the total payload respects the budget');
  const namedDropped = (capped.match(/budget reached: ([^.]+)\./) || [])[1] || '';
  ok(namedDropped.split(',').length > 1, 'and every dropped entry is named, not summarised as a count');
  const deliveredCount = (capped.match(/^--- \S+ \(/gm) || []).length;
  ok(deliveredCount + namedDropped.split(',').length === 40,
    'delivered + dropped accounts for all 40 named entries — nothing vanishes');
}

// ── GROUP 7 — the real channel, and it never blocks ────────────────────────
console.log('\nGROUP 7 — driven through stdin exactly as the harness drives it');
{
  const run = (payload) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
  });

  // cwd is the TEMP project built above, never this checkout: a fresh worktree has
  // no `.anvi` (it is gitignored), so pointing at ROOT would make the hook
  // correctly silent and the assertion would be indicting the fixture.
  const live = run({
    hook_event_name: 'UserPromptSubmit', session_id: 'test',
    cwd: TMP, prompt: 'read .anvi entries H1 and V1 first',
  });
  eq(live.status, 0, 'the hook exits 0 on a delivering prompt');
  // Assert on the ENVELOPE — that is what the harness consumes — and on the body
  // reaching it, so a hook that emits a well-formed empty envelope cannot pass.
  let parsed = null;
  try { parsed = JSON.parse(live.stdout); } catch (_) { /* asserted below */ }
  ok(parsed && parsed.hookSpecificOutput, 'it emits a hookSpecificOutput envelope');
  eq(parsed && parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'tagged with the right event');
  ok(parsed && /BODY-H1 distinctive line/.test(parsed.hookSpecificOutput.additionalContext),
    'and the entry TEXT survives the whole stdin->stdout channel, not just the envelope');

  const quiet = run({ hook_event_name: 'UserPromptSubmit', cwd: TMP, prompt: 'just go ahead' });
  eq(quiet.status, 0, 'a prompt naming nothing exits 0');
  eq(quiet.stdout.trim(), '', 'and writes NOTHING to stdout');

  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8' });
  eq(bad.status, 0, 'malformed stdin never blocks the turn');
  eq(bad.stdout.trim(), '', 'and says nothing');

  const nowhere = run({ hook_event_name: 'UserPromptSubmit', cwd: '/nonexistent-xyz', prompt: '.anvi H1' });
  eq(nowhere.status, 0, 'an unresolvable project never blocks the turn');
}

// ── GROUP 8 — the source stays greppable ───────────────────────────────────
console.log('\nGROUP 8 — no NUL byte in the shipped source');
{
  const buf = fs.readFileSync(HOOK);
  eq(buf.indexOf(0), -1, 'the hook holds no NUL byte, so a grep sweep can see it');
}

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
