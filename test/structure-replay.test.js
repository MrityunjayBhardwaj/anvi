#!/usr/bin/env node
// Test: replaying real sessions through the structure guard (issue #540) refuses what the hook
// would refuse, allows the rest, counts a refusal once, marks what follows it counterfactual,
// and MEASURES divergence between the replayed tree and the one the tool actually saw.
//
// HERMETIC. A throwaway git repository with fixed commit dates, synthetic transcripts in the
// shape Claude Code writes them (a tool_use in an assistant record, its tool_result and
// `toolUseResult` in the next user record), and a line-scanning extractor — the same contract
// the TypeScript extractor meets, which the hook's own tests pin separately.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));

const SCRIPT = path.join(__dirname, '..', 'scripts', 'structure-replay.js');
const P = require(SCRIPT);
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anvi-replay-')));
const REPO = path.join(DIR, 'repo');
const PKG = 'packages/editor';
const put = (rel, text) => { const f = path.join(REPO, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const gitc = (args, date) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
         GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

const A0 = "export const a = 1;\n";
const B0 = "import { a } from './a';\nexport const b = a;\n";
fs.mkdirSync(REPO, { recursive: true });
gitc(['init', '-q', '-b', 'main'], '2026-01-01T00:00:00Z');
put(`${PKG}/src/low/a.ts`, A0);
put(`${PKG}/src/low/b.ts`, B0);
put(`${PKG}/src/top/t.ts`, "export const up = 1;\n");
put('tsconfig.json', '{}\n');
gitc(['add', '-A'], '2026-01-01T00:00:00Z');
gitc(['commit', '-q', '-m', 'c0'], '2026-01-01T00:00:00Z');
const C0 = gitc(['rev-parse', 'HEAD']).trim();
// Landed after the sessions: an upward import in b.ts, so the landed view has one new violation.
put(`${PKG}/src/low/b.ts`, "import { a } from './a';\nimport { up } from '../top/t';\nexport const b = a + up;\n");
gitc(['commit', '-qam', 'c1'], '2026-01-05T00:00:00Z');

const EXTRACTOR = path.join(DIR, 'line-extractor.js');
fs.writeFileSync(EXTRACTOR, `
const fs = require('fs'), path = require('path');
module.exports = { create: pkgDir => ({ id: 'lines@1', configFiles: [], edges(rel, content) {
  const found = new Map(); let unresolved = 0;
  for (const m of content.matchAll(/^import\\b[^'"]*from\\s+['"](\\.[^'"]+)['"]/gm)) {
    const t = path.posix.join(path.posix.dirname(rel), m[1]) + '.ts';
    if (fs.existsSync(path.join(pkgDir, t))) found.set(t, false); else unresolved++;
  }
  return { edges: [...found], unresolved };
} }) };
`);
const DESIGN = path.join(DIR, 'design.json');
fs.writeFileSync(DESIGN, JSON.stringify({ root: 'src', excludes: ['.test.'], layers: [{ n: 0, name: 'low', dirs: ['low'] }, { n: 1, name: 'top', dirs: ['top'] }] }));

// ── transcripts ──────────────────────────────────────────────────────────────────────────
const TX = path.join(DIR, 'transcripts');
let n = 0;
function session(name, root, calls) {
  const lines = [];
  for (const c of calls) {
    const id = `toolu_${++n}`;
    const base = { sessionId: name, cwd: root, gitBranch: 'main', isSidechain: false };
    lines.push({ ...base, type: 'assistant', timestamp: c.ts, message: { content: [{ type: 'tool_use', id, name: c.tool, input: c.input }] } });
    lines.push({ ...base, type: 'user', timestamp: c.ts, toolUseResult: c.error ? 'Error: String not found' : c.result,
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!c.error }] } });
  }
  fs.mkdirSync(TX, { recursive: true });
  fs.writeFileSync(path.join(TX, `${name}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}
const ROOT = '/work/stave';                 // where the sessions ran; the replay maps it away
const fp = (rel, root = ROOT) => `${root}/${PKG}/${rel}`;
const edit = (ts, rel, original, from, to, extra = {}, root = ROOT) => ({ ts, tool: 'Edit',
  input: { file_path: fp(rel, root), old_string: from, new_string: to, replace_all: false },
  result: { filePath: fp(rel, root), oldString: from, newString: to, originalFile: original, replaceAll: false, structuredPatch: [] }, ...extra });

const UP = "import { up } from '../top/t';\nexport const a = up;\n";
session('s1', ROOT, [
  edit('2026-01-02T01:00:00Z', 'src/low/a.ts', A0, A0, UP),                                    // upward → refused
  edit('2026-01-02T01:01:00Z', 'src/low/a.ts', UP, 'export const a = up;', 'export const a = up + 0;'), // same edge again → not re-refused
  edit('2026-01-02T01:02:00Z', 'src/low/b.ts', B0, 'export const b = a;', 'export const b = a * 2;'),  // harmless, after a refusal
]);
// A Bash `sed` changed b.ts before this session's Edit; only `originalFile` knows.
const SEDDED = "import { a } from './a';\nexport const b = a; // sed\n";
session('s2', ROOT, [
  edit('2025-12-01T00:00:00Z', 'src/low/b.ts', B0, 'x', 'y'),                                   // before the window
  edit('2026-01-02T02:00:00Z', 'src/low/b.ts', SEDDED, 'export const b = a; // sed', 'export const b = a; // sed, then edited'),
  edit('2026-01-02T02:01:00Z', 'src/low/a.ts', A0, 'nope', 'x', { error: true }),               // the tool refused it
  { ts: '2026-01-02T02:02:00Z', tool: 'Edit', input: { file_path: `${ROOT}/packages/other/x.ts`, old_string: 'a', new_string: 'b' },
    result: { filePath: `${ROOT}/packages/other/x.ts`, originalFile: 'a' } },                   // another package
  { ts: '2026-01-02T02:03:00Z', tool: 'Write', input: { file_path: fp('src/top/new.ts'), content: "import { a } from '../low/a';\nexport const n = a;\n" },
    result: { type: 'create', filePath: fp('src/top/new.ts'), content: '', originalFile: null } },   // downward, a new file
]);

// Starts AFTER c1 landed an upward import in b.ts, and edits b.ts harmlessly: judged against
// its own starting tree, the old edge is that session's baseline, so nothing is refused.
const B1 = "import { a } from './a';\nimport { up } from '../top/t';\nexport const b = a + up;\n";
session('s3', ROOT, [edit('2026-01-06T00:00:00Z', 'src/low/b.ts', B1, 'export const b = a + up;', 'export const b = up + a;')]);

// Ran in the fixture checkout itself, so its HEAD reflog places each edit: the tree moves from
// c0 to c1 between the two. No originalFile on either (large files record none), so the first is
// rebuilt from the replayed copy, and the second cannot be: its old_string is not in c1's b.ts.
session('s4', REPO, [
  edit('2026-01-02T03:00:00Z', 'src/low/a.ts', null, 'export const a = 1;', 'export const a = 2;', {}, REPO),
  edit('2026-01-06T03:00:00Z', 'src/low/b.ts', null, 'NOT IN THE FILE', 'x', {}, REPO),
]);

// Bash calls that changed package files: one authoring an import (the blind spot), one a git
// checkout (moves code, authors none). Counted from the result's bashEditDiff, never replayed.
{
  const bash = (ts, id, command, files) => [
    { sessionId: 's5', cwd: ROOT, gitBranch: 'main', type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
    { sessionId: 's5', cwd: ROOT, gitBranch: 'main', type: 'user', timestamp: ts, toolUseResult: { stdout: '', bashEditDiff: { files } },
      message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false }] } }];
  const lines = [
    ...bash('2026-01-02T05:00:00Z', 'tb1', "python3 - <<'EOF'\nopen(p,'w').write(s)\nEOF",
      [{ filePath: fp('src/low/a.ts'), hunks: [{ lines: ["+import { up } from '../top/t'", ' export const a = 1;'] }] }]),
    ...bash('2026-01-02T05:01:00Z', 'tb2', 'git checkout other-branch',
      [{ filePath: fp('src/low/b.ts'), hunks: [{ lines: ["+import { up } from '../top/t'"] }] }]),
    ...bash('2026-01-02T05:02:00Z', 'tb3', "sed -i '' s/x/y/ README.md", [{ filePath: `${ROOT}/README.md`, hunks: [] }]),
    // In the package but excluded by the design — the guard never judges it, so it is not its bypass.
    ...bash('2026-01-02T05:03:00Z', 'tb4', "python3 - <<'EOF'\nopen(p,'w')\nEOF",
      [{ filePath: fp('src/low/a.test.ts'), hunks: [{ lines: ["+import { up } from '../top/t'"] }] }]),
  ];
  fs.writeFileSync(path.join(TX, 's5.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000 });
const OUT = path.join(DIR, 'report.json');
const base = ['--repo', REPO, '--package', PKG, '--design', DESIGN, '--since', C0, '--until', 'main', '--extractor', EXTRACTOR, '--work', path.join(DIR, 'work')];

console.log('\nLOCATING A PATH IN THE PACKAGE, whichever checkout the session ran in:');
ok(JSON.stringify(P.locate('/a/b/packages/editor/src/x.ts', PKG)) === JSON.stringify({ root: '/a/b', rel: 'src/x.ts' }), 'a path maps to its checkout root and package-relative path');
ok(P.locate('/a/packages/editor/wt/packages/editor/src/x.ts', PKG).rel === 'src/x.ts', 'the LAST occurrence wins, so a nested checkout maps to itself');
ok(P.locate('/a/packages/other/x.ts', PKG) === null, 'a path in another package does not map');

console.log('\nTHE REPLAY — refusals, releases, counterfactuals and divergence:');
const r = run([...base, '--transcripts', TX, '--out', OUT]);
const rep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { groups: [], stats: {} };
const rows = s => (rep.groups.find(g => g.session === s) || { edits: [] }).edits;
ok(r.status === 1, `a would-be refusal exits 1 (got ${r.status}${r.status > 1 ? ': ' + r.stdout.slice(-300) : ''})`);
const refusals = rep.groups.flatMap(g => g.refusals);
ok(refusals.length === 1 && refusals[0].fresh.map(f => f.key).join() === 'src/low/a.ts -> src/top/t.ts' && refusals[0].fresh[0].rule === 'layer',
   `the upward import is refused, by rule and edge (${refusals.length} refusal(s))`);
ok(rows('s1')[1] && rows('s1')[1].decision === 'allow', 'an edit that keeps the already-refused edge is not refused again — counted once');
ok(rows('s1')[2] && rows('s1')[2].counterfactual === true && rows('s1')[1].counterfactual === true && rows('s1')[0].counterfactual === false,
   'every edit after a refusal in its group is marked counterfactual, and the refused one is not');
const sed = rows('s2')[0] || {};
ok(sed.resynced === true, 'an Edit whose file differs from what the tool saw is detected and resynced');
ok(sed.decision === 'allow' && /nothing new/.test(sed.why || ''), `and is then JUDGED against the tool's real view, not skipped (${sed.decision}: ${sed.why})`);
const created = rows('s2')[1] || {};
ok(created.tool === 'Write' && created.decision === 'allow' && /nothing new/.test(created.why || ''), 'a Write creating a file with a downward import is judged and allowed');
ok(rep.stats.beforeWindow === 1 && rep.stats.errored === 1 && rep.stats.otherPackage === 1,
   `calls outside the window, errored ones and other packages are counted, not replayed (${JSON.stringify(rep.stats)})`);
const C1 = gitc(['rev-parse', 'main']).trim();
const startOf = s => ((rep.groups.find(g => g.session === s) || {}).start || {}).sha;
ok(startOf('s1') === C0 && startOf('s2') === C0 && startOf('s3') === C1, 'each session starts from the commit its branch pointed at when it began');
ok(rows('s3')[0] && rows('s3')[0].decision === 'allow' && /nothing new/.test(rows('s3')[0].why || ''),
   'a violation already in a session\'s starting tree is its baseline — an unrelated edit to that file is not refused');
ok(/would-be REFUSED/.test(r.stdout) && /WOULD-BE REFUSALS — each needs a ruling/.test(r.stdout) && /src\/low\/a\.ts -> src\/top\/t\.ts/.test(r.stdout),
   'the printed report lists each would-be refusal for a person to rule on');
ok(/divergence: 1 of /.test(r.stdout), 'and states the divergence count with its denominator');
ok(rep.landed && rep.landed.layer && rep.landed.layer.new.length === 1 && rep.landed.layer.new[0].key === 'src/low/b.ts -> src/top/t.ts',
   'the landed view names the violation that reached the branch in the window');

const s4 = rep.groups.find(g => g.session === 's4') || { trees: [], edits: [] };
ok(s4.trees.map(t => t.sha).join() === [C0, C1].join() && s4.trees.every(t => t.method === 'checkout-reflog'),
   `a session in a real checkout is placed edit by edit from that checkout's HEAD reflog, and the tree moves when it moved (${s4.trees.map(t => t.method).join(',')})`);
ok(s4.edits[0] && s4.edits[0].pre === 'reconstructed' && /nothing new/.test(s4.edits[0].why || ''),
   'an Edit with no recorded prior content that applies cleanly to the replayed file is judged');
ok(s4.edits[1] && s4.edits[1].pre === 'diverged' && s4.edits[1].decision === 'diverged' && s4.edits[1].ms === undefined,
   'one that does not apply is DIVERGED and not judged — never judged against a file the tool did not see');
ok(/without one could not be placed/.test(r.stdout) && /diverged 1/.test(r.stdout), 'and the report counts it beside its denominator');

const bs = rep.stats.bash || {};
ok(bs.authored === 1 && bs.addingImport === 1 && bs.gitMoves === 1 && bs.files === 1,
   `Bash changes to the corpus are counted as the stated bypass — one authored with an import, one git move, none outside (${JSON.stringify({ a: bs.authored, i: bs.addingImport, g: bs.gitMoves, f: bs.files })})`);
ok(/BYPASS — changes made through Bash never reach the hook: 1 Bash calls authored/.test(r.stdout) && /1 of them added a relative import/.test(r.stdout),
   'and the report says so every run, with the count');

console.log('\nNOTHING JUDGED IS NOT CLEAN:');
const EMPTY = path.join(DIR, 'empty-tx');
fs.mkdirSync(EMPTY);
const e = run([...base, '--transcripts', EMPTY]);
ok(e.status === 2 && /NOT MEASURED/.test(e.stdout), `a replay that judged no edit exits 2, NOT MEASURED (got ${e.status})`);
const typo = run([...base, '--transcripts', TX, '--sinse', C0]);
ok(typo.status === 2 && /--sinse/.test(typo.stdout), 'an unrecognised flag is NOT MEASURED and named');

try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
