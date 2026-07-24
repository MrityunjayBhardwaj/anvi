<purpose>
Check catalogue freshness and re-validate what has drifted. The currency gate
is the third catalogue gate: Grounding asks "is it real?", Provenance "is it
real HERE?", Currency "is it STILL real?" A catalogue entry is a frozen
inference; the code its REF: points at drifts underneath it. This command
surfaces that drift and drives the re-validation ritual to close it.

The gate is already built (`hooks/currency.js` computer, `scripts/currency-report.js`
batch, the injector's point-of-use nudge). This workflow is the discoverable
entry point plus the discipline for acting on what it reports — the codified
version of the manual ritual "run the report, re-confirm the drifted entries
against the code, and stamp or supersede them."

Full prose spec: ENFORCE.md §Currency.
</purpose>

<inputs>
$ARGUMENTS — optional scope. Examples:
- `--stale`   → only the worklist (RED / YELLOW / GRAY), skipping fresh + reference.
- `--lint`    → the grounding-completeness view (a pure function of catalogue
                text: no-computable-ref, no-validated, line-anchored-ref) — asks
                "can this entry be checked at all?", not "has the code moved?".
- a subsystem ("just the currency subsystem", "only dharana", "the anvi-paths
                cluster") → re-validate a COHERENT group, not everything at once.
- a project dir → run against that project's catalogues instead of the cwd's.
Absent → report the current project, then propose the tightest coherent batch
to re-validate.
</inputs>

<paths>
STORE=~/.anvideck                                   # centralized store (git remote: anvi_artifacts)
CATALOGUES=<store>/projects/<project>/.anvi/{hetvabhasa,vyapti,krama,dharana}.md
REPORT=scripts/currency-report.js                   # repo path; installed at ~/.claude/anvi/scripts/

The catalogue files usually live in the store and are reached through the
project's symlinked `.anvi/`. Editing them reaches the store — write PROBES to
a scratch dir ONLY, never under `.anvi/` (a stray file there is auto-committed
and pushed to the remote by the checkpoint hook).
</paths>

<cli_resolution>
Resolve the catalogue directory via the shared resolver — never hand-roll a
candidate list (H1/V1). The report locates `.anvi` itself via `resolveDir`; when
you read/write entries directly, use the same dir it reports.
</cli_resolution>

<process>

<step name="1_report">
Run the freshness report for the project. Pass `--stale` or `--lint` straight
through if `$ARGUMENTS` asked for them; otherwise run the full report first so
the fresh/reference/unknown context is visible.

  node scripts/currency-report.js [project-dir]
  node scripts/currency-report.js --stale [project-dir]   # worklist only
  node scripts/currency-report.js --lint  [project-dir]   # grounding gaps

Read the summary AND the per-entry rows. This is observation, not inference —
the summary counts hide which specific entries moved.
</step>

<step name="2_interpret">
State the verdicts honestly. Drift is NOT wrongness:
- 🟢 GREEN     no REF file changed since the anchor. "Not known to have drifted"
               — never a proof the entry is true.
- 🟡 YELLOW    a REF file changed since the anchor. The code MOVED; the entry's
               pattern usually outlives its pointer. A re-verify prompt, not a bug.
- 🔴 RED       every REF file is gone. A prompt to RE-READ the entry (step 4),
               not on its own a verdict it is dead — re-point, retire, or (if a
               later change inverted its premise) supersede.
- 🔵 REFERENCE grounded in vendored/store source this repo's git can't diff;
               freshness is an upstream-VERSION question (a VENDOR.json manifest),
               not drift. Not a defect.
- ⚪ GRAY       no computable anchor (cross-ref / section / procedural pattern with
               no source file). Cannot receive a file-drift verdict — leave it;
               it is a grounding-completeness note, not a staleness one.
</step>

<step name="3_scope">
Pick what to re-validate. Do NOT sweep every drifted entry blindly — that path
manufactures rubber-stamped greens, the exact false confidence this gate kills.

- If `$ARGUMENTS` names a subsystem, take that group.
- Otherwise choose the tightest COHERENT cluster whose code you can actually
  re-confirm this session (entries sharing a REF file / subsystem), and say
  plainly which drifted entries you are LEAVING for a later organic pass.
One grounded batch beats a full sweep you can't vouch for.
</step>

<step name="4_reconfirm">
For each entry in scope, re-confirm the CLAIM against the current code — this is
the load-bearing step, and skipping it is how a false green gets stamped:
- Read the entry's body and the CURRENT code its REF/FILES name.
- Confirm the named symbol / structure is still present and the pattern still
  holds (grep for the symbol; read the relevant lines).
- OBSERVE, don't infer: run the relevant test(s). A green suite proves the code
  works; reading it only proves it exists. When they can diverge, run it.
If the pattern NO LONGER holds, do not stamp — re-point the REF, rewrite the
body to the current reality, or retire the entry. Drift that turns out to be a
genuine break is a real find, not a stamping chore.

A vanished or moved REF file is a PROMPT TO RE-READ the entry, never on its own
the verdict that the entry is dead. The same missing-file signal has two
opposite causes, and only reading the entry's CONCLUSION tells them apart:
- CONFIRMED — the entry's remedy SHIPPED, so the dead path is a historical
  citation inside a still-true invariant (often the entry already records its
  own retirement inline, e.g. "Status: IMPLEMENTED"). Leave it — the catalogue
  is working, and many entries self-update this way.
- INVERTED — a later change reversed the entry's premise, so its conclusion is
  dead. SUPERSEDE it: add a dated note grounded in the commit/file that inverted
  it, KEEP the historical body (it records why the entry existed — Chesterton),
  and do NOT stamp VALIDATED. A superseded entry is fixed, not still-true.
Falsely superseding a live entry is worse than missing one: a SUPERSEDED banner
retires guidance, and nobody re-checks a retired entry. So verify each
missing-file hit against the source INDEPENDENTLY of the probe that surfaced it
— a sloppy file-existence sweep manufactures phantom "gone" hits (an ordered
regex alternation once matched `.tsx` as `.ts`, faking ~80). And the true
supersessions cluster in FATALITY / ORGANIZATIONAL-HEALTH / focus entries: they
rot silently because nothing re-reads them once their fix lands — a frozen
diagnosis then reads as today's assessment. The re-read is the whole point.
</step>

<step name="5_stamp">
Stamp only what you re-confirmed. Add or update the entry's field:

  **VALIDATED:** <sha> <YYYY-MM-DD> — <what you re-confirmed, concretely>

- <sha> is the TRUNK sha (default-branch HEAD), stamped AFTER any merge — never
  a branch sha. A squash-merge orphans a branch sha (H17): it resolves on your
  machine and dangles in every fresh clone, silently downgrading the anchor.
- Lead the field with the sha so the computer's anchor resolver reads it first.
- The note re-confirms the claim ("symbol X present, suite Y green"), it does not
  just restate the fix. Also fix any content that genuinely drifted (a stale
  count, a resolved caveat) — re-validation is not only a sha bump.
- Never auto-generate a stamp for an entry you did not read the code for. The
  hook flags; you update.
</step>

<step name="6_verify">
Re-run the report and verify the flip PER-ENTRY, not by summary counts (a count
can move the right way for the wrong reason). Confirm exactly the scoped entries
flipped to 🟢 `VALIDATED@<trunk-sha>` and NOTHING ELSE changed. If an entry you
did not touch changed verdict, stop and find out why before persisting.

When you pair before/after rows by id, key the join on **(id, kind)** — the second
column the report prints (`invariant` / `error` / `lifecycle` / `focus` /
`alignment` / `boundary` / `addendum`). Two rows may legitimately share an id:
- a dharana `### <ID>` alignment or boundary cross-ref REUSES a vyapti `## <ID>`
  invariant's id (deliberate span-tracking, not a duplicate) — kinds `invariant`
  vs `alignment`/`boundary` (#79);
- a dated `### <ID> — ADDENDUM` amends the `## <ID>` entry above it in any other
  catalogue — kinds `error`/`invariant`/`lifecycle` vs `addendum` (#85).
Neither is a duplicate id to renumber (that would break the link and violate the
no-reuse rule). A join on id alone pairs the parent's "before" against the
cross-ref's "after" and manufactures a spurious flip — read once as "duplicate
ids". Key on (id, kind) and the rows stay in separate buckets.

Note a level-3 heading is NOT an addendum just by being level 3 — whole catalogues
author every primary entry at level 3. It is an addendum only when a level-2
heading in the same file claims the same id.
</step>

<step name="7_persist">
Persist durably (V5 — uncommitted knowledge doesn't exist). Catalogue files live
under `~/.anvideck` → they reach the anvi_artifacts remote via commit + push.
The store's checkpoint hook auto-commits + pushes on Stop; confirm the changes
are committed AND pushed (`git -C ~/.anvideck status -sb`; local == origin).
Rich rationale belongs in the entry's VALIDATED note, not the commit message.
Probes stayed in a scratch dir — verify nothing stray landed under `.anvi/`.
</step>

</process>

<guardrails>
- The hook FLAGS; the session agent UPDATES. Never auto-rewrite a body and never
  auto-bump VALIDATED on bare drift — an auto-stamped green is the false
  confidence the gate exists to kill.
- Re-validate organically, in coherent subsystem batches — not a blind sweep.
- ⚪ GRAY entries (no computable REF) are not defects and cannot be stamped via
  this mechanism; 🔵 REFERENCE entries are an upstream-version question, not drift.
- anvi is PUBLIC: no catalogue IDs in any outward-facing content (commits, PRs,
  issues, source comments) — V6. The catalogue files themselves DO carry IDs.
</guardrails>

<success_criteria>
- [ ] Freshness report run and read per-entry (not just the summary)
- [ ] A coherent, re-confirmable batch chosen; entries left for later named explicitly
- [ ] Each stamped entry re-confirmed against current code AND observed (tests run)
- [ ] Any vanished/moved REF adjudicated confirmed-vs-inverted before acting; a
      superseded entry annotated (dated note, historical body kept), not stamped
- [ ] VALIDATED stamped at the trunk sha (post-merge), leading the field, with a
      concrete re-confirmation note
- [ ] Flip verified per-entry (not by summary counts); no untouched entry changed
- [ ] Catalogue changes committed + pushed to anvi_artifacts; no stray probe under .anvi/
</success_criteria>
