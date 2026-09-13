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
fs.writeFileSync(BASELINE, JSON.stringify({ rules: { layer: ['src/mid/old.ts -> src/top/t.ts'], implied: [], cycle: [] } }));

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
  ok(odd.includes("--package '/tmp/it'\\''s a pkg' --design '/d.json' --baseline '/b.json'"),
     'the command quotes a path with a space and an apostrophe as one shell word');
  ok(!/--extractor/.test(odd), 'and names --extractor only when the package registers one');

  const implied = edit('src/mid/m.ts', "import { b } from '../low/b';\n", "import { b } from '../low/b';\nimport { a } from '../low/a';\n");
  const i = hook(implied);
  ok(i.exit === 2 && /implied: src\/mid\/m\.ts -> src\/low\/a\.ts/.test(i.reason) && /already reached via/.test(i.reason),
     'an import another path already provides is REFUSED, with the path that provides it');

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

  // b -> a exists and m -> b exists; adding the edge a -> ... is not what this is. Instead make a
  // DISTANT edge redundant: n imports a, and a new n -> b edge makes nothing implied in n's own
  // edges while the existing m -> b stays direct. The case that matters: an edit to b that makes
  // m's existing edge implied is someone else's edge.
  put('src/mid/m.ts', "import { b } from '../low/b';\nimport { a } from '../low/a';\nexport const m = a + b;\n");
  const mEdits = edit('src/low/b.ts', "import { a } from './a';\n", "import { a } from './a';\n");
  const baseImplied = decide(mEdits, registryNow());
  ok(baseImplied.decision === 'allow' && baseImplied.elsewhere >= 1,
     `a violation that starts in ANOTHER file is counted, not refused (${baseImplied.elsewhere} elsewhere)`);
  ok(hook(mEdits).exit === 0, 'and the spawned hook allows that edit');
  put('src/mid/m.ts', "import { b } from '../low/b';\nexport const m = b;\n");

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

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
