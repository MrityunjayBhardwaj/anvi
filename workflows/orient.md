<purpose>
Single-command situational awareness. Combines compass (where am I, what lens),
landscape (known/unknown/assumed), direction (deep/wide/stop), and right questions.

This is the HUD. Run it anytime to orient before acting.
</purpose>

<core_principle>
**Before moving, know where you stand.**

Most wasted effort comes from acting without orientation:
- Going deep on something you should have researched first
- Going wide when the answer is in the code in front of you
- Assuming something you should have verified
- Investigating something that's already known in the catalogues

Orient first. Then act with clarity.
</core_principle>

<process>

<step name="live_state">
**What has changed while I was not looking?**

This runs FIRST, and it is not optional. `PROJECT_MANAGEMENT.md` §11 ① is explicit
about why: *concurrent sessions are real, and a handoff note froze when it was written.*
Every source below is live; none of them is a note.

```bash
git branch --show-current                 # which branch is this tree actually on?
git status --porcelain                    # uncommitted work, including someone else's
```

Both list reads below are capped, and `gh` says nothing when a cap is reached — a
truncated list is byte-for-byte the shape of a complete one. Neither command publishes a
total, so **the limit itself is the instrument.** Fewer rows than you allowed is the
source's own proof that you have all of them; exactly as many as you allowed means the
list may be longer, and the only honest count is then *at least* N. The constant is a
ceiling on what you are willing to read, never a claim about how much exists — which is
why raising it is not the fix, and reporting the comparison is:

```bash
LIMIT=400   # a ceiling, not an expectation — the count= line says if it was reached

gh pr list --state open --limit "$LIMIT" --json number,title,headRefName \
  --jq '"count=\(length)", (.[] | "#\(.number) \(.headRefName) — \(.title)")'

gh issue list --state open --limit "$LIMIT" --json number,title \
  --jq '"count=\(length)", (.[] | "#\(.number) \(.title)")'
```

If either `count=` equals `$LIMIT` the read hit its ceiling: report it as "at least N"
and say the read was short. Any count below the ceiling is complete.

Read the board last, because it is the surface a human is most likely to have moved.
**Derive its number from the repository — never paste one.** A board is linked to its
repo (§10), so the repo can be asked which board is its own; a number carried over from
a previous session's notes goes stale silently and cannot be told from a correct one:

```bash
read -r OWNER REPO_NAME <<<"$(gh repo view --json owner,name \
  --jq '.owner.login + " " + .name')"

BOARD=$(gh api graphql -f owner="$OWNER" -f name="$REPO_NAME" -f query='
  query($owner:String!,$name:String!){
    repository(owner:$owner,name:$name){
      projectsV2(first:10){ nodes { number title } }
    }
  }' --jq '.data.repository.projectsV2.nodes[0].number')

gh project item-list "$BOARD" --owner "$OWNER" --limit 400 --format json \
  --jq '"seen=\(.items|length) total=\(.totalCount)",
        (.items|group_by(.status)[]|"\(.[0].status // "no status")=\(length)")'
```

The board needs no ceiling comparison, because unlike the two lists above it publishes
its own denominator: `--format json` returns `{items, totalCount}`, and `totalCount` is
the board's true size **whatever limit was asked for** — at `--limit 5` on a 162-item
board it still reads 162. So `seen` against `total` settles it outright, and a short read
announces itself. Quote both numbers; `seen < total` means the status counts underneath
are a sample, not a census, and they will look entirely plausible while being wrong.

If the repo has no linked board, `$BOARD` is empty — report that, do not guess a number.

Projection is one-way (§10, and invariant 8). The board is **read** here and never
written back from working state.

If `gh` is unavailable, unauthenticated, or the repo has no board, say so in the output
rather than omitting the line. A source that silently reports nothing is
indistinguishable from a source that reports "nothing to report" — and only one of those
is information. A source that silently reports *some* is the same defect in the
direction that reads as healthy, so every count above travels with the denominator that
says whether it is the whole of anything.

Output:
```
Branch:  {branch} {clean | N uncommitted}
PRs:     {open PRs, or "none"} {"(at least — read hit its ceiling)" if it did}
Issues:  {count} open {"(at least — read hit its ceiling)" if it did} — {the ones touching current work}
Board:   {counts by status} — {seen} of {total}, or "unavailable: {reason}"
```
</step>

