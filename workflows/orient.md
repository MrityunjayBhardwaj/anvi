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

<step name="position">
**Where am I?**

Read current context to determine position:

```
Sources (check in order):
1. $ARGUMENTS — user specified a focus area
2. .planning/STATE.md — current phase, plan, task
3. .planning/debug/*.md — active debug sessions
4. .planning/.continue-here.md — resuming from pause
5. git log --oneline -3 — recent activity
6. Current conversation context — what we've been discussing
```

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
- [ ] Position detected from context
- [ ] Active lens and recover status shown
- [ ] Landscape mapped: KNOWN, UNKNOWN, ASSUMED (with ⚠)
- [ ] Direction given for each item: DEEP, WIDE, STOP, or SKIP
- [ ] Decision heuristic applied (codebase? safety? tried before?)
- [ ] 3-5 right questions with impact and direction
- [ ] Recover signals checked and surfaced if active
- [ ] No Sanskrit terms in output
</success_criteria>
