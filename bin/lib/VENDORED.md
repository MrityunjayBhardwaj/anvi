# Vendored GSD Library

These 16 `.cjs` modules came from GSD (get-shit-done) so that anvi runs standalone,
without a GSD installation. `GSD_LIB` in `bin/anvi-tools.cjs` points at *this*
directory — there is no runtime dependency on GSD, and the name is only a reminder
of where the code came from.

| | |
|---|---|
| Source | GSD `bin/lib/`, upstream [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) |
| GSD version | **1.27.0** |
| Vendored | 2026-07-07 — `node scripts/vendor-drift.js` names the commit per module |
| State | **11 of 16 modules carry anvi patches** — see the table below |
| Consumer | `bin/anvi-tools.cjs` (`GSD_LIB` points here) |
| License | MIT — see [`LICENSE.GSD`](./LICENSE.GSD) |

## License & attribution

GSD is **MIT-licensed** (© 2025 Lex Christopherson; upstream
[gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)). These
modules are redistributed under those terms, and GSD's full MIT notice is preserved
beside them in [`LICENSE.GSD`](./LICENSE.GSD) — as the MIT license requires for
substantial portions. This attribution is the one reference to GSD that is
permanent and load-bearing; it stands whether or not the code has since been
modified.

MIT is compatible with anvi's **GPL-3.0** license: the combined work is distributed
under GPL-3.0, while these vendored modules keep their MIT notice.

## What is actually in here

This file used to say the modules were byte-identical to upstream. They were not,
and the gap grew quietly for three weeks — because the person patching a module is
never the person re-reading this document. So the state is no longer prose. It is
derived from git history, and `test/vendored-doc-contract.test.js` fails when this
table and the tree disagree.

**patched** — carries anvi commits since it was vendored. **pristine** — untouched.

| Module | State | Lines vs 1.27.0 |
|---|---|---|
| `commands.cjs` | patched | 78 |
| `config.cjs` | patched | 18 |
| `core.cjs` | patched | 302 |
| `frontmatter.cjs` | pristine | 0 |
| `init.cjs` | patched | 148 |
| `milestone.cjs` | patched | 10 |
| `model-profiles.cjs` | pristine | 0 |
| `phase.cjs` | patched | 40 |
| `profile-output.cjs` | patched | 12 |
| `profile-pipeline.cjs` | pristine | 0 |
| `roadmap.cjs` | pristine | 0 |
| `security.cjs` | pristine | 0 |
| `state.cjs` | patched | 6 |
| `template.cjs` | patched | 6 |
| `uat.cjs` | patched | 10 |
| `verify.cjs` | patched | 12 |

**Which commits to re-apply is not written down here. Ask the tool:**

```sh
node scripts/vendor-drift.js
```

**This document names no commit, on purpose, and putting the list back would reintroduce a
defect rather than add a convenience.** A commit list can only be written while you are still
on the branch that produced it, and this repo merges by squash — so the branch's own commits
are replaced by one new sha at merge time, and every sha the list names stops existing in the
history the list describes. The result was not a slip that better discipline would catch: the
check went green on the branch, green in CI, and reddened the default branch the instant it
landed, because **no run before the merge could have produced the right answer.** Deriving the
column costs one command and removes the class. `test/vendored-doc-contract.test.js` fails if
a sha reappears in this file.

**The line counts are a dated measurement, not a live one.** Measured 2026-08-02
against a pristine copy of 1.27.0, counting insertions + deletions
(`git diff --no-index --numstat`), **642 differing lines** across the eleven patched
modules. Upstream has not moved from 1.27.0, so all of the divergence is ours.

`commands.cjs` and `init.cjs` have both been patched again since that measurement, so
their counts — and the stated total — are low by roughly the size of those commits. The
numbers above are deliberately NOT adjusted by hand: they are the output of one dated
measurement, and editing them to account for later patches would turn a measurement into
an estimate while keeping a measurement's authority. Re-deriving them needs the
pristine 1.27.0 bytes, which is the `--upstream` run; the state and the commit list come
from history alone and are current on every run, which is the whole reason only the line
counts carry a date.

Re-derive any of this at any time:

```sh
node scripts/vendor-drift.js                        # state + commits, from git history alone
node scripts/vendor-drift.js --commits              # …with what each patch did
node scripts/vendor-drift.js --upstream <dir>       # …plus line counts, against a pristine copy
```

