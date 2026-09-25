#!/usr/bin/env node
// Test: the edit-time structure guard refuses a NEW eroding import that starts in the edited
// file, allows everything else, and never blocks on its own ignorance (issue #443).
//
// HERMETIC. Every spawned run gets its own HOME, so the machine's real registry, cache and
// notices cannot colour a result, and nothing here writes into them. The package's imports
// are extracted by a line scanner named in the registry entry — the same contract the
// TypeScript extractor meets, which is observed separately against a real package.
//
// BOTH DIRECTIONS. A guard that refuses what it must is half a witness; one stuck ON refuses
// that too, and is the failure that gets a guard uninstalled. So each refusal is paired with
// a release, and every release that could be silence-for-the-wrong-reason is paired with the
// in-process decision that says how much was examined.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const HOOKS = path.join(__dirname, '..', 'hooks');
const HOOK = path.join(HOOKS, 'structure-guard-hook.js');
const H = require(HOOK);
const R = require(path.join(HOOKS, 'structure-rules.js'));
const S = require(path.join(HOOKS, 'structure-graph.js'));

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-structure-hook-')));
const HOME = path.join(DIR, 'home');
const PKG = path.join(DIR, 'pkg');
const STATE = path.join(HOME, '.claude', 'structure-guard-cache');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });

const put = (rel, text) => { const f = path.join(PKG, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
put('src/low/a.ts', "export const a = 1;\n");
put('src/low/b.ts', "import { a } from './a';\nexport const b = a;\n");
put('src/mid/m.ts', "import { b } from '../low/b';\nexport const m = b;\n");
put('src/mid/n.ts', "export const n = 1;\n");
put('src/mid/old.ts', "import { up } from '../top/t';\nexport const old = up;\n");   // a grandfathered violation
put('src/top/t.ts', "export const up = 1;\n");
put('src/low/a.test.ts', "export const t = 1;\n");

const EXTRACTOR = path.join(DIR, 'line-extractor.js');
fs.writeFileSync(EXTRACTOR, `
const fs = require('fs'), path = require('path');
module.exports = { create: (pkgDir, entry) => entry.broken === 'unmeasured' ? { notMeasured: 'fixture extractor declines' } : ({
  id: 'lines@1', configFiles: [],
  edges(rel, content) {
    if (entry.broken === 'throw') throw new Error('fixture extractor exploded');
    const found = new Map(); let unresolved = 0;
    for (const m of content.matchAll(/^(import|export)\\b[^'"]*?(?:from\\s+)?['"](\\.[^'"]+)['"]/gm)) {
      const base = path.posix.join(path.posix.dirname(rel), m[2]);
      const t = [base + '.ts', base + '/index.ts'].find(x => fs.existsSync(path.join(pkgDir, x)));
      if (!t) { unresolved++; continue; }
      found.set(t, m[1] === 'export' && (found.get(t) !== false));
    }
    return { edges: [...found], unresolved };
  },
}) };
`);
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', excludes: ['.test.'], layers: [
  { n: 0, name: 'low', dirs: ['low'] }, { n: 1, name: 'mid', dirs: ['mid'] }, { n: 2, name: 'top', dirs: ['top'] }] }));
const BASELINE = path.join(DIR, 'baseline.json');
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { layer: ['src/mid/old.ts -> src/top/t.ts'], cycle: [] } }));

const REGISTRY = path.join(HOME, '.claude', 'structure-guard.json');
const register = extra => fs.writeFileSync(REGISTRY, JSON.stringify({ packages: [{
  dir: PKG, design: DESIGN, baseline: BASELINE, extractor: EXTRACTOR, cache: path.join(DIR, 'cache.json'), ...extra }] }));

const readFile = f => fs.readFileSync(f, 'utf8');
const decide = (payload, registry) => H.evaluate(payload, { registry, readFile, rules: R, graph: S, stateDir: STATE });
const registryNow = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

