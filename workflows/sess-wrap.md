<purpose>
End-of-session wrap for freeform (non-phase) work. Persists what the session
learned into the anvi catalogues and memory, then emits a ready-to-paste
kickoff prompt so the next session starts with full context.

This is the codified version of the recurring manual ritual:
"update the catalogue and memory and share the prompt of the new session."
Streamlined by design — just update and share; not a gated review loop.
</purpose>

<inputs>
$ARGUMENTS — optional freeform instructions to fold into the wrap (e.g. an
extra file to touch, a note to record, "also run the hygiene check"). Execute
them alongside the core steps. Do NOT run the optional hygiene/gap-check pass
(step 5) unless $ARGUMENTS explicitly asks for it.
</inputs>

<paths>
STORE=~/.anvideck                                    # centralized store (git remote: anvi_artifacts)
CATALOGUES=<store>/projects/<project>/.anvi/{hetvabhasa,vyapti,krama,dharana}.md
MEMORY=~/.claude/projects/<encoded-project>/memory/  # MEMORY.md index + detail files

A single session often spans MULTIPLE projects (e.g. a framework fix plus a
downstream project's catalogue). Route each learning to the store of the
project it belongs to — resolve every catalogue dir independently via the
shared resolver; never assume one project per session.
</paths>

<cli_resolution>
Resolve the catalogue directory via the shared resolver — never hand-roll a
candidate list (H1/V1). The catalogue dir is whatever `resolveDir(cwd, '.anvi')`
returns; the project name is `basename(cwd)`.
</cli_resolution>

<process>

<step name="1_harvest_catalogues">
Review THIS session for durable knowledge and write it to the right catalogue.

- Bug fixed / error pattern      → hetvabhasa (root cause, detection signal,
                                    the trap, the real fix, REF).
- Invariant discovered/validated → vyapti (statement, confirmed-by, REF).
- Execution order / lifecycle    → krama (numbered steps, violations).
- Boundary clustering / invariant span shift → re-derive the affected
                                    dharana section (ORIGIN/WHY/HOW/REF).

Rules:
- Update an existing entry rather than duplicating it. Check first.
- IDs are never renumbered or reused (V3); the archive is git history (V2).
- Every new entry carries a REF (UNGROUNDED if no source is grounded yet).
- Outward-facing content never carries catalogue IDs (V6) — but the catalogue
  files themselves do.
- If nothing durable was learned, say so and write nothing. Do NOT manufacture
  entries to look productive.
- SAY WHERE IT LANDED. `catalogue-append` prints the resolved store path (and
  notes when it was reached through the symlink); surface that rather than
  summarising it into "harvested 3 entries". A user who cannot name the file
  cannot check it, back it up, or notice when it stops being written — and the
  path is outside their repo, which is the part that surprises people.
- Then say whether it is SAFE, not merely written. The store commits on session
  end; committing is not pushing. If the store has no remote, the entries you
  just harvested exist on this machine only — state that plainly.
</step>

<step name="2_update_memory">
Update project memory to reflect the new true state.
- MEMORY.md: keep the one-line index pointers current (one line per memory).
- Detail files: update the relevant fact file in place; update-not-duplicate;
  convert relative dates to absolute; delete facts that are now wrong.
Before creating a new memory file, check for an existing one that already
covers the fact.
</step>

<step name="3_persist">
Persist the writes durably (V5 — uncommitted knowledge doesn't exist).
- Catalogue changes live under ~/.anvideck → commit + push to the anvi_artifacts
  remote with a clear message (better than a terse auto-checkpoint). Non-interactive.
- Memory files are written in place (not a pushed repo) — no commit needed.
Print a one-line summary of what was committed and pushed.
</step>

<step name="4_next_session_prompt">
Emit a copy-pasteable kickoff prompt for the next session, inside a fenced
code block, mirroring how a fresh session is bootstrapped. Include:
- FIRST-read pointer: read MEMORY.md → the relevant detail memory → the
  catalogue entries touching the active boundary.
- JUST SHIPPED: what merged/landed this session (PRs, commits, retirements).
- WHAT'S NEXT / PENDING: open tasks, gated items, parked decisions — each with
  enough context to resume without re-deriving.
- ACTIVE CAUTIONS: environment gotchas still in force (e.g. macOS TCC
  Full-Disk-Access block; gated deletions need explicit sign-off).
- WORKFLOW reminder: AnviDev — issue → branch → fix → test AND observe → PR
  (gitmoji, problem/fix body, no AI co-author, no catalogue IDs in content) →
  critical self-review. Claude never merges; wait for the user's go-ahead.
Display it inline. Do NOT write it to a repo file unless $ARGUMENTS asks.
</step>

<step name="5_optional_hygiene" optional="true">
ONLY if $ARGUMENTS explicitly requests it: report working-tree cleanliness per
repo, open PRs/issues per repo, open tasks, and a gap-check — any fix that took
more than one attempt but isn't yet a dharana entry, and any ungrounded
observation the session surfaced (candidate for /anvi:ground).
</step>

<step name="6_additional_instructions">
Carry out any remaining freeform instructions passed in $ARGUMENTS.
</step>

</process>

<success_criteria>
- [ ] Session learnings harvested into the correct catalogues (or an explicit "nothing durable this session")
- [ ] Memory updated (index + detail), update-not-duplicate, absolute dates
- [ ] Catalogue changes committed + pushed to anvi_artifacts
- [ ] Next-session kickoff prompt printed inline, copy-pasteable
- [ ] Any $ARGUMENTS instructions carried out
- [ ] Hygiene/gap-check run ONLY if explicitly requested
</success_criteria>
