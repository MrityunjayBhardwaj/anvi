# Rules — judgements at the moment of deciding

Each rule names a moment you will recognise and the move to make there. They were
distilled from lessons this framework recorded the hard way. Lessons tied to specific
code arrive when you edit that code; mistakes a reminder did not prevent are refused
by hooks instead. These are the rest: judgements only you can make, loaded always.

## Evidence and figures

- WHEN acting on a figure or claim from a note, issue or doc → re-run its instrument on the live system first; when writing one, put instrument and date beside it
- WHEN measuring what a program counts or decides → run the shipped command and copy the number from its output; never reimplement its logic in a probe
- WHEN a documented count differs from your measurement by one → derive it from the selection the runtime actually uses before calling the doc wrong
- WHEN printing a count or rate → name unit and population, make parts sum to the total, say 'at least N' at a cap, print a bound (<0.1%) not 0.0
- WHEN a figure depends on configuration or time → print the config identity and window beside it; compare or subtract figures only when both match
- WHEN a report states a derived fact only when unusual → state it every time, including one and zero, so silence cannot read as safety
- WHEN a rate licenses a decision → state its denominator, scope and where it was measured; a pattern-detector rate is only 'of what these patterns see'
- WHEN a metric moves exactly as hoped → check one real instance per emitted state against its definition before trusting the count
- WHEN a check or metric is named for a property → name the predicate it actually runs and what its output cites; report parts separately; distrust ~100%
- WHEN a corpus check or control gives uniform or decimal-identical figures → confirm the statistic depends on the pairing; run a scrambled-pairing control
- WHEN a probe or search returns zero, absent or uniform → state its predicate, rerun on a known-present case, check shadowing, then cross-check by content
- WHEN a matcher's flagged list is short → read every flagged row before changing the rule; pin a must-resolve and a must-not-resolve control
- WHEN two inventories agree by count → diff the sets, and count the file that carries the content, not its container directory
- WHEN computing any ratio from a paged API read → assert the rows returned equal the total count before computing it
- WHEN a quoted finding is about to license a decision → re-read its source to the end of the paragraph, qualifiers included
- WHEN writing a coverage claim ('across the repo', 'not observed') → name the population and denominator measured and re-read the target
- WHEN a claim is cleared by evidence → require the evidence kind it needs: behaviour needs a run and its output; reading licenses structure only
- WHEN a note says something cannot be observed → read it as 'not with that method' and try another vantage, such as spawning a session
- WHEN about to record a claim as unanchorable or uncheckable → name the comparison it makes and check both sides before setting it aside
- WHEN stating how a failure behaves or how severe it is → run it with the input truly absent (env -u) and capture exit code and byte count
- WHEN reading a test run's result → capture the runner's own exit status apart from the tally; non-zero is a failure whatever the counts say
- WHEN several tests fail with the same error kind and near-equal durations → suspect the environment: check ps, compare per-file times, run each alone
- WHEN a setting seems ignored or the system keeps asserting its opposite → check the schema type, back up, diff after edit, observe the behaviour flip

## Checks that must be able to fail

- WHEN adding a check, metric or exemption → run the real runtime on an input that must fire it and one that must not; if no red is reachable it is not a check
- WHEN a test or run expects silence or absence → put the trigger in the fixture, add a case that must speak, and break the producer until it goes red
- WHEN a behavioural fix leaves the suite green → name the assertion that should redden, revert or mutate the changed line, and require that red
- WHEN a mutation comes back green → print its diff first; a zero-line or comment-only diff is a harness error, not a verdict on the code
- WHEN a mutation reads not witnessed → look for a second copy of the predicate or a weak fixture; add the input that separates them, never loosen the test
- WHEN a check or fix is confirmed on its motivating or real sample → build the hardest neighbouring input, where implementations would disagree, and run it
- WHEN hardening a guard's match → apply the same structural match to its override, allowlist or skip condition
- WHEN reordering or replacing a check → list inputs it answered first; restore its permissive answers as grant-only early returns; test the equal case
- WHEN a fix's condition names the file/project/site where the bug was found → guard on the causing condition, count the siblings, test at another site
- WHEN a feature gates on a derived label (kind/status/type) → key on the property's own shape and check its reach on the real corpus, not the pilot
- WHEN the right and wrong cases look identical except for intent → stop adding detector rules; print the derived fact for the author to compare

## Outcomes and what they print

- WHEN outcomes needing different actions share a message, token or exit code → split them; 'could not look' must never print as 'nothing found'
- WHEN a derivation gates a destructive action → list what each failure prints; each one that prints the permissive answer fails closed alone
- WHEN a tool turns a guess into a durable, believed artifact → build only from the precise part of the source; decline and say why rather than widen
- WHEN code silently compensates for a known upstream defect → count each compensation and print the count beside the results
- WHEN a lifecycle gap is found at one entry point → enumerate every door that creates the thing, check each, and derive the door set in a test
- WHEN writing a multi-step procedure → for each placeholder a step consumes, name the earlier step that produces it
- WHEN writing a durable reference into changing content → cite a symbol or heading that fails to resolve when moved, never a line number
- WHEN designing a non-blocking notice → trigger on a condition its advice turns off, and let readers record a wrong fire so dismissals are counted

