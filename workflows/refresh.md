<purpose>
Keep the catalogue-health series alive, and read what moved.

The report's product is a DIFF against the previous snapshot, which makes the
series self-sustaining only while snapshots keep being taken. Skipping runs does
not merely pause it — the next diff widens. Thirteen lines a week is a thing
someone reads; a quarter's worth in one wall is the wallpaper this report was
built to replace.

This is the `--fleet` MODE of `/anvi:currency`, not a command of its own, and
that is deliberate. It is one question — "is the catalogue still real?" — asked
at two scopes, and the fleet report is built ON that gate: it shells out to
`currency-report.js --json` rather than computing verdicts of its own. Two
instruments answering one question is how they come to disagree, and two
commands answering it is the same failure one layer up.

  /anvi:currency --fleet   every project — what MOVED since last time. Reports only.
  /anvi:currency           one project — the worklist, re-confirmation, stamping.

So this mode ends by handing back, not by acting.

Full prose spec: ENFORCE.md §Currency. The instrument is
`scripts/catalogue-health.js`, which shells out to `currency-report.js --json`
rather than recomputing verdicts, for the same reason stated above.
</purpose>

<inputs>
$ARGUMENTS — optional.
- `preview` → run WITHOUT `--write`: see the diff, leave the series where it is.
              Use when you only want to look; it does not advance the series, so
              the next real run still diffs against the older snapshot.
- a directory → use it as the snapshot directory instead of the store default.
Absent → take the snapshot (the normal case, and what keeps the series alive).
</inputs>

<paths>
STORE=~/.anvideck                                  # centralized store (remote: anvi_artifacts)
SNAPSHOTS=<store>/projects/anvi/instances/health-<UTC-date>.json
TOOL=scripts/catalogue-health.js                   # installed at ~/.claude/anvi/scripts/

The snapshot lands in the store, which the Stop checkpoint hook already commits
and pushes. Do NOT commit it by hand — a second writer to the same repo buys
durability only in the window where no session is opened, and pays for it with
two processes committing at once.
</paths>

<cost>
About four minutes: it runs the currency machinery over every project's live
working copy (most recently 256s for 18 projects and 4539 entries). Say so before
starting if the user did not ask for it directly — this is not a command to fire
speculatively mid-task.
</cost>

<process>

<step name="1_run">
  node scripts/catalogue-health.js --write        # normal: extends the series
  node scripts/catalogue-health.js                # `preview`: reports, writes nothing

Run it in session context. It reads every project's working copy, and that access
is inherited from the session — a background or scheduled run does NOT have it
(see the measurement in the closed scheduling issue). If it ever reports EPERM
against a working copy, that is the cause; it is not a bug in the tool.
</step>

<step name="2_read_the_changes">
The CHANGED block is the product. Read it per project, and per entry:

  +  a new entry, with the verdict it arrived at
  ~  a verdict that MOVED, with both ends (e.g. RED → YELLOW)

A `~` is the interesting one. A new entry is usually just a harvest you already
know about; a moved verdict means code shifted under a claim that was already
written down. Report the `~` lines first, and say plainly when everything was `+`
— a diff made entirely of new entries told you nothing you did not already know,
and saying so is more useful than presenting it as a finding.
</step>

<step name="3_read_the_silences">
Four outcomes would otherwise all render as a short clean report, and they mean
different things. Do not skim past them:

- nothing changed                     → the series is healthy and quiet. One line.
- the previous snapshot was unreadable → this run has NO baseline; its "changes"
                                         are not a diff. Say so.
- a project could not be measured      → it is named under NOT MEASURED. That
                                         project is absent from every count above,
                                         so no total covers the fleet.
- the store could not be enumerated    → the tool refuses with a non-zero exit
                                         rather than printing zeros. Believe the
                                         refusal; do not re-run hoping for numbers.

Quote the NOT MEASURED list whenever it is non-empty, in the same breath as any
total you quote. A count without its denominator is the failure this whole
subsystem exists to prevent.
</step>

<step name="4_levels_as_context">
Report the levels beneath the changes, never as the headline. And when quoting
the drifted count, say what it IS: drift is the permanent background level here,
because catalogue entries overwhelmingly cite the project's OWN files, which
ordinary work moves. A large drifted number is a measure of how much has been
coded, not a defect count and not a to-do list.
</step>

<step name="5_hand_off">
Name the ONE project most worth acting on, and hand off:

  /anvi:currency [project-dir]

Choose by what MOVED, not by what is largest — a project with three `~`
transitions has something to look at; a project with the biggest drifted count
probably just has the most code. Then stop. Re-confirmation and stamping belong
to that command, where each entry is checked against current code first.

Never stamp anything from here. An unearned green is the false confidence the
currency gate exists to kill.
</step>

</process>

<guardrails>
- Reports only. No pruning, no rewriting, no compaction, no stamping. Deleting
  knowledge stays human-invoked: git history is the only archive, so an entry
  removed unattended is recoverable only by someone who already knows to look.
- Do not commit the snapshot by hand; the checkpoint hook does it.
- Do not run this speculatively mid-task. It costs about four minutes.
</guardrails>
