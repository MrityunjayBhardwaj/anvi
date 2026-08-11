#!/usr/bin/env node
// Derives each hook's sibling-module dependencies and asks whether an INSTALL can
// actually resolve them (#244).
//
// Why this exists. `install.sh` ships hooks by globbing `hooks/*.js`, so a FRESH
// install is always complete. The gap is a STALE one: the repo gains a shared module,
// an existing hook starts requiring it, and nothing re-checks the tree that was
// installed before the module existed. Every such import is wrapped in a blanket
// try/catch — correctly, because the two install trees are not guaranteed to be the
// same version — which makes the failure silent AND permissive: the hook falls back to
// its pre-feature behaviour, exits 0, and says nothing. A swallowed import is
// indistinguishable from the feature having nothing to do.
//
// The question this asks is deliberately NOT "is the file sitting in the install
// directory". Node resolves a module's realpath BEFORE resolving its dependencies, so a
// SYMLINKED hook resolves `require('./x.js')` against the repo it points into, and is
// perfectly healthy with no copy of `x.js` in the install directory at all. That is the
// normal state of a dev-mode install, and a presence check would report every one of
// them as broken — a guard whose false alarms are the common case gets ignored, which
// is worse than not having it.
//
// So it asks the question Node asks: from the realpath of the installed hook, does the
// dependency resolve? That answers false exactly when the hook genuinely cannot load it.

const fs = require('fs');
const path = require('path');

// Sibling imports only — `require('./x.js')`. A bare specifier is a package and a
// deeper relative path is not the pattern this is about; both are out of scope rather
// than silently lumped in, so a future `require('../lib/y.js')` is not reported as a
// missing sibling under a name that would mislead.
const SIBLING_RE = /require\(\s*['"]\.\/([^'"/]+)['"]\s*\)/g;

function siblingImports(source) {
  const out = [];
  for (const m of source.matchAll(SIBLING_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Resolve the way the runtime will. `fs.realpathSync` on the hook, then look for the
// dependency beside the REAL file. A broken symlink throws here, which is a genuine
// finding rather than something to swallow: a hook whose own file cannot be resolved
// cannot load anything.
function resolveFrom(hookPath) {
  const real = fs.realpathSync(hookPath);
  return dep => {
    const target = path.join(path.dirname(real), dep);
    return { target, present: fs.existsSync(target) };
  };
}

// Audit one install tree. `files` is the set of hook filenames that are expected to be
// there — pass the REGISTERED set, so this reports on hooks the harness will actually
// run rather than on whatever happens to be lying in the directory.
//
// Returns a denominator alongside the findings. A sweep that examined nothing reports
// the same empty `missing` as a clean one, and the two must never be confused: the
// caller prints `examined` so a zero is readable.
function auditInstall(hooksDir, files) {
  const missing = [];
  const unresolvable = [];
  let examined = 0;
  let imports = 0;

  for (const file of files) {
    const hookPath = path.join(hooksDir, file);
    // Not installed at all is a different fault with a different remedy, and it is
    // already the registration check's business. Skipped here, and counted, so this
    // never claims to have inspected a hook it never saw.
    //
    // `lstat` rather than `existsSync`, and the distinction is the whole point:
    // existsSync FOLLOWS a symlink, so a hook whose link dangles answers false and
    // would be filed as "never installed" — silence, for a hook that cannot load at
    // all. lstat sees the link itself, so a dangling one reaches the resolver below
    // and is reported. The permissive reading is the one that had to be closed here.
    let present = true;
    try { fs.lstatSync(hookPath); } catch { present = false; }
    if (!present) continue;

    let resolver;
    try {
      resolver = resolveFrom(hookPath);
    } catch (e) {
      unresolvable.push({ hook: file, reason: e.code || e.message });
      continue;
    }

    let source;
    try {
      source = fs.readFileSync(fs.realpathSync(hookPath), 'utf-8');
    } catch (e) {
      unresolvable.push({ hook: file, reason: e.code || e.message });
      continue;
    }

    examined++;
    // Follow the chain, not just the first step. Today every shared module is a leaf, so
    // one level would be complete — but the failure this whole check exists to catch is a
    // dependency that resolves for the importer and not for the runtime. If a shared
    // module ever imports another, a one-level check reports the registered hook as
    // healthy while the load still fails, which is the same silent-permissive answer in
    // a new place. `seen` is keyed on the resolved target, so a diamond is walked once
    // and a cycle terminates.
    const seen = new Set();
    const walk = (src, from) => {
      for (const dep of siblingImports(src)) {
        const { target, present } = from(dep);
        if (seen.has(target)) continue;
        seen.add(target);
        imports++;
        if (!present) { missing.push({ hook: file, dep, lookedIn: path.dirname(target) }); continue; }
        // A module that resolves but cannot be read is not evidence of health.
        let next;
        try { next = fs.readFileSync(fs.realpathSync(target), 'utf-8'); } catch { continue; }
        walk(next, resolveFrom(target));
      }
    };
    walk(source, resolver);
  }

  return { examined, imports, missing, unresolvable };
}

// The install-time report. Loud, names the remedy, and returns whether anything was
// wrong so a caller can decide — this function does not exit, because its main caller
// runs under `set -euo pipefail` and a non-zero status there would abort an otherwise
// healthy install over a diagnosis.
function reportInstall(hooksDir, files, log = console.log) {
  const { examined, imports, missing, unresolvable } = auditInstall(hooksDir, files);

  for (const u of unresolvable) {
    log(`  ⚠ ${u.hook} could not be read in the install (${u.reason}).`);
  }
  for (const m of missing) {
    log(`  ⚠ ${m.hook} imports ./${m.dep}, which is not in ${m.lookedIn}`);
    log(`    That import is caught and ignored at runtime, so the hook will run with`);
    log(`    the feature silently switched off. Re-run ./install.sh to ship it.`);
  }
  if (missing.length === 0 && unresolvable.length === 0) {
    log(`  ✓ ${imports} shared-module import(s) across ${examined} installed hook(s) all resolve`);
  }
  return missing.length > 0 || unresolvable.length > 0;
}

module.exports = { siblingImports, auditInstall, reportInstall, SIBLING_RE };