## Code and shell

- WHEN deciding whether code uses a symbol → match on word boundaries, and prove use or non-use by running the path (stub it to fail), not by grep
- WHEN reading a field off an object you did not construct → print a real instance's keys first; name the field from the producer, not your need
- WHEN passing JSON or structured output between commands → read it from the process or a direct pipe; never echo a shell variable, use printf '%s'
- WHEN a value was just produced by a command in shared state → take it from that command's output, never from a second read of the shared state
- WHEN a tool runs git or reads cwd without an explicit target → ask 'copied elsewhere, would it fail or be wrong?'; assert the context is the subject
- WHEN testing an expression a host tool embeds (gh --jq, SQL, regex) → test through the host's engine and run the shipped command once
- WHEN fetching files with curl in bulk → use -f so failures write nothing, then sweep the output for implausibly small files
- WHEN a scripted sweep edits many sites → diff --numstat against intent, assert the old form is gone and the new one is well-formed and defined at every site
- WHEN moving where something lives → migrate every writer, incl. resolver-built paths, in one change, and observe each dependent mechanism still acts
- WHEN told a fix, job or automation works → cause its trigger end to end and observe the effect on the authoritative surface, not its registration

## Git and GitHub

- WHEN committing with a pathspec → git add new files first, and verify by asking the remote tree for the path, not whether the commit exists
- WHEN git add warns of an embedded git repository → rename the inner .git (don't delete), git rm --cached the gitlink, re-add as plain files
- WHEN a rebase or cherry-pick applies cleanly onto a moved base → check where the change landed against its intent, and run the consuming tool
- WHEN opening or merging PRs that touch the same files → base each on main from creation and check pairs with git merge-tree first
- WHEN a PR body carries or omits a closing keyword → re-score the PR against the issue's current asks, then read back closingIssuesReferences
- WHEN about to merge → grep the issue number and changed symbols repo-wide and fix every sentence the change made untrue, in the same commit
- WHEN a gh command creates an issue, PR or item → pass --repo explicitly and read the returned URL's repository before recording the number
- WHEN chaining outward writes (comment, close, board) → one per command with a state read-back; on failure read what landed before retrying
- WHEN about to delete a copy, worktree or clone → prove tracked, untracked and ignored content is in the survivor by content hash, then delete with approval
- WHEN several checkouts of a project exist → choose by .git, print pwd before each block, use absolute paths, and record which one you used
- WHEN publishing a page from a session → commit its source to the store and push; republish later by passing the original URL

## Keeping knowledge honest

- WHEN compressing into 'details in X' → write X first, grep that its heading and key tokens exist there, then cut
- WHEN a cited file, symbol or entry is gone or changed → read what it governed; treat it as drift to re-point, not proof the knowledge is dead
- WHEN a component looks dead, unwired or removable → search docs and issues for a deliberate disablement and state what gets worse without it
- WHEN scaling a small request into a mechanism → state in one sentence what breaks without it and check it is not already delivered elsewhere
- WHEN filing an incident under an existing entry → state its mechanism in one sentence; the entry's root cause must name it, not the circumstance
- WHEN deciding whether a lesson is general → count unrelated projects that recorded it independently; three or more ships, and record the count
- WHEN borrowing types or names from a system mid-repair → grep their coupling to the part being removed; adopt only separable pieces, record rejections
- WHEN a new command would answer an existing question at another scope → add an argument to the existing command instead of a new name
- WHEN weighing divergence from a vendored upstream → first check the upstream still exists and releases; an archived upstream makes drift cost zero

## Experiments and measurement

- WHEN scoring rules or a model on data you saw or repaired while writing them → fix a held-out split first and report both halves side by side
- WHEN a pre-registered threshold lies outside a probe's confidence interval → stop the full run and report the interval, not the point estimate
- WHEN a per-item screen admits items toward an aggregate limit → re-measure the ensemble on held-out data; never let the screen license shipping
- WHEN comparing treated against untreated subjects → put a subject in the treated arm only if delivery was recorded, never because it was eligible
- WHEN comparing two arms whose row counts differ → key the join on content, assert key uniqueness, and first diff one arm against itself
- WHEN running a model arm meant to carry no rules → isolate setting sources and verify with a quote probe both ways, using the exact runner flags
- WHEN building a replay to test if rules prevent a past mistake → keep the decisive facts discoverable, not shown, and check the ceiling on a few cases
- WHEN a validity check tells the checker the thing exists → it only measures findability; replace it with the property that voids a case, pre-run
- WHEN projecting cost or latency of model calls → run the same flags with an empty payload as baseline and quote measured medians
- WHEN counting from transcripts → match record structure and each tool's operated field, not prose, and sample the denominator
- WHEN a text search locates an incident by its lesson's words → confirm the hit is the mistaken step, and run a date-shifted control
- WHEN a verbatim-quote check says a quote is fabricated → normalise both sides through one function and print the longest matching prefix first
