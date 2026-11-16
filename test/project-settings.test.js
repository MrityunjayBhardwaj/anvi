#!/usr/bin/env node
// Test: one settings file per project holds the numbers measurements are judged by (#740).
//
// WHAT IS BEING PINNED. Each kind of bad file is refused with its own reason, and the whole file
// is then unused (a half-read file would judge by numbers nobody chose). A key with no default
// stays unruled until ruled, and a tool that needs it gets NOT MEASURED, never a number. The
// settings id moves when a value moves and not when only a date or a reason does. A missing file
// is not an error. "1/3" is read as an exact fraction. The command prints every key with where it
// came from, and the project path resolves under the store.

'use strict';
require('./meter-sandbox');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const ROOT = path.join(__dirname, '..');
const MOD = path.join(ROOT, 'scripts', 'project-settings.js');
const S = require(MOD);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-settings-'));
let n = 0;
const put = (body) => { const f = path.join(DIR, `s${n++}.json`); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); return f; };
const entry = (value, extra = {}) => ({ value, ruled: '2026-11-05', why: 'a reason', ...extra });
const refusedWith = (body, re) => { const s = S.load({ file: put(body) }); return !!s.refused && s.refused.some(r => re.test(r)) && !s.entries; };

console.log('a missing file is defaults, not an error');
const none = S.load({ file: path.join(DIR, 'absent.json') });
ok(!none.refused && none.exists === false, 'absent file: loaded, marked absent');
ok(none.entries['signatures.weight.viaDoor'].source === 'default' && none.values['signatures.weight.viaDoor'] === 0.5, 'a key with a default takes it, marked default');
ok(none.entries['refusal.forceableShareFloor'].source === 'unruled' && none.values['refusal.forceableShareFloor'] === null, 'a key with no default is unruled, value null');

const dflt = S.load({ defaultsOnly: true });
ok(!dflt.refused && dflt.file === null && dflt.id === none.id && /no project named: defaults only/.test(S.headline(dflt)), 'defaults only (no project named): the defaults, the same id as an absent file, and the header says so');
ok(S.load({}).refused, 'without defaultsOnly, naming nothing is refused');

console.log('a ruled file');
const good = S.load({ file: put({ about: 'x', settings: {
  'refusal.forceableShareFloor': entry('1/3'),
  'placement.leaveOneOut.minRate': entry(0.8),
  'placement.leaveOneOut.minJobs': entry(5),
} }) });
ok(!good.refused, 'loads');
ok(good.values['refusal.forceableShareFloor'] === 1 / 3, '"1/3" reads as the exact fraction');
ok(good.entries['refusal.forceableShareFloor'].source === 'ruled' && good.entries['refusal.forceableShareFloor'].ruled === '2026-11-05', 'a ruled key carries its date');
ok(/^[0-9a-f]{12}$/.test(good.id), 'the settings id is 12 hex');

console.log('need(): a value, or the reason it may not judge');
const got = S.need(good, 'refusal.forceableShareFloor');
ok(got.value === 1 / 3 && !got.notMeasured, 'a ruled key gives its value');
const unruled = S.need(none, 'placement.leaveOneOut.minRate');
ok(unruled.notMeasured && /placement\.leaveOneOut\.minRate is not ruled/.test(unruled.notMeasured) && unruled.value === undefined, 'an unruled key gives NOT MEASURED with its name, and no value');
const fromRefused = S.need(S.load({ file: put('{') }), 'signatures.weight.direct');
ok(fromRefused.notMeasured && fromRefused.value === undefined, 'a refused file gives NOT MEASURED even for a key with a default');
let threw = false; try { S.need(good, 'no.such.key'); } catch { threw = true; }
ok(threw, 'asking for a key outside the schema is a programming error, thrown');