<step name="position">
**Where am I?**

Read current context to determine position:

The planning tree's location is **resolved, never spelled** (invariant 2) — a project
on the legacy layout keeps its documents in `.planning/`, and a spelled path silently
misses every one of them:

```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"
echo "$PM"                                     # the value the steps below use
```

```
Sources (check in order):
1. $ARGUMENTS — user specified a focus area
2. $PM/STATE.md — current phase, plan, task
3. $PM/debug/*.md — active debug sessions
4. $PM/.continue-here.md — resuming from pause (written by /anvi:pause-work
   through the same resolver, so read it through the resolver too)
5. Live state from the step above — branch, PRs, issues, board
6. git log --oneline -3 — recent activity
7. Current conversation context — what we've been discussing
```

Sources 2–4 are frequently absent, and that is a normal state rather than an error: a
project that has never run a phase has no `STATE.md`. Absent is not the same as unread —
if the resolver announced a legacy tree, say which tree was consulted.

Output:
```
Position: {Phase N, Plan M, Task K} or {debugging X} or {exploring Y}
Activity: {debugging | designing | executing | reviewing | exploring | stuck}
```
</step>

<step name="lens_compass">
**What lens am I looking through?**

Based on activity, determine lens state:

```
Active:   {DIAGNOSE | DESIGN | REVIEW | exploring (no lens dominant)}
Sister:   {what feeds understanding — brief}
Opposing: {what challenges current view — brief}
Recover:  {dormant | watching | ⚠ ACTIVE}
```

If recover signals detected (2+ failed attempts, cascade, frustration):
```
⚠ RECOVER ACTIVE — stop, compress, revert before continuing
```
</step>

<step name="grounding_status">
**How grounded are the catalogues?**

Check the three-layer grounding chain: Catalogue entry → Ground Truth doc → source code.

```
Sources (check in order):
1. .anvi/*.md — scan entries for **REF:** fields
2. ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md — list existing Ground Truth docs
3. package.json / dependency manifests — check versions against Ground Truth doc headers
```

Output:
```
 ── Grounding ──────────────────────────────────
 Catalogue entries with REFs: {X}/{Y} ({N}%)
 Ground Truth docs: {list of GROUND_TRUTH_*.md files, or "none"}
 Stale: {docs where dependency version changed since doc was generated}
 Ungrounded hotspots: {dharana boundaries with 0 grounded entries}
```

If grounding is low (<50%) at a boundary being worked on: flag it in Right Questions.
If a Ground Truth doc is stale: flag it in ASSUMED with "Ground Truth may be outdated."
</step>

<step name="landscape">
**What's the terrain?**

Scan for what's known, unknown, and assumed about the current work:

**KNOWN** — things directly observed or confirmed:
- Code read and understood
- Tests run and results seen
- Catalogue entries that apply (hetvabhasa matches, vyapti constraints, krama sequences)
- Decisions already made (CONTEXT.md)

**UNKNOWN** — things not yet investigated:
- Files not read
- APIs not checked
- Behaviors not tested
- Boundaries not scanned

**ASSUMED** — things believed but not verified:
- "This library probably works like X"
- "This function should return Y"
- "The framework handles Z"
- Any knowledge from training data not confirmed against current code/docs

Scan sources:
- `.anvi/hetvabhasa.md` — known error patterns (mark as KNOWN)
- `.anvi/vyapti.md` — known invariants (mark as KNOWN)
- `.anvi/krama.md` — known lifecycles (mark as KNOWN)
- Recent tool calls — what files were read (KNOWN) vs referenced but not read (UNKNOWN)
- Conversation context — what was stated as fact vs what was hypothesized (ASSUMED)
</step>

<step name="direction">
**Deep, wide, or stop?**

For each UNKNOWN and ASSUMED item, determine the right action:

**GO DEEP** — investigate in the codebase (read, trace, log, test):
- When the answer is likely in the code already
- When you need to understand execution flow
- When you need to verify an assumption about behavior
- Tools: Read, Grep, Bash (run tests/scripts)

**GO WIDE** — research externally (docs, web, community):
- When the question is about a library/framework you haven't used
- When the answer requires domain knowledge outside the codebase
- When official docs would resolve an assumption faster than code-reading
- When something changed recently (new version, deprecation)
- Tools: WebSearch, WebFetch, Context7

