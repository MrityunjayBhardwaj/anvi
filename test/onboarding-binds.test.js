#!/usr/bin/env node
// Every entry point that SETS UP a project must bind it.
//
// WHY THIS TEST EXISTS: binding was a documented lifecycle step performed by
// hand. The automated migration path was found to link and grant without ever
// binding, and was fixed. `/anvi:init` — the other door that creates projects —
// was not re-checked, and shipped the same omission. The gap was invisible for
// as long as nothing consulted the binding; the moment resolution began failing
// closed, both paths started producing projects that resolve to NOTHING while
// reporting success.
//
// So the property under test is not "init contains a string". It is: the set of
// entry points that link a project into the store and the set that bind it are
// the SAME set. A new onboarding path added later fails here until it binds.
//
// WHY IT ASSERTS ON DOCUMENT TEXT: `/anvi:init` is a skill — the markdown IS the
// implementation, executed by a model reading it. There is no other artifact to
// assert against. That makes a documented-but-unimplemented step and a missing
// step the same defect here, which is the point.

'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => cond ? (pass++, console.log(`  ✓ ${msg}`)) : (fail++, console.log(`  ✗ ${msg}`));
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The onboarding entry points. Adding a project-creating path? Add it here —
// this list is the contract, and leaving it out is the failure mode this test
// exists to prevent.
const ENTRY_POINTS = [
  { file: 'skills/anvi-init/SKILL.md', what: '/anvi:init — a project set up by hand' },
  { file: 'install.sh',                what: 'install.sh --migrate — the automated rollout' },
];

const LINKS = /link-catalogues\.sh/;
const GRANTS = /grant-catalogue-access\.sh/;

// Shell reaches the binder through a variable (`bind_js="…/bind-store.js"` then
// `node "$bind_js" --apply`), so a literal `bind-store.js … --apply` match finds
// the skill and misses install.sh — a false red that invites weakening the
// assertion until it passes vacuously. Follow the indirection instead: the file
// must name the script AND apply it, directly or through a variable bound to it.
function bindsWithApply(src) {
  if (/bind-store\.js[^\n]*--apply/.test(src)) return true;          // direct
  if (!/bind-store\.js/.test(src)) return false;                     // never named
  const vars = [...src.matchAll(/(\w+)=["']?[^\n"']*bind-store\.js/g)].map(m => m[1]);
  return vars.some(v => new RegExp(`\\$\\{?${v}\\}?["']?[^\\n]*--apply`).test(src));
}
// Where the binding invocation sits, for the ordering check — the applied call,
// not the assignment, since only the call is the step.
function bindIndex(src) {
  const direct = src.search(/bind-store\.js[^\n]*--apply/);
  if (direct !== -1) return direct;
  const vars = [...src.matchAll(/(\w+)=["']?[^\n"']*bind-store\.js/g)].map(m => m[1]);
  for (const v of vars) {
    const i = src.search(new RegExp(`\\$\\{?${v}\\}?["']?[^\\n]*--apply`));
    if (i !== -1) return i;
  }
  return -1;
}

console.log(`every onboarding entry point binds (${ENTRY_POINTS.length} examined)`);
for (const ep of ENTRY_POINTS) {
  const src = read(ep.file);
  // Only entry points that actually attach a project to the store are subject to
  // the rule — stated as a precondition so a file that stops linking doesn't
  // silently stop being checked.
  const attaches = LINKS.test(src) || /\.anvideck\/projects/.test(src) || /ln -s/.test(src);
  ok(attaches, `${ep.what}: attaches a project to the store (precondition)`);
  ok(bindsWithApply(src), `${ep.what}: invokes bind-store.js --apply`);

  // Ordering: the record is written for a project that exists and is reachable,
  // so bind follows the grant. Reversed, it would run against a project the
  // session cannot yet write.
  if (GRANTS.test(src) && bindsWithApply(src)) {
    ok(bindIndex(src) > src.search(GRANTS), `${ep.what}: binds AFTER granting access`);
  }
}

// The decline tells the user to run bind-store. If the flag ever changes, the
// remedy in the message and the remedy in the docs must not drift apart.
console.log('the remedy the resolver names is the one the entry points run');
{
  const resolver = read('hooks/anvi-paths.js');
  ok(bindsWithApply(resolver), 'the decline message names bind-store.js --apply, matching what init runs');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} onboarding binds: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
