# Vendored GSD Library

These 16 `.cjs` modules came from GSD (get-shit-done) so that anvi runs standalone,
without a GSD installation. `GSD_LIB` in `bin/anvi-tools.cjs` points at *this*
directory — there is no runtime dependency on GSD, and the name is only a reminder
of where the code came from.

| | |
|---|---|
| Source | GSD `bin/lib/`, upstream [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) |
| GSD version | **1.27.0** |
| Vendored | 2026-07-07 (`5545c77`) |
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
The commit list is the re-apply order, oldest first.

| Module | State | Lines vs 1.27.0 | anvi commits to re-apply, oldest first |
|---|---|---|---|
| `commands.cjs` | patched | 78 | `714665e` `3c39e29` `df3a27f` `fc786cd` `98c88a6` `11941f1` `ccb9eca` |
| `config.cjs` | patched | 18 | `3c39e29` `df3a27f` |
| `core.cjs` | patched | 302 | `7359e61` `714665e` `3c39e29` `df3a27f` `98c88a6` `11941f1` `9c52fc0` `390e7cc` |
| `frontmatter.cjs` | pristine | 0 | — |
| `init.cjs` | patched | 148 | `3c39e29` `df3a27f` `98c88a6` |
| `milestone.cjs` | patched | 10 | `3c39e29` `df3a27f` |
| `model-profiles.cjs` | pristine | 0 | — |
| `phase.cjs` | patched | 40 | `3c39e29` `df3a27f` |
| `profile-output.cjs` | patched | 12 | `3c39e29` |
| `profile-pipeline.cjs` | pristine | 0 | — |
| `roadmap.cjs` | pristine | 0 | — |
| `security.cjs` | pristine | 0 | — |
| `state.cjs` | patched | 6 | `3c39e29` |
| `template.cjs` | patched | 6 | `98c88a6` |
| `uat.cjs` | patched | 10 | `3c39e29` `df3a27f` `98c88a6` |
| `verify.cjs` | patched | 12 | `3c39e29` `df3a27f` `98c88a6` |

`commands.cjs` has been patched again since that measurement (`ccb9eca`), so its
count — and the stated total — are low by roughly the size of that commit. Re-deriving
them needs the pristine 1.27.0 bytes, which is the `--upstream` run below; the commit
list beside each module comes from history alone and is current either way.

**The line counts are a dated measurement, not a live one.** Measured 2026-08-02
against a pristine copy of 1.27.0, counting insertions + deletions
(`git diff --no-index --numstat`), **642 differing lines** across the eleven patched
modules. Upstream has not moved from 1.27.0, so all of the divergence is ours.

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
- **patched** — diff first, then re-vendor and re-apply that module's commits from
  the table. Never overwrite it in one step.

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

| Commit | Change |
|---|---|
| `7359e61` | resolve the project-management tree, with a loud legacy fallback |
| `714665e` | resolve `.anvi` through the shared resolver; stop calling two opposite outcomes "skipped" |
| `3c39e29` | route the unambiguous path joins through the tree resolver |
| `df3a27f` | route the reported-path strings through the tree resolver |
| `fc786cd` | let workflows ask where the documents live |
| `98c88a6` | repair three paths the transform above fused, and the prose it ate |
| `11941f1` | report what the repo actually holds, not whether an ignore rule exists |
| `9c52fc0` | stop counting files the tree no longer has |
| `390e7cc` | refuse to serve knowledge to a directory that cannot prove it owns it |

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
