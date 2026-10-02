#!/usr/bin/env node
// Every git read in the freshness check treats "git never answered" as "could not look",
// never as an answer (#571).
//
// Each read has a fallback for "git said no": an unreachable sha falls to the next rung,
// a file never tracked is "external", an uncounted file drops out of the drift sum, an
// undated document is skipped. Right when git RAN and said so (a numeric exit status).
// Wrong when git never answered (killed by the hook's timeout, ENOBUFS), and wrong in
// both directions: a VALIDATED sha read as unreachable falls to an older anchor and
// reports drift that isn't there; an uncounted file lets the rest read GREEN.
//
// So each site is exercised twice, with the SAME stub except for one call: once where
// that call is killed (no status → the verdict must say NOT checked) and once where git
// says no (status 128, as real git does for a missing object → today's answer).
'use strict';
require('./meter-sandbox');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

const { computeCurrency, nudgeFor } = require(path.join(__dirname, '..', 'hooks', 'currency.js'));

const killed = () => Object.assign(new Error('spawnSync /bin/sh ETIMEDOUT'), { code: 'ETIMEDOUT', status: null, signal: 'SIGTERM' });
const saidNo = () => Object.assign(new Error('fatal: bad object'), { status: 128 });
const SHA = 'abc1234';
const AT = '2026-09-01T10:00:00+00:00';

// A project where `a.js` is tracked and unchanged, `b.js` too, and SHA is a live commit.
// `on(args)` may throw for the one call under test; everything else answers normally.
const gitWith = (on) => (args) => {
  const r = on && on(args);
  if (r !== undefined) return r;
  if (/^cat-file -e /.test(args)) return '';
  if (/^log -1 --format=%cI /.test(args)) return AT + '\n';
  if (/^log \S+\.\.HEAD /.test(args)) return '';
  if (/^log --oneline -1 --all -- /.test(args)) return '';
  if (/^ls-files/.test(args)) return 'a.js\nb.js\n';
  return '';
};
const fileExists = (rel) => rel === 'a.js' || rel === 'b.js';
const fileExt = /\.(js|md)$/;
const notChecked = (v) => v.status === 'GRAY' && v.couldNotLook === true && /could not be READ/.test(v.reason);
const throwing = (re, make) => (args) => { if (re.test(args)) throw make(); };

function pair(name, entry, re, extra = {}, expectTwin) {
  console.log(name);
  const k = computeCurrency(entry, { git: gitWith(throwing(re, killed)), fileExists, fileExt, ...extra });
  ok(notChecked(k), `killed → NOT checked (got ${k.status}${k.couldNotLook ? ', could not look' : ''}: ${String(k.reason).slice(0, 60)})`);
  const n = nudgeFor(k, { catalogue: 'hetvabhasa.md', id: 'X1' }) || '';
  ok(/NOT checked/.test(n) && !/Stamp/.test(n), 'and its nudge says NOT checked and asks for no stamp');
  const t = computeCurrency(entry, { git: gitWith(throwing(re, saidNo)), fileExists, fileExt, ...extra });
  ok(!t.couldNotLook, `git said no → graded as before (got ${t.status})`);
  if (expectTwin) expectTwin(t);
}

pair('a VALIDATED sha whose reachability check was killed',
  { validatedField: `${SHA} 2026-09-01`, refField: 'a.js' }, /^cat-file -e /, {},
  (t) => ok(t.anchor.source !== 'VALIDATED', 'twin: an unreachable sha still falls down the ladder'));

pair('the PR-number rung, killed',
  { fixField: '#40', refField: 'a.js' }, /--grep=/, {},
  (t) => ok(t.anchor.source !== 'FIX-#40', 'twin: a PR git has no commit for still falls through'));

pair('one file counted, the other killed — must not read GREEN on the one that answered',
  { validatedField: `${SHA} 2026-09-01`, refField: 'a.js; b.js' }, /^log \S+\.\.HEAD .*b\.js/, {},
  (t) => ok(t.status === 'GREEN' && /NOT compared/.test(t.reason), 'twin: git said no → GREEN, saying one file was not compared'));

pair('a file not on disk whose history check was killed',
  { validatedField: `${SHA} 2026-09-01`, refField: 'gone.js' }, /^log --oneline -1 --all -- /, {},
  (t) => ok(t.status !== 'RED', `twin: never tracked → external, not dangling (got ${t.status})`));

const refResolver = (spec) => (/GROUND_TRUTH_X\.md$/.test(spec) ? { path: 'GROUND_TRUTH_X.md', area: 'ref' } : null);
pair('the anchor date for a Ground Truth doc, killed',
  { validatedField: `${SHA} 2026-09-01`, refField: 'ref/GROUND_TRUTH_X.md' }, /^log -1 --format=%cI /,
  { refResolver, refHistory: () => 0 });

// With no fileExt passed, grading asks `ls-files` which extensions are files. A killed
// ls-files now throws (#574) rather than falling back to a guessed set — and a throw that
// follows an unanswered read must still come back as NOT checked, not escape to a caller
// whose catch-all would cache it as fresh.
pair('the ls-files that decides which REF tokens are files, killed',
  { validatedField: `${SHA} 2026-09-01`, refField: 'a.js' }, /^ls-files/, { fileExt: undefined },
  (t) => ok(t.status === 'GREEN', `twin: not a repo → default extensions, a.js still graded (got ${t.status})`));

console.log('a throw with nothing unanswered is a real error, and stays one');
{
  let threw = null;
  try {
    computeCurrency({ validatedField: `${SHA} 2026-09-01`, refField: 'a.js' },
      { git: gitWith(), fileExt, fileExists: () => { throw new Error('boom'); } });
  } catch (e) { threw = e; }
  ok(threw && threw.message === 'boom', 'not dressed up as NOT checked');
}

console.log('the Ground Truth doc history reader, killed');
{
  const base = { git: gitWith(), fileExists, fileExt, refResolver };
  const entry = { validatedField: `${SHA} 2026-09-01`, refField: 'ref/GROUND_TRUTH_X.md' };
  const k = computeCurrency(entry, { ...base, refHistory: () => { throw killed(); } });
  ok(notChecked(k), `killed → NOT checked (got ${k.status})`);
  const t = computeCurrency(entry, { ...base, refHistory: () => 0 });
  ok(!t.couldNotLook && t.status === 'GREEN', `answered 0 → fresh (got ${t.status})`);
}

console.log('the record of what went unanswered belongs to ONE verdict');
{
  const entry = { validatedField: `${SHA} 2026-09-01`, refField: 'a.js' };
  const first = computeCurrency(entry, { git: gitWith(throwing(/^cat-file/, killed)), fileExists, fileExt });
  const second = computeCurrency(entry, { git: gitWith(), fileExists, fileExt });
  ok(first.couldNotLook && !second.couldNotLook && second.status === 'GREEN',
    `a clean entry after a killed one is graded on its own (got ${second.status})`);
  ok(/git cat-file/.test(first.reason), `and the reason names what went unanswered: ${first.reason.slice(0, 40)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
