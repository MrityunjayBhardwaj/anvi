#!/usr/bin/env node
// scripts/hook-imports.cjs — does an INSTALL resolve the shared modules its hooks import? (#244)
//
// WHY THIS FILE EXISTS. `install.sh` ships hooks by globbing `hooks/*.js`, so a fresh
// install is always complete and the repo is always self-consistent — the sibling-import
// check added with the shared span scanner already asserts the latter. Neither answers
// the question this covers: an install made BEFORE a shared module existed has no copy
// of it, the importing hook swallows the failure in a try/catch, and it runs with its
// feature silently switched off. Nothing anywhere could see that.
//
// THE CASE THAT DECIDES THE DESIGN is GROUP 3. Node resolves a module's realpath before
// resolving its dependencies, so a SYMLINKED hook loads `./x.js` out of the repo it
// points into and is perfectly healthy with no copy in the install directory. That is
// what a dev-mode install looks like — and it is the author's own environment, which is
// exactly why this defect stays invisible. A naive "is the file in the install dir"
// check would report every dev install as broken. A guard whose false alarms are the
// common case gets ignored, so the false-positive case is tested as deliberately as the
// true-positive one.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'scripts', 'hook-imports.cjs'));

// A fresh tree per invocation. The subject inspects directories and one case plants a
// deliberate defect; sharing a fixture between cases would let one case measure another
// case's tree.
function tmp(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `anvi-244-${name}-`));
  return d;
}
const HOOK_WITH_DEP = "try { require('./dep.js'); } catch {}\n";

console.log('\nGROUP 1 — the derivation reads sibling imports, and only those');
{
  eq(M.siblingImports("require('./dep.js')").join(), 'dep.js', 'a sibling import is found');
  eq(M.siblingImports('require("./a.js");require("./b.js")').join(), 'a.js,b.js', 'several are found in order');
  eq(M.siblingImports("require('./a.js');require('./a.js')").length, 1, 'a repeated import is reported once');
  eq(M.siblingImports("require('fs')").length, 0, 'a package is not a sibling');
  eq(M.siblingImports("require('../lib/y.js')").length, 0, 'a deeper relative path is out of scope, not mislabelled');
  eq(M.siblingImports("require('./sub/y.js')").length, 0, 'a nested path is out of scope too');
}

console.log('\nGROUP 2 — a COPY install missing the module is REPORTED');
{
  const d = tmp('copy-missing');
  fs.writeFileSync(path.join(d, 'guard.js'), HOOK_WITH_DEP);
  const r = M.auditInstall(d, ['guard.js']);
  eq(r.examined, 1, 'the hook was examined (a zero here would mean this case checked nothing)');
  eq(r.imports, 1, 'and its one import was counted');
  eq(r.missing.length, 1, 'the missing module is reported');
  eq(r.missing[0].dep, 'dep.js', 'named');
  eq(r.missing[0].hook, 'guard.js', 'and attributed to the hook that imports it');
}

console.log('\nGROUP 3 — a DEV install resolving through a symlink is NOT reported');
{
  // The shape of a real dev-mode install: the hook is a symlink into the repo, the
  // module sits beside the REAL file, and the install directory holds neither.
  const repo = tmp('dev-repo');
  const inst = tmp('dev-install');
  fs.writeFileSync(path.join(repo, 'guard.js'), HOOK_WITH_DEP);
  fs.writeFileSync(path.join(repo, 'dep.js'), 'module.exports={};\n');
  fs.symlinkSync(path.join(repo, 'guard.js'), path.join(inst, 'guard.js'));

  ok(!fs.existsSync(path.join(inst, 'dep.js')), 'CONTROL: the install directory really does lack the module');
  const r = M.auditInstall(inst, ['guard.js']);
  eq(r.examined, 1, 'the symlinked hook was still examined');
  eq(r.imports, 1, 'and its import was still counted — this case is not vacuous');
  eq(r.missing.length, 0, 'but nothing is reported, because the runtime resolves it through the realpath');

  // Proof the audit and the runtime agree, rather than the audit merely being lenient.
  const run = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(inst, 'guard.js'))});require(${JSON.stringify(path.join(repo, 'dep.js'))});console.log('LOADED')`], { encoding: 'utf-8' });
  ok(/LOADED/.test(run.stdout), 'OBSERVED: node really can load that module from the symlinked position');
}

console.log('\nGROUP 4 — the states that must not be silently swallowed');
{
  const d = tmp('broken');
  fs.symlinkSync(path.join(d, 'nowhere.js'), path.join(d, 'guard.js'));
  const r = M.auditInstall(d, ['guard.js']);
  eq(r.unresolvable.length, 1, 'a hook whose own file cannot be resolved is reported, not skipped');
  eq(r.examined, 0, 'and it is not counted as examined, because it was not');
}
{
  const d = tmp('absent');
  const r = M.auditInstall(d, ['guard.js']);
  eq(r.missing.length, 0, 'a hook that is not installed at all raises no missing-import finding');
  eq(r.examined, 0, 'and the denominator says so rather than implying a clean inspection');
}

console.log('\nGROUP 4b — a TRANSITIVE dependency is followed');
{
  // The hole a one-level check leaves: the registered hook's own import resolves, so it
  // reads as healthy, while the module it just loaded cannot load what IT needs. Same
  // silent-permissive answer, one step further down.
  const d = tmp('transitive');
  fs.writeFileSync(path.join(d, 'guard.js'), "try { require('./mid.js'); } catch {}\n");
  fs.writeFileSync(path.join(d, 'mid.js'), "require('./deep.js');\n");
  const r = M.auditInstall(d, ['guard.js']);
  ok(r.missing.some(m => m.dep === 'deep.js'), 'the second-level module is reported missing');
  eq(r.missing.length, 1, 'and the first level, which does resolve, is not reported');
  ok(r.imports >= 2, `both levels were counted (imports=${r.imports})`);

  // OBSERVED: the runtime agrees this is broken, so the finding is not pedantry.
  const run = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(d, 'mid.js'))})`], { encoding: 'utf-8' });
  ok(run.status !== 0, 'and node really does fail to load that chain');
}
{
  const d = tmp('cycle');
  fs.writeFileSync(path.join(d, 'guard.js'), "require('./a.js');\n");
  fs.writeFileSync(path.join(d, 'a.js'), "require('./b.js');\n");
  fs.writeFileSync(path.join(d, 'b.js'), "require('./a.js');\n");
  const r = M.auditInstall(d, ['guard.js']);
  eq(r.missing.length, 0, 'a cycle among present modules terminates and reports nothing');
}