console.log('each bad file is refused with its reason, and nothing from it is used');
ok(refusedWith('{', /not valid JSON/), 'unreadable JSON');
ok(refusedWith('[]', /top level must be an object/), 'a top level that is not an object');
ok(refusedWith({ settings: [] }, /"settings" must be an object/), 'settings that is not an object');
ok(refusedWith({ settngs: {} }, /unknown top-level field "settngs"/), 'a misspelt top-level field');
ok(refusedWith({ settings: { 'refusal.forceableSharefloor': entry(0.3) } }, /not a known setting/), 'an unknown key (case differs)');
ok(refusedWith({ settings: { 'signatures.nearTwoBand': { ruled: '2026-11-05', why: 'x' } } }, /no value/), 'an entry with no value');
ok(refusedWith({ settings: { 'signatures.nearTwoBand': entry('ten percent') } }, /must be a number or "n\/d"/), 'a value of the wrong type');
ok(refusedWith({ settings: { 'signatures.nearTwoBand': entry(1.5) } }, /above 1/), 'a fraction above 1');
ok(refusedWith({ settings: { 'signatures.weight.viaDoor': entry(-0.1) } }, /below 0/), 'a weight below 0');
ok(refusedWith({ settings: { 'signatures.weight.direct': entry(0) } }, /below or equal to 0/), 'a direct weight of 0 (it must be positive)');
ok(refusedWith({ settings: { 'placement.leaveOneOut.minJobs': entry(4.5) } }, /whole number/), 'a non-integer count');
ok(refusedWith({ settings: { 'placement.leaveOneOut.minJobs': entry('5/1') } }, /only allowed for fractions/), 'a fraction string for a count');
ok(refusedWith({ settings: { 'refusal.forceableShareFloor': entry('1/0') } }, /must be a number or "n\/d"/), 'a zero denominator');
ok(refusedWith({ settings: { 'refusal.forceableShareFloor': entry(0.3, { ruled: 'yesterday' }) } }, /"ruled" must be the ruling date/), 'a ruling with no date');
ok(refusedWith({ settings: { 'refusal.forceableShareFloor': entry(0.3, { why: ' ' }) } }, /"why" must say why/), 'a ruling with no reason');
ok(refusedWith({ settings: { 'refusal.forceableShareFloor': entry(0.3, { by: 'me' }) } }, /unknown field "by"/), 'an unknown field in an entry');

console.log('the settings id moves with values, not with dates or reasons');
const base = { 'signatures.nearTwoBand': entry(0.1) };
const idOf = s => S.load({ file: put({ settings: s }) }).id;
ok(idOf(base) === idOf({ 'signatures.nearTwoBand': entry(0.1, { ruled: '2027-01-01', why: 'another reason' }) }), 'same value, other date and reason: same id');
ok(idOf(base) !== idOf({ 'signatures.nearTwoBand': entry(0.2) }), 'another value: another id');
ok(idOf(base) === none.id, 'a key ruled at its default value judges like the default: same id as no file');
ok(idOf({ 'refusal.forceableShareFloor': entry(0) }) !== none.id, 'ruling an unruled key moves the id (null → 0 is a change)');

console.log('the command');
const run = args => { const r = spawnSync(process.execPath, [MOD, ...args], { encoding: 'utf8', env: { ...process.env, HOME: DIR } }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const shown = run(['--settings', put({ settings: { 'refusal.forceableShareFloor': entry('1/3') } })]);
ok(shown.code === 0, `prints, exit 0 (got ${shown.code})`);
ok(/refusal\.forceableShareFloor\s+1\/3 \(0\.333333\)/.test(shown.out) && /ruled 2026-11-05/.test(shown.out), 'a ruled fraction prints as written and as its value, with its date');
ok(/signatures\.weight\.viaDoor\s+0\.5\s+default, not ruled/.test(shown.out), 'a default prints as "default, not ruled"');
ok(/placement\.leaveOneOut\.minRate\s+NOT RULED/.test(shown.out), 'an unruled key prints NOT RULED');
ok(/1 ruled, 8 default, 2 unruled/.test(shown.out), 'the headline counts ruled, default and unruled (1 + 8 + 2 = 11 keys)');
const badRun = run(['--settings', put('{')]);
ok(badRun.code === 2 && /REFUSED/.test(badRun.out), 'a refused file exits 2 and says REFUSED');
ok(run([]).code === 2, 'no arguments: usage, exit 2');
const proj = run(['--project', 'demo']);
ok(proj.code === 0 && proj.out.includes(path.join(DIR, '.anvideck', 'projects', 'demo', 'settings.json')), '--project resolves under the store of $HOME');

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
