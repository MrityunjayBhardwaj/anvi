# Vendored GSD Library

These 16 `.cjs` modules are vendored **verbatim** from GSD (get-shit-done) so that
anvi runs standalone, without a GSD installation.

| | |
|---|---|
| Source | `~/.claude/get-shit-done/bin/lib/` |
| GSD version | **1.27.0** |
| Vendored | 2026-07-07 (byte-identical, verified with `diff -r`) |
| Consumer | `bin/anvi-tools.cjs` (`GSD_LIB` points here) |
| License | MIT — see [`LICENSE.GSD`](./LICENSE.GSD) |

## License & attribution

GSD is **MIT-licensed** (© 2025 Lex Christopherson; upstream
[gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)). These 16
modules are redistributed verbatim under those terms, and GSD's full MIT notice
is preserved beside them in [`LICENSE.GSD`](./LICENSE.GSD) — as the MIT license
requires for substantial portions.

MIT is compatible with anvi's **GPL-3.0** license: the combined work is
distributed under GPL-3.0, while these vendored modules keep their MIT notice.

## Do not hand-edit (Chesterton's fence)

This is inherited code — ~9,250 lines encoding years of `.planning/` semantics we did
not write. Modifying a module you don't fully understand risks breaking invariants that
aren't visible from the call site.

The policy is **vendor now, rewrite later** ([#1](https://github.com/MrityunjayBhardwaj/anvi/issues/1)):

- Need a behavior change? Rewrite that module as an anvi-native one (drop the `.cjs`
  into `bin/lib/` with anvi's own boundaries), don't patch the vendored copy.
- Upstream GSD fixed a bug? Re-vendor the module wholesale from the newer GSD version
  and update the version/date in this file.

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