function hook(payload, home = HOME) {
  const r = spawnSync('node', [HOOK], { input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', timeout: 20000, env: { ...process.env, HOME: home } });
  let out = {};
  try { out = JSON.parse(r.stdout || '{}'); } catch { out = {}; }
  const hs = out.hookSpecificOutput || {};
  return { exit: r.status, denied: hs.permissionDecision === 'deny', reason: hs.permissionDecisionReason || '',
           context: hs.additionalContext || '', stdout: r.stdout || '' };
}
const edit = (rel, from, to, session = 'sess-1') => ({ session_id: session, cwd: PKG, tool_name: 'Edit',
  tool_input: { file_path: path.join(PKG, rel), old_string: from, new_string: to, replace_all: false } });
const write = (rel, content, session = 'sess-1') => ({ session_id: session, cwd: PKG, tool_name: 'Write',
  tool_input: { file_path: path.join(PKG, rel), content } });

console.log('\nTHE PROPOSED FILE — rebuilt exactly as the tool would leave it:');
{
  const f = path.join(PKG, 'src/low/a.ts');
  ok(H.proposedContent('Write', { file_path: f, content: 'X' }, readFile) === 'X', 'a Write proposes its content');
  ok(H.proposedContent('Edit', { file_path: f, old_string: '= 1', new_string: '= 2' }, readFile) === 'export const a = 2;\n',
     'an Edit proposes the file with its one match replaced');
  ok(H.proposedContent('Edit', { file_path: f, old_string: 'absent', new_string: 'x' }, readFile) === null,
     'an Edit whose old_string is absent proposes nothing to judge');
  put('src/low/twice.ts', 'k k\n');
  const tw = path.join(PKG, 'src/low/twice.ts');
  ok(H.proposedContent('Edit', { file_path: tw, old_string: 'k', new_string: 'j' }, readFile) === null,
     'an Edit whose old_string matches twice proposes nothing — the tool refuses that itself');
  ok(H.proposedContent('Edit', { file_path: tw, old_string: 'k', new_string: 'j', replace_all: true }, readFile) === 'j j\n',
     'with replace_all, every match is replaced');
  ok(H.proposedContent('Edit', { file_path: f, old_string: '1', new_string: "'$&'" }, readFile) === "export const a = '$&';\n",
     'a replacement containing $& is taken literally, as the tool writes it');
  fs.unlinkSync(tw);
  // With replace_all, so the uniqueness check cannot be what answers: an empty needle "matches"
  // between every character, and splitting on it would interleave new_string through the file.
  ok(H.proposedContent('Edit', { file_path: f, old_string: '', new_string: 'x', replace_all: true }, readFile) === null,
     'an empty old_string proposes nothing, even with replace_all');
  // Carries an Edit's fields, so only the tool name can be what refuses it.
  ok(H.proposedContent('NotebookEdit', { file_path: f, old_string: '= 1', new_string: '= 2' }, readFile) === null,
     'a tool it does not model proposes nothing, even with an Edit\'s fields');
}

console.log('\nWHICH PACKAGE — the deepest registered directory, through symlinks:');
{
  const reg = { packages: [{ dir: DIR }, { dir: PKG }] };
  const hit = H.packageFor(path.join(PKG, 'src/low/a.ts'), reg);
  ok(hit && hit.dir === PKG && hit.rel === 'src/low/a.ts', 'the deepest registered directory owns the file, with a package-relative path');
  ok(H.packageFor(path.join(PKG, 'src/low/not-yet.ts'), reg).rel === 'src/low/not-yet.ts', 'a file that does not exist yet still has an owner');
  const link = path.join(DIR, 'link-to-pkg');
  fs.symlinkSync(PKG, link);
  ok((H.packageFor(path.join(link, 'src/low/a.ts'), { packages: [{ dir: PKG }] }) || {}).rel === 'src/low/a.ts',
     'a path reached through a symlink belongs to the package it resolves into');
  // A new file cannot be resolved itself; only its nearest existing parent can.
  ok((H.packageFor(path.join(link, 'src/low/brand-new/x.ts'), { packages: [{ dir: PKG }] }) || {}).rel === 'src/low/brand-new/x.ts',
     'so does a file that does not yet exist, reached through a symlink');
  ok(H.packageFor(path.join(os.tmpdir(), 'elsewhere.ts'), { packages: [{ dir: PKG }] }) === null, 'a file outside every registered package has no owner');
}

console.log('\nNO REGISTRY — nothing is guarded, and nothing is loaded:');
{
  const r = hook(edit('src/low/a.ts', "export const a = 1;\n", "import { m } from '../mid/m';\nexport const a = m;\n"));
  ok(r.exit === 0 && r.stdout === '', 'with no registry file, even an upward import passes in silence');
}

register();

console.log('\nREFUSED — a new violation that starts in the edited file:');
{
  const up = edit('src/low/a.ts', "export const a = 1;\n", "import { m } from '../mid/m';\nexport const a = m;\n");
  const r = hook(up);
  ok(r.exit === 2 && r.denied, `an upward import is REFUSED — exit 2 and a deny payload (got exit ${r.exit})`);
  ok(/layer: src\/low\/a\.ts -> src\/mid\/m\.ts/.test(r.reason), 'the refusal names the edge and the rule');
  ok(/Remedies:/.test(r.reason), 'and carries the remedy');
  // The whole command, flag by flag, from the registry entry — so a remedy that names the script
  // but not the files it needs, or names the wrong one, reddens here.
  ok(r.reason.includes(`structure-guard.js --package '${PKG}' --design '${DESIGN}' --extractor '${EXTRACTOR}' ` +
                       `--baseline '${BASELINE}' --write-baseline '${BASELINE}' --allow-growth`),
     'including the exact command that grandfathers a deliberate edge, built from the registry entry');
  ok(/before the edge lands records nothing/.test(r.reason) && /user's decision/.test(r.reason),
     'and says the edge must land first, by the user\'s decision — regenerating before it lands records nothing');

  // A path with a space and an apostrophe must still be ONE shell word, and a package with no
  // registered extractor must not print an empty --extractor.
  const odd = H.refusalText('p', 'src/x.ts', [{ rule: 'layer', key: 'k', detail: 'd' }], { modules: 1, edges: 1 },
    "/tmp/it's a pkg", { design: '/d.json', baseline: '/b.json' });
  // The --package word alone: the extractor case below owns what sits between the other flags.
  ok(odd.includes("--package '/tmp/it'\\''s a pkg' "),
     'the command quotes a path with a space and an apostrophe as one shell word');
  ok(!/--extractor/.test(odd), 'and names --extractor only when the package registers one');

  // What the removed implied rule refused (#542): m reaches a through b, and imports a directly
  // because it USES a. Real use, so it passes — and the refusal text no longer offers that remedy.
  const direct = edit('src/mid/m.ts', "import { b } from '../low/b';\n", "import { b } from '../low/b';\nimport { a } from '../low/a';\n");
  const di = hook(direct);
  const dd = decide(direct, registryNow());
  ok(di.exit === 0 && !di.denied && dd.decision === 'allow' && /nothing new/.test(dd.why),
     `a direct import of something also reachable through another module is ALLOWED (${dd.decision}: ${dd.why})`);
  ok(!/implied/.test(r.reason), 'and no refusal names an implied rule or its remedy');

  const w = hook(write('src/low/fresh.ts', "import { up } from '../top/t';\nexport const f = up;\n"));
  ok(w.exit === 2 && /src\/low\/fresh\.ts -> src\/top\/t\.ts/.test(w.reason), 'a Write creating a new file with an upward import is REFUSED');
}

console.log('\nALLOWED — each release paired with what was examined:');
{
  const down = edit('src/mid/n.ts', "export const n = 1;\n", "import { a } from '../low/a';\nexport const n = a;\n");
  const r = hook(down);
  const d = decide(down, registryNow());
  ok(r.exit === 0 && r.stdout === '', 'an import down a layer passes in silence');
  ok(d.decision === 'allow' && d.examined.modules === 6, `and the silence is a judgement over the package (${d.examined && d.examined.modules} modules examined)`);

  const note = edit('src/mid/old.ts', "export const old = up;\n", "// still grandfathered\nexport const old = up;\n");
  const g = hook(note);
  const gd = decide(note, registryNow());
  ok(g.exit === 0 && gd.decision === 'allow' && gd.examined.edges >= 1,
     `editing a file whose violation is in the baseline passes — the ratchet, not a missed edge (${gd.examined.edges} edges examined)`);

  // Closing a cycle puts TWO edges on it: the one this edit adds (refused — it starts here) and
  // b's existing import of a, which starts in ANOTHER file: counted, never refused on b's behalf.
  const closes = edit('src/low/a.ts', "export const a = 1;\n", "import { b } from './b';\nexport const a = 1;\n");
  const cd = decide(closes, registryNow());
  ok(cd.decision === 'deny' && cd.fresh.map(f => f.key).join() === 'src/low/a.ts -> src/low/b.ts' && cd.elsewhere === 1,
     `a cycle closed by this edit refuses only the edge that starts here, and counts the other file's (${cd.decision}, ${cd.elsewhere} elsewhere)`);

  const outside = hook(edit('src/low/a.test.ts', "export const t = 1;\n", "import { up } from '../top/t';\nexport const t = up;\n"));
  const od = decide(edit('src/low/a.test.ts', "export const t = 1;\n", "import { up } from '../top/t';\n"), registryNow());
  ok(outside.exit === 0 && od.why === 'outside the package corpus', 'an excluded file is not judged, and says why');

  const absent = edit('src/low/a.ts', 'NOT IN THE FILE', "import { up } from '../top/t';\n");
  ok(hook(absent).exit === 0 && decide(absent, registryNow()).why === 'edit shape not judged',
     'an Edit whose old_string does not match is allowed, not guessed at');

  // The reason as well as the exit: the proposal step also declines an unmodelled tool, so a
  // missing tool gate would still exit 0 — only the stated reason tells the two apart.
  const reading = { tool_name: 'Read', tool_input: { file_path: path.join(PKG, 'src/low/a.ts') } };
  ok(hook(reading).exit === 0 && decide(reading, registryNow()).why === 'not an edit', 'a tool that is not an edit passes');
  const garbled = hook('not json at all{{');
  ok(garbled.exit === 0 && garbled.stdout === '', 'malformed stdin exits 0 in silence — unreadable input is not the guard failing');
}

console.log('\nTHE REGISTERED MATCHER — every tool it names is judged, or declared unjudged and said (#533):');
{
  // Derived from the registration, not restated: widening the matcher without deciding what the
  // hook does with the new tool reddens here, instead of reaching the hook as "not an edit".
  const REG = require(path.join(__dirname, '..', 'scripts', 'register-hooks.cjs'));
  const rows = REG.REGISTRATIONS.filter(r => r[2] === 'structure-guard-hook.js');
  ok(rows.length === 1, `the guard is registered once (${rows.length})`);
  const tokens = [...REG.matcherTools(rows[0][1])].sort();
  const handled = [...H.JUDGED_TOOLS, ...Object.keys(H.UNJUDGED_TOOLS)].sort();
  ok(tokens.join('|') === handled.join('|'), `the matcher's tools (${tokens.join('|')}) are exactly the judged plus the declared-unjudged (${handled.join('|')})`);
  ok(!H.JUDGED_TOOLS.some(t => t in H.UNJUDGED_TOOLS), 'and no tool is both');

  // MultiEdit is registered but not offered by Claude Code 2.1.270 or 2.1.282, so its edit shape
  // has never been observed. Silence would read as approval; guessing the shape could refuse wrongly.
  const multi = (session, file = path.join(PKG, 'src/low/a.ts')) => ({ session_id: session, cwd: PKG, tool_name: 'MultiEdit',
    tool_input: { file_path: file, edits: [{ old_string: "export const a = 1;\n", new_string: "import { up } from '../top/t';\nexport const a = up;\n" }] } });
  const d = decide(multi('sess-me'), registryNow());
  ok(d.decision === 'unmeasured' && /MultiEdit/.test(d.why) && /not judged/.test(d.why),
     `a MultiEdit in a registered package is NOT MEASURED, and says which tool (${d.decision}: ${d.why})`);
  const first = hook(multi('sess-me'));
  ok(first.exit === 0 && !first.denied && /NOT MEASURED/.test(first.context) && /MultiEdit/.test(first.context),
     'the spawned hook allows it and tells the session so');
  ok(hook(multi('sess-me')).stdout === '', 'once per session');
  // Its own notice kind: being told about MultiEdit must not use up the package's real NOT MEASURED.
  register({ broken: 'unmeasured' });
  const real = hook(edit('src/low/a.ts', "export const a = 1;\n", "import { up } from '../top/t';\nexport const a = up;\n", 'sess-me'));
  register();
  ok(/NOT MEASURED/.test(real.context) && !/MultiEdit/.test(real.context),
     'a real NOT MEASURED later in the same session is still said');
  const outsideMulti = hook(multi('sess-me2', path.join(DIR, 'elsewhere.ts')));
  ok(outsideMulti.exit === 0 && outsideMulti.stdout === '', 'a MultiEdit outside every registered package stays silent');
}

console.log('\nFIXED SINCE THE BASELINE — said once per session on an allowed edit; never refused, never rewritten (#451):');
{
  const OLD_SRC = "import { up } from '../top/t';\nexport const old = up;\n";
  const OLD_KEY = 'src/mid/old.ts -> src/top/t.ts';
  const repair = s => edit('src/mid/old.ts', OLD_SRC, 'export const old = 1;\n', s);
  const baselineBefore = fs.readFileSync(BASELINE, 'utf8');

  const r = hook(repair('sess-fix'));
  const d = decide(repair('sess-fix'), registryNow());
  ok(r.exit === 0 && !r.denied && d.decision === 'allow' && (d.fixed || []).map(f => f.key).join() === OLD_KEY,
     `an edit that repairs a baselined violation is allowed, and the decision carries it as fixed (got exit ${r.exit})`);
  ok(/1 violation in pkg fixed since its baseline/.test(r.context) && r.context.includes(OLD_KEY),
     'the hook says so, naming the fixed violation');
  ok(/comes back.*allowed in silence/.test(r.context) && /user's (decision|call)/.test(r.context),
     'and says a return would pass in silence, and that regenerating is the user\'s decision');
  ok(r.context.includes(`--write-baseline '${BASELINE}'`) && !/--allow-growth/.test(r.context),
     'with the exact regenerate command, and without --allow-growth');
  ok(fs.readFileSync(BASELINE, 'utf8') === baselineBefore, 'the hook leaves the baseline file byte-identical');

  // Land the repair first: while it is only proposed, the next edit's graph has nothing fixed, and
  // "quiet" would be true for that reason instead of the marker's.
  put('src/mid/old.ts', 'export const old = 1;\n');
  const nextEdit = edit('src/mid/n.ts', "export const n = 1;\n", "import { a } from '../low/a';\nexport const n = a;\n", 'sess-fix');
  const again = hook(nextEdit);
  const ad = decide(nextEdit, registryNow());
  ok(again.exit === 0 && again.stdout === '' && ad.decision === 'allow' && (ad.fixed || []).length === 1,
     `the second allowed edit in the same session is quiet, though it still sees the repair (${(ad.fixed || []).length} fixed)`);

  // Its own marker: being told about a repair must not use up the NOT MEASURED notice.
  register({ broken: 'unmeasured' });
  const told = hook(edit('src/low/a.ts', "export const a = 1;\n", "import { up } from '../top/t';\nexport const a = up;\n", 'sess-fix'));
  ok(/NOT MEASURED/.test(told.context), 'a NOT MEASURED notice later in that session is still said');
  register();

  // With the repair on disk, refuse an unrelated upward edit: a refused edit never lands, so it
  // says nothing about fixes.
  const upward = edit('src/low/a.ts', "export const a = 1;\n", "import { m } from '../mid/m';\nexport const a = m;\n", 'sess-deny');
  const denied = hook(upward);
  const dd = decide(upward, registryNow());
  ok(denied.exit === 2 && denied.context === '' && !fs.existsSync(path.join(STATE, 'notices', 'sess-deny.fixed')),
     `a refused edit carries no fixed notice and writes no marker for one (got exit ${denied.exit})`);
  ok(dd.decision === 'deny' && dd.notice === undefined,
     'and the refusal decision itself carries no notice — only an allowed edit reports repairs');

  // The ruling's accepted trade-off, asserted by name: the violation coming back while the
  // baseline still holds it is grandfathered — allowed, and silent.
  const readd = edit('src/mid/old.ts', 'export const old = 1;\n', OLD_SRC, 'sess-readd');
  const back = hook(readd);
  const bd = decide(readd, registryNow());
  ok(back.exit === 0 && back.stdout === '' && bd.decision === 'allow' && Array.isArray(bd.fixed) && bd.fixed.length === 0 && bd.examined.edges >= 1,
     `re-adding it before the baseline is regenerated is allowed in silence — grandfathered, as ruled (${bd.examined && bd.examined.edges} edges examined)`);

  put('src/mid/old.ts', OLD_SRC);
}

console.log('\nTHE DESIGN ID — no verdict across two designs (#535):');
{
  const designObj = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
  const ID = R.designId(designObj);
  const rules = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).rules;
  const D2 = path.join(DIR, 'design-id-2.json');       // src/low/a.ts moved to the top layer
  const d2 = { ...designObj, layers: designObj.layers.map(l => l.n === 2 ? { ...l, files: ['low/a.ts'] } : l) };
  fs.writeFileSync(D2, JSON.stringify(d2));
  const ID2 = R.designId(d2);
  const SB = path.join(DIR, 'baseline-stamped.json');
  const stamp = id => fs.writeFileSync(SB, JSON.stringify({ designId: id, rules }));
  const reg = (design, extra = {}) => ({ packages: [{ dir: PKG, design, baseline: SB, extractor: EXTRACTOR, cache: path.join(DIR, 'cache.json'), ...extra }] });
  const upward = s => edit('src/low/b.ts', "import { a } from './a';\n", "import { a } from './a';\nimport { up } from '../top/t';\n", s);

  stamp(ID);
  ok(decide(upward('sess-d1'), reg(DESIGN)).decision === 'deny', 'a baseline stamped with the design in force judges as before');

  const moved = decide(upward('sess-d2'), reg(D2));
  ok(moved.decision === 'unmeasured' && moved.why.includes(ID) && moved.why.includes(ID2) && /--write-baseline/.test(moved.why),
     `a design that moved a file since the baseline is NOT MEASURED, naming both ids and the command (${moved.decision})`);
  fs.writeFileSync(REGISTRY, JSON.stringify(reg(D2)));
  const spawned = hook(upward('sess-d2'));
  ok(spawned.exit === 0 && !spawned.denied && /NOT MEASURED/.test(spawned.context) && spawned.context.includes(ID2),
     'the spawned hook allows the edit and says why, instead of refusing across two frames');

  ok(decide(upward('sess-d3'), reg(DESIGN, { designId: ID })).decision === 'deny', 'armed under the design in force, it judges');
  stamp(ID2);   // design AND baseline swapped together after arming — only the registry's id can tell
  const swapped = decide(upward('sess-d4'), reg(D2, { designId: ID }));
  ok(swapped.decision === 'unmeasured' && /since the package was armed/.test(swapped.why) && /re-arm/.test(swapped.why),
     'a design and baseline swapped together after arming are caught by the id the registry recorded');
  fs.writeFileSync(SB, JSON.stringify({ rules }));
  const bare = decide(upward('sess-d5'), reg(DESIGN, { designId: ID }));
  ok(bare.decision === 'unmeasured' && /names no design/.test(bare.why), 'an armed package whose baseline names no design is not judged');
  ok(decide(upward('sess-d6'), reg(DESIGN)).decision === 'deny',
     'a package armed before designs were identified, with an unstamped baseline, is judged as given');
  register();
}

console.log('\nNOT MEASURED AND FAILED — allowed, and said once per session:');
{
  register({ broken: 'unmeasured' });
  const up = s => edit('src/low/a.ts', "export const a = 1;\n", "import { up } from '../top/t';\nexport const a = up;\n", s);
  const first = hook(up('sess-u'));
  ok(first.exit === 0 && !first.denied && /NOT MEASURED/.test(first.context),
     'an extractor that cannot run allows the edit and SAYS it is not measuring');
  const second = hook(up('sess-u'));
  ok(second.exit === 0 && second.stdout === '', 'the second time in the same session it is quiet');
  ok(/NOT MEASURED/.test(hook(up('sess-v')).context), 'a different session is told again');

  register({ broken: 'throw' });
  const crash = hook(up('sess-c'));
  ok(crash.exit === 0 && !crash.denied && /FAILED and allowed the edit/.test(crash.context),
     'a crash inside the guard allows the edit and says so — it never blocks on its own bug');
  ok(fs.existsSync(path.join(STATE, 'errors.log')) && /fixture extractor exploded/.test(fs.readFileSync(path.join(STATE, 'errors.log'), 'utf8')),
     'and the failure is recorded where it can be read');

  fs.writeFileSync(BASELINE.replace('.json', '-bad.json'), JSON.stringify({ grandfathered: [] }));
  fs.writeFileSync(REGISTRY, JSON.stringify({ packages: [{ dir: PKG, design: DESIGN, baseline: BASELINE.replace('.json', '-bad.json'), extractor: EXTRACTOR }] }));
  ok(/NOT MEASURED/.test(hook(up('sess-b')).context), 'a baseline with no rules section is not measured, rather than read as empty');
}

console.log('\nBOUNDED STATE — old notice markers and an overgrown log are trimmed, only on the rare write:');
{
  const NOTICES = path.join(STATE, 'notices');
  const DAY = 24 * 60 * 60 * 1000;
  const plant = (name, ageMs) => {
    const f = path.join(NOTICES, name);
    fs.mkdirSync(NOTICES, { recursive: true });
    fs.writeFileSync(f, 'planted\n');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(f, t, t);
    return f;
  };
  const stale = plant('stale-sess', 2 * DAY);
  const recent = plant('recent-sess', 60 * 60 * 1000);

  // The hot path first: a judged allow and a judged refusal must leave a stale marker alone.
  register();
  const up = s => edit('src/low/a.ts', "export const a = 1;\n", "import { up } from '../top/t';\nexport const a = up;\n", s);
  const judged = hook(edit('src/mid/n.ts', "export const n = 1;\n", "import { a } from '../low/a';\nexport const n = a;\n", 'sess-hot'));
  const refused = hook(up('sess-hot'));
  ok(judged.exit === 0 && refused.exit === 2 && fs.existsSync(stale),
     `an ordinary judged edit — allowed or refused — prunes nothing (exits ${judged.exit}/${refused.exit}, stale marker still there)`);

  register({ broken: 'unmeasured' });
  const told = hook(up('sess-prune'));
  ok(/NOT MEASURED/.test(told.context) && fs.existsSync(path.join(NOTICES, 'sess-prune')),
     'a new notice is still said, and its own marker written');
  ok(!fs.existsSync(stale), 'writing a new marker removes one older than a day');
  ok(fs.existsSync(recent), 'and keeps one from the last day');

  // A session already told writes no marker, so it prunes nothing either.
  const stale2 = plant('stale-again', 2 * DAY);
  const quiet = hook(up('sess-prune'));
  ok(quiet.stdout === '' && fs.existsSync(stale2), 'a session already told is quiet and prunes nothing');

  ok(H.pruneNotices(path.join(DIR, 'no-such-dir'), 'x') === 0, 'pruning a directory that does not exist removes nothing and does not throw');

  // A clock that jumps forward makes every marker look old — the one just written must survive it.
  const own = plant('own-sess', 0);
  ok(H.pruneNotices(NOTICES, 'own-sess', Date.now() + 3 * DAY) >= 1 && fs.existsSync(own),
     'the marker being written is never pruned, even when every marker reads as old');

  // The log, in-process with a small cap so the trim is exercised many times over.
  const LOGF = path.join(DIR, 'capped', 'errors.log');
  for (let i = 1; i <= 60; i++) H.recordFailure(LOGF, `entry-${i}\tsome failure text\n`, 300);
  const kept = fs.readFileSync(LOGF, 'utf8');
  ok(Buffer.byteLength(kept) <= 300, `the log stays under its cap (${Buffer.byteLength(kept)} of 300 bytes after 60 writes)`);
  ok(kept.endsWith('entry-60\tsome failure text\n'), 'the newest entry is kept');
  ok(!/^entry-1\t/m.test(kept), 'the oldest entry is dropped');
  ok(kept.split('\n').slice(0, -1).every(l => /^entry-\d+\tsome failure text$/.test(l)), 'every kept line is whole — the trim cuts at line boundaries');

  const SMALL = path.join(DIR, 'small', 'errors.log');
  H.recordFailure(SMALL, 'one\n', 300);
  H.recordFailure(SMALL, 'two\n', 300);
  ok(fs.readFileSync(SMALL, 'utf8') === 'one\ntwo\n', 'under the cap, entries are appended and nothing is dropped');

  // And the spawned hook's crash path goes through the cap.
  const REAL_LOG = path.join(STATE, 'errors.log');
  fs.writeFileSync(REAL_LOG, 'OLDEST-LINE\n' + 'x'.repeat(H.LOG_MAX_BYTES) + '\n');
  register({ broken: 'throw' });
  const crashed = hook(up('sess-crash-cap'));
  const after = fs.readFileSync(REAL_LOG, 'utf8');
  ok(crashed.exit === 0 && /FAILED and allowed the edit/.test(crashed.context), 'a crash is still allowed and said');
  ok(Buffer.byteLength(after) <= H.LOG_MAX_BYTES && /fixture extractor exploded/.test(after) && !after.includes('OLDEST-LINE'),
     `the hook's own crash record holds the log under ${H.LOG_MAX_BYTES} bytes, newest kept, oldest dropped (${Buffer.byteLength(after)} bytes)`);
}

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
