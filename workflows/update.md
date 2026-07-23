<purpose>
Take an existing anvi clone from whatever version/state it is in to fully
current — the framework in `~/.claude/`, the hook registrations in
`settings.json`, and every selected project's catalogue structure — asking only
the questions a human must actually answer.

STATE-DRIVEN and IDEMPOTENT is the whole point. Reconcile what is INSTALLED
against what the repo SHIPS (installed `VERSION` vs repo `VERSION`, registered
hooks vs the manifest, each project's `.anvi` layout vs the centralized model).
Apply everything the latest version brings EVEN IF the repo was already pulled —
never key on "did we pull." Running it twice is a clean no-op the second time.

This is a thin front door over `install.sh --migrate` (which does framework sync
+ stale-hook prune + per-project `link-catalogues --apply` + grant). The workflow
adds: detect the delta, drive the pull, ask the genuine questions, and VERIFY the
result (currency + hook-liveness + `--check` + a second-run no-op).
</purpose>

<inputs>
$ARGUMENTS — optional. Examples:
- a project dir (or several) → migrate exactly those projects' catalogues.
- `--check` / "just tell me what's stale" → detect + report the delta, do NOT apply.
- `--version-list` / "what versions are there" → print the release catalogue
  (version + date + short description, installed + latest marked); do NOT install.
- `--version <v>` / "update to 2.0.0" → install/upgrade to a SPECIFIC release.
  UPGRADE-ONLY: install.sh refuses to go below the installed version. The latest
  is this clone's tree; an older tagged release is taken from `git archive <tag>`
  into a temp dir (the clone is never checked out). A version present in the
  CHANGELOG but without a git tag (and not the latest) is not installable — the
  command says so and lists what is.
- absent → detect the delta, then ask which projects to migrate.
</inputs>

<paths>
ANVI_INSTALL=~/.claude/anvi           # live install (a symlink to the repo in dev mode, else a copy)
STORE=~/.anvideck                     # centralized store (git remote: anvi_artifacts)
CONFIG=~/.claude/anvi-config.json     # { "memorySync": true|false }
REPO=<the anvi git clone>             # resolved in step 1 — install.sh + VERSION + .git live here
</paths>

<process>

<step name="1_locate_repo">
Find the anvi git clone to update FROM (it must be a real repo — `git pull` and
`install.sh` run here):
- If the cwd is an anvi clone (has `install.sh`, `VERSION`, and `.git`), use it.
- Else if `~/.claude/anvi` is a symlink, resolve its target — that is the repo
  (dev-mode install).
- Else ask the user where their anvi clone is.
Do NOT treat a COPY-mode `~/.claude/anvi` (no `.git`) as the repo — you cannot
pull it. State-driven means the repo is the source of truth for "latest."
</step>

<step name="2_detect_delta">
Read installed vs latest BEFORE changing anything (observation, not inference):

  cat ~/.claude/anvi/VERSION            # installed
  cat "$REPO/VERSION"                   # what the working tree currently is
  ( cd "$REPO" && git fetch -q && git log --oneline HEAD..@{u} 2>/dev/null )  # unpulled commits, if a tracking remote exists
  node "$REPO/scripts/currency-report.js" 2>/dev/null | tail -3   # catalogue drift context (optional)

Report the delta plainly: installed vX vs repo vY, N unpulled commits (or "repo
already current"), how many projects still on the local-`.anvi` layout. Even when
versions MATCH, per-project migration may still be pending — say so.

If `$ARGUMENTS` asked for `--check`/report-only: stop here with the delta report.
</step>

<step name="2b_version">
Handle version selection, if `$ARGUMENTS` asked for it:
- `--version-list` (or "what versions exist") → run `bash "$REPO/install.sh"
  --version-list` and show the catalogue (version + date + summary, installed +
  latest marked). This is informational — stop here unless they also ask to install.
- `--version <v>` → this pins the install target. Pass it straight through to
  `install.sh` in step 4 (`--version <v> --migrate …`). install.sh enforces the
  UPGRADE-ONLY rule (it refuses to go below the installed version) and materializes
  an older tagged release from `git archive` without touching the clone — do NOT
  re-implement the guard here; let install.sh own it and report its refusal.
  Note: `--version` runs THAT release's own installer, so a target older than the
  one that introduced `--migrate`/the store model can't honor those flags — the
  realistic targets are the latest and future tagged releases.
Absent → target is the latest (this clone's tree), the default flow below.
</step>

<step name="2c_store_durability">
Check that the STORE itself is durable — a git repo with a remote — because the
whole centralized model rests on it: without a tracked repo + remote, every
project's catalogues and the memory mirror are preserved NOWHERE (the V5/V2
failure mode at the store level).

  bash "$REPO/scripts/ensure-store-durable.sh" "$STORE"   # DETECT only — no writes, no network

Read the `STATE:` line it prints:
- DURABLE  → the store is a git repo with a remote; nothing to do here.
- NO_DIR   → the store doesn't exist yet (a fresh machine); /anvi:init creates it.
             Note it, continue — there is nothing to back up until init runs.
- NO_REPO  → the store dir exists but is not a git repo — its catalogues are
             tracked nowhere. Offer to fix it (step 3b question + step 4b).
- NO_REMOTE→ it is a git repo but has no remote — commits stay on this machine,
             pushed nowhere. Offer to create the backup repo (step 3b + 4b).

Detection is always safe to run; CREATING the backup repo is outward-facing and
happens only with explicit consent in step 4b.
</step>

<step name="3_pull">
Bring the working tree to latest, if there is anything to pull:

  ( cd "$REPO" && git pull --ff-only )

Best-effort and NON-fatal: if the clone has no tracking remote, or is already
current, or the user declined, continue anyway — the migrate step applies the
repo's current state regardless of whether the pull happened. (This is what
"state-driven, not pull-driven" means: a clone someone already pulled by hand
still gets fully migrated.) If the pull is not fast-forward, do NOT force it —
report and let the user reconcile.
</step>

<step name="3b_ask">
Ask ONLY the questions a human must answer. Use one grouped prompt; skip any
question already answered by `$ARGUMENTS` or existing config.

1. WHICH PROJECTS to migrate. Offer the discoverable set: project dirs named in
   `$ARGUMENTS`, the cwd if it is a project, and the projects under
   `~/.anvideck/projects/*` whose working dir you can locate. "Framework only
   (no per-project migration)" is a valid answer — then run `--migrate` with no
   project args. Migrating a project needs its WORKING DIR (not the store name),
   because `link-catalogues`/`grant` operate on the repo + its `.claude/`.
2. MEMORY BACKUP consent — ONLY if `~/.claude/anvi-config.json` has no
   `memorySync` key yet. Explain plainly: enabling it mirrors each project's
   memory into the store (→ the anvi_artifacts remote) at session end; it is
   one-directional and off by default. Write the chosen boolean to the config.
   If the key already exists, do not re-ask — respect the standing choice.
3. STORE BACKUP REPO — ONLY if step 2c reported NO_REPO or NO_REMOTE. The store
   has no durable backup; ask whether to create one, and if so, for the repo NAME
   (default `anvi_artifacts`) and VISIBILITY (default `private` — catalogues and
   memory are private knowledge). Empty answers take the defaults. If the user
   declines, skip step 4b and warn plainly that catalogues are not backed up.
   Creating a GitHub repo is outward-facing — never do it without this consent.
4. SPLIT-BRAIN resolution is NOT asked up front — it only arises if a project is
   refused in step 4 (both a local and a central `.anvi` exist). Handle it there.
</step>

<step name="4_apply">
Run the one-pass migrate for the selected projects (thread `--version <v>`
through if step 2b set a target — omit it to take the latest):

  bash "$REPO/install.sh" [--version <v>] --migrate <project-dir> [<project-dir> ...]

It syncs the framework, prunes retired hooks, and for each project applies
catalogue-centralization + the scoped permission grant. It is idempotent — a
fully-migrated project reports ALREADY_LINKED / ALREADY_GRANTED, and hooks report
"already registered (no change)."

A project may be REFUSED (non-zero, surfaced, run continues):
- SPLIT_BRAIN — both a real local `.anvi` and a central copy exist. Do NOT
  auto-merge. Confirm the central copy strictly supersets the local (compare both
  directions), then retire the local dir by hand; re-run migrate for that project.
- TRACKED_SETTINGS — `.claude/settings.local.json` is git-tracked (the grant is a
  machine-specific absolute path). Untrack it (`git rm --cached` + gitignore) as
  the message instructs, then re-run.
Report each refusal in plain language; never work around it silently.
</step>

<step name="4b_store_backup">
Only if step 2c found the store not durable AND the user consented in step 3b —
create the backup repo (outward-facing, so gated on that consent):

  bash "$REPO/scripts/ensure-store-durable.sh" --apply --create-remote \
       --repo-name <name> --visibility <private|public> "$STORE"

It `git init`s the store if needed, then runs `gh repo create <name> --<vis>
--source "$STORE" --remote origin --push`. If `gh` is absent or unauthenticated
it prints the exact manual steps and exits non-zero — relay them, do NOT invent a
remote. Pass the name/visibility the user chose (omit a flag to take its default).
If the user declined, skip this step and leave the store as-is.
</step>

<step name="5_verify">
Observe that the update actually landed — do not infer from "the script exited 0":

1. VERSION:  `bash "$REPO/install.sh" --check` → installed == repo, "up to date".
2. Hook liveness: `node "$REPO/test/hook-liveness.test.js"` → every registered
   hook still speaks (a silently-dead hook is invisible to a version check).
3. Prune safety: confirm no foreign/GSD hook was removed — `settings.json` still
   lists any non-anvi hooks it had before (diff against a pre-update copy if unsure).
4. IDEMPOTENCE: run the exact `--migrate` command a SECOND time and confirm it is
   a clean no-op (ALREADY_LINKED / ALREADY_GRANTED / "no change", nothing pruned,
   nothing written). This is the load-bearing property — if the second run still
   mutates, the state detection is wrong; stop and find out why.
5. Per-project: each migrated project's `.anvi` is a symlink into the store and
   its `.claude/settings.local.json` grants `~/.anvideck/projects/<name>`.
6. Store durability: `ensure-store-durable.sh "$STORE"` reports DURABLE (unless the
   user declined the backup repo, in which case it is correctly still NO_REPO/
   NO_REMOTE and that was their explicit choice — say so).
</step>

<step name="6_report">
Summarize what changed: installed version before → after, hooks added/pruned,
projects migrated (and any refused, with the exact manual step to resolve them),
and the memorySync setting. If any project needs durable catalogue persistence,
remind the user the store commits + pushes on session end (the checkpoint hook).
</step>

</process>

<guardrails>
- STATE-DRIVEN, never pull-driven. Apply the repo's current state whether or not a
  pull happened; a second full run must be a no-op.
- Stale-hook pruning is conservative by construction — it removes ONLY names on
  register-hooks' explicit REMOVED list; a user's or GSD's hooks are never touched.
  Do not hand-edit settings to remove hooks; let `--migrate` do it.
- Never auto-resolve a SPLIT_BRAIN or TRACKED_SETTINGS refusal — surface it and let
  the user reconcile. A wrong merge silently loses catalogue knowledge.
- memorySync is opt-in and off by default — never enable it without explicit
  consent; respect an existing choice without re-asking.
- Creating the store backup repo is outward-facing (a real GitHub repo) — do it
  ONLY with explicit consent, default private, and only in the interactive flow.
  Detection (`ensure-store-durable.sh` with no `--apply`) is always safe; the
  installer's `--migrate` only detects+reports, it never creates.
- anvi is PUBLIC: no catalogue IDs in any outward-facing content (commits, PRs,
  issues) — V6.
</guardrails>

<success_criteria>
- [ ] Installed-vs-latest delta detected and reported BEFORE any change
- [ ] Working tree pulled if behind (non-fatal if not); migrate applied regardless
- [ ] Store durability checked; if not a tracked repo with a remote, the backup
      repo was offered (consented, name/visibility chosen) or the user's decline noted
- [ ] Only genuine questions asked (which projects, memorySync if unset, store-backup
      repo if the store isn't durable); existing choices respected
- [ ] `install.sh --migrate` run for the selected projects; refusals surfaced with
      the manual fix, not worked around
- [ ] Verified: `--check` up to date, hook-liveness green, no foreign hook pruned,
      SECOND run a clean no-op, each project symlinked + granted
- [ ] Plain-language report of what changed
</success_criteria>