console.log('\nGROUP 5 — the report names the remedy, and says which way it answered');
{
  const d = tmp('report-bad');
  fs.writeFileSync(path.join(d, 'guard.js'), HOOK_WITH_DEP);
  const lines = [];
  const bad = M.reportInstall(d, ['guard.js'], l => lines.push(l));
  ok(bad === true, 'a missing import returns true');
  ok(lines.some(l => /install\.sh/.test(l)), 'and the output names the remedy');
  ok(lines.some(l => /silently switched off/.test(l)), 'and says what the failure looks like, since it is invisible');

  const good = tmp('report-good');
  fs.writeFileSync(path.join(good, 'guard.js'), HOOK_WITH_DEP);
  fs.writeFileSync(path.join(good, 'dep.js'), 'module.exports={};\n');
  const okLines = [];
  ok(M.reportInstall(good, ['guard.js'], l => okLines.push(l)) === false, 'a complete install returns false');
  ok(okLines.some(l => /1 shared-module import\(s\) across 1 installed hook\(s\)/.test(l)), 'and prints the denominator, so a clean result is distinguishable from an empty one');
}

console.log('\nGROUP 6 — it is WIRED: registration actually runs this');
{
  // Driven end to end rather than asserted from the source, because a require that is
  // present but never called would pass a source check and do nothing at runtime.
  const home = tmp('home');
  const hooksDir = path.join(home, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const { REGISTRATIONS } = require(path.join(ROOT, 'scripts', 'register-hooks.cjs'));
  const first = [...new Set(REGISTRATIONS.map(r => r[2]))][0];
  fs.writeFileSync(path.join(hooksDir, first), HOOK_WITH_DEP);

  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'register-hooks.cjs')], {
    encoding: 'utf-8', env: { ...process.env, HOME: home },
  });
  eq(run.status, 0, 'registration still exits 0 — the installer runs under set -e and must not abort on a diagnosis');
  ok(new RegExp(`${first.replace('.', '\\.')} imports \\./dep\\.js`).test(run.stdout), 'and it reported the planted missing import for a REGISTERED hook');
}

console.log('\nGROUP 7 — the real repo, derived rather than listed');
{
  const HOOKS = path.join(ROOT, 'hooks');
  const files = fs.readdirSync(HOOKS).filter(f => f.endsWith('.js'));
  let imports = 0, unresolved = [];
  for (const f of files) {
    for (const dep of M.siblingImports(fs.readFileSync(path.join(HOOKS, f), 'utf-8'))) {
      imports++;
      if (!fs.existsSync(path.join(HOOKS, dep))) unresolved.push(`${f} -> ${dep}`);
    }
  }
  ok(files.length > 0, `examined ${files.length} hook files`);
  ok(imports > 0, `and found ${imports} sibling imports — a zero would mean this asserted nothing`);
  eq(unresolved.length, 0, `every sibling import in the repo resolves${unresolved.length ? ` — ${unresolved.join(', ')}` : ''}`);
}

console.log(`\n${fail ? '✗' : '✓'} hook install imports: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