**STOP** — don't guess, don't infer:
- When the question involves security (don't guess at crypto, auth, CORS)
- When the question involves data integrity (don't assume DB behavior)
- When two ASSUMED items contradict each other (resolve before proceeding)
- When you've been at this for 3+ attempts (trigger recover)

**SKIP** — this doesn't matter right now:
- When the unknown is out of scope for the current task
- When the assumed item has no impact on current work
- When investigating would be pure curiosity, not progress

Decision heuristic:
```
Is the answer in the codebase?
├─ YES → GO DEEP (read, trace, test)
├─ MAYBE → GO DEEP first (2-3 file reads), then WIDE if not found
└─ NO → GO WIDE (docs, search)

Is this a safety/security question?
├─ YES → STOP (don't guess, look it up)
└─ NO → continue

Have I tried this before?
├─ 2+ times → STOP (recover)
└─ NO → proceed
```
</step>

<step name="right_questions">
**What should I be asking?**

From the landscape, generate 3-5 questions ranked by impact:

Priority:
1. Questions about ASSUMED items that could change the approach if wrong
2. Questions about UNKNOWN items blocking progress
3. Questions from the active lens chain
4. Questions from catalogue pattern matches

Format:
```
1. "{question}"
   Impact: {what changes if the answer is different than expected}
   Direction: {DEEP | WIDE | STOP}
```
</step>

<step name="render">
**Output the orientation map:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ORIENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Position:  {where you are}
 Activity:  {what you're doing}
 Lens:      {active} + {sister}     Recover: {status}

 ── Live state ─────────────────────────────────

 Branch:    {branch} {clean | N uncommitted}
 PRs:       {open PRs, or "none"} {at least, if the read hit its ceiling}
 Issues:    {count} open {at least, if the read hit its ceiling} — {relevant ones}
 Board:     {counts by status} — {seen} of {total}, or "unavailable: {reason}"
 Tree:      {resolved planning root, and whether it is the legacy one}

 ── Grounding ─────────────────────────────────

 Catalogue entries with REFs: {X}/{Y} ({N}%)
 Ground Truth docs: {list or "none"}
 Stale: {stale docs or "none"}
 Ungrounded hotspots: {boundaries or "none"}

 ── Landscape ──────────────────────────────────────

 KNOWN:
   {things directly observed/confirmed}
   {catalogue matches}

 UNKNOWN:
   {things not yet investigated}

 ASSUMED: ⚠
   {things believed but not verified}

 ── Direction ──────────────────────────────────────

 → DEEP: {what to investigate in the code}
 → WIDE: {what to research externally}
 ■ STOP: {what not to guess at}
 ○ SKIP: {what doesn't matter right now}

 ── Right Questions ────────────────────────────────

 1. "{most impactful question}"
    {what changes if wrong} → {DEEP|WIDE|STOP}

 2. "{second question}"
    {what changes if wrong} → {DEEP|WIDE|STOP}

 3. "{third question}"
    {what changes if wrong} → {DEEP|WIDE|STOP}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
</step>

</process>

<examples>

**Mid-debugging (canvas overflow):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ORIENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Position:  Debugging — canvas overflows container
 Activity:  debugging (1st attempt)
 Lens:      DIAGNOSE + DESIGN (sister)   Recover: dormant

 ── Live state ─────────────────────────────────

 Branch:    fix/canvas-overflow — 2 uncommitted
 PRs:       none
 Issues:    3 open — #41 touches this file
 Board:     Todo 5 · In Progress 1 · Done 12 — 18 of 18
 Tree:      .anvi/project_management

 ── Landscape ──────────────────────────────────────

 KNOWN:
   Canvas is 400x300, container is 150px tall
   RenderEngine constructor uses setTimeout for setup
   H-03: "framework defers initialization"

 UNKNOWN:
   What resizeCanvas does when canvas is null
   Whether setup() respects container dimensions

 ASSUMED: ⚠
   resizeCanvas should work after constructor returns
   ← THIS IS THE BUG (constructor defers, resize runs too early)

 ── Direction ──────────────────────────────────────

 → DEEP: read resizeCanvas guard clause (line 61)
 → DEEP: trace what this.canvas is at call time
 ○ SKIP: CSS styling (red herring — this is code, not style)

 ── Right Questions ────────────────────────────────

 1. "What does resizeCanvas do when this.canvas is null?"
    If it silently returns → explains the entire bug → DEEP

 2. "Who decides the canvas dimensions — sketch or container?"
    If sketch → ownership problem beyond timing → DEEP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Starting a new phase (auth middleware):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ORIENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Position:  Phase 3, Plan 1 — JWT auth middleware
 Activity:  executing
 Lens:      DESIGN (active)              Recover: dormant

 ── Live state ─────────────────────────────────

 Branch:    feat/jwt-auth — clean
 PRs:       #58 open (another session)
 Issues:    7 open — #52 is this phase
 Board:     unavailable: gh not authenticated
 Tree:      .planning (legacy — migrate with `anvi update`)

 ── Landscape ──────────────────────────────────────

 KNOWN:
   Route structure (read src/routes/)
   Express middleware pattern in this project
   V-02: "all API routes under /api/ prefix"

 UNKNOWN:
   jose library API for token verification
   Refresh token rotation best practices
   Cookie security flags for this deployment

 ASSUMED: ⚠
   jose handles RS256 by default
   httpOnly cookies are sufficient for refresh tokens

 ── Direction ──────────────────────────────────────

 → DEEP: route structure — trace existing middleware chain
 → WIDE: jose API — fetch docs before implementing
 → WIDE: refresh rotation — check OWASP guidance
 ■ STOP: cookie flags — security question, don't guess

 ── Right Questions ────────────────────────────────

 1. "Does jose verify RS256 by default or require explicit config?"
    If requires config → wrong implementation → WIDE (check docs)

 2. "What happens if refresh token is stolen?"
    Determines rotation strategy → WIDE (OWASP)

 3. "Who owns session state after token refresh?"
    Ambiguous ownership = bugs later → DEEP (trace current flow)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Stuck after 2 failed attempts:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ORIENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Position:  Debugging — WebSocket disconnect on deploy
 Activity:  debugging (3rd attempt)
 Lens:      DIAGNOSE                     Recover: ⚠ ACTIVE

 ── Live state ─────────────────────────────────

 Branch:    main — clean
 PRs:       none
 Issues:    2 open
 Board:     Todo 3 · In Progress 0 · Done 9 — 12 of 12
 Tree:      .anvi/project_management

 ⚠ RECOVER TRIGGERED — 3 failed attempts
   Attempt 1: increased timeout → still disconnects
   Attempt 2: added reconnect logic → masks the problem
   Attempt 3: changed transport → same behavior

   All three are workarounds. The framing is wrong.
   STOP → COMPRESS → REVERT → RE-ENTER FRESH

 ── Landscape ──────────────────────────────────────

 KNOWN:
   Works locally, fails on deploy
   Disconnect happens at exactly 60s

 UNKNOWN:
   What sits between client and server in production
   Whether a proxy/load balancer terminates idle connections

 ASSUMED: ⚠
   "The connection goes directly to the server"
   ← LIKELY WRONG (60s = default proxy timeout)

 ── Direction ──────────────────────────────────────

 → WIDE: check deployment infra — is there a proxy? (nginx, cloudflare)
 ■ STOP: no more code changes until infra is understood
 ○ SKIP: client-side reconnect (treating symptom, not cause)

 ── Right Questions ────────────────────────────────

 1. "What infrastructure sits between client and server?"
    If proxy with 60s idle timeout → explains everything → WIDE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

</examples>

<success_criteria>
- [ ] Live state read FIRST: branch, open PRs, open issues, board (§11 ①)
- [ ] An unavailable live source is REPORTED as unavailable, never omitted
- [ ] Planning paths resolved via `planning-root`, never spelled
- [ ] Position detected from context
- [ ] Active lens and recover status shown
- [ ] Grounding status checked (REF coverage, staleness, hotspots)
- [ ] Landscape mapped: KNOWN, UNKNOWN, ASSUMED (with ⚠)
- [ ] Direction given for each item: DEEP, WIDE, STOP, or SKIP
- [ ] Decision heuristic applied (codebase? safety? tried before?)
- [ ] 3-5 right questions with impact and direction
- [ ] Recover signals checked and surfaced if active
- [ ] No Sanskrit terms in output
</success_criteria>