The upstream path is an argument rather than somewhere the tool goes looking,
because anvi does not depend on a GSD installation and a tool that reached into one
would give it that dependency back. Point it at any unpacked copy of 1.27.0.

## Re-vendoring

Per module, decided by the table above — not by one rule for the directory:

- **pristine** (`frontmatter`, `model-profiles`, `profile-pipeline`, `roadmap`,
  `security`) — nothing of ours is in them, so re-vendor wholesale from a newer GSD
  and update this file. That is exactly what "pristine" is recorded for.
- **patched** — diff first, then re-vendor and re-apply that module's commits, which
  `node scripts/vendor-drift.js` lists in the order to apply them, oldest first. Never
  overwrite it in one step.

`core.cjs` is the one to be careful with. Its 302 lines are not incidental drift;
they are three safety properties:

- `anviDirFor` — the shared-resolver integration, the single point where every
  planning path is resolved, and what makes the resolver invariant true for the CLI
- the project-management tree resolution, with its legacy `.planning/` fallback
- identity enforcement on the write path, which refuses to serve a project's
  knowledge to a directory that cannot prove it owns it

Overwriting the file removes all three at once, silently, while reading as routine
maintenance. That combination — a sameness claim plus an instruction premised on it —
is what made the old version of this document a hazard rather than merely inaccurate.

### What the patches did

Also derived, for the same reason the commit list is — this was a second table of the
same shas, carrying a hand-written gloss of each one. The glosses were the commit
subjects, so nothing was lost by asking git for them instead:

```sh
node scripts/vendor-drift.js --commits
```

That prints every patch commit, deduplicated across modules, each with its subject.

## The policy, as it actually stands

The stated policy was **vendor now, rewrite later**
([#1](https://github.com/MrityunjayBhardwaj/anvi/issues/1)): need a behaviour
change, rewrite the module as an anvi-native one rather than patching the vendored
copy. That has not been followed, and it is worth saying so plainly rather than
leaving an aspiration written in the present tense.

What happened instead was **vendor now, patch at the seam, rewrite later** — and the
seam is path resolution. Every anvi commit in the table above exists because
resolving where a project's documents live is a decision the whole system has to
make one way, and the vendored modules each made it their own way.

Two consequences worth carrying:

- **"Do not hand-edit" is a review hazard, not a protection.** The label makes
  reviewers skip the file, so patches land here with *less* scrutiny than anywhere
  else in the tree — the opposite of what it promises. It is kept as a signal to
  think twice, not as a claim that nothing has been edited.
- **A safety property placed in a patched module inherits that module's deletion
  instruction.** Prefer a native module for anything load-bearing. `anviDirFor`
  living in `core.cjs` is the case in point, and the reason this file now carries a
  test.

## Module map (internal deps: relative `require('./x.cjs')` only, zero npm deps)

| Module | Role |
|---|---|
| core.cjs | shared helpers: project root, config, planning paths, output |
| state.cjs | STATE.md read/write/patch |
| phase.cjs | phase resolution, numbering, plan discovery |
| roadmap.cjs | ROADMAP.md operations |
| verify.cjs | plan structure / completeness / commit verification |
| config.cjs | config.json handling |
| template.cjs | template select/fill |
| milestone.cjs | milestone archive/completion |
| commands.cjs | misc command implementations |
| init.cjs | project initialization |
| frontmatter.cjs | frontmatter get/set/merge/validate |
| security.cjs | path/field validation, safe JSON |
| uat.cjs | UAT audit |
| model-profiles.cjs | model profile table (used by verify/commands) |
| profile-output.cjs, profile-pipeline.cjs | user-profiling pipeline — **unreachable from anvi-tools** (no `profile` command is routed); vendored for completeness |

## Known `__dirname` escapes (behavior differs from GSD-installed layout)

`profile-output.cjs:449,642` resolves templates via `__dirname/../../templates/` — in GSD
that's `get-shit-done/templates/{user-profile,dev-preferences}.md`; here it lands in anvi's
`templates/`, which doesn't have those files. Harmless today because the profile pipeline is
unreachable from anvi-tools; if a `profile` command is ever added, rewrite these modules
natively first. All other modules resolve paths from `cwd` or absolute `homedir()` — identical
behavior pre/post vendoring.
