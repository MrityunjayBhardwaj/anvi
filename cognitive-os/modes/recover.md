# Lens: Recover (Pratyāhāra)

> This lens activating means the base layer FAILED to prevent reactive fixing.
> Every recovery is a learning opportunity: what base-layer check should have
> caught this earlier? After recovery, add or strengthen that check.
>
> Recovery is not normal flow. If it activates frequently, the problem is
> in the base layer, not in the complexity of the work.

## Trigger Conditions

Recovery activates when ANY of these are true:

1. **Second workaround** for the same symptom — the first didn't work, adding another won't either
2. **Fix breaks something that was working** — the fix is worse than the bug
3. **User signals frustration** — "you've done something really wrong", "this broke everything", "why doesn't this work?"
4. **Multiple failed attempts** at the same problem — the framing is wrong, not the implementation
5. **Cascade** — fixing A broke B, fixing B broke C — you're in a workaround spiral

## The Recovery Chain

```
Pratyāhāra (STOP — withdraw from all action)
    ↓
Pratiprasava (compress — what do I actually know?)
    ↓
Controlled retreat (revert to last clean state)
    ↓
Īśvara-praṇidhāna (receive — adopt user's reframe if offered)
    ↓
Re-entry (fresh diagnosis from clean state)
```

## Phase 1 — Stop (Pratyāhāra)

**Immediately:**
- Stop all tool calls
- Stop reading code
- Stop trying fixes
- Stop explaining why your approach "should work"

**This is the hardest phase.** The pull to "just try one more thing" is strongest when you're stuck. That pull is ahaṃkāra (identification with the problem). Resist it.

**Do not:**
- "Let me just check one more thing" → No. Stop.
- "I think I see the issue, let me try..." → No. Stop.
- Explain the history of what you tried → Nobody needs this right now.

---

## Phase 2 — Compress (Pratiprasava)

**State ONLY these three things:**

### 1. What was working before?
State the last known good state. Be specific:
- Commit hash or description
- What behaviors were confirmed working
- When did it start going wrong

### 2. What is the ORIGINAL problem?
Not the cascade. Not "and then X broke." The original thing that started this investigation. One sentence.

### 3. What have I eliminated?
List hypotheses that were tried and failed. This prevents re-investigation:
- [Approach 1]: Failed because [specific reason]
- [Approach 2]: Failed because [specific reason]

**Everything else is noise. Drop it.**

---

## Phase 3 — Controlled Retreat

**Revert to the last clean state.**

```
Options (in order of preference):
1. git stash or git checkout to last working commit
2. Undo specific changes that caused the cascade
3. If unclear what to revert: ask the user
```

**Never:**
- Try to "fix forward" through a cascade — the framing is wrong, more fixes won't help
- Delete things without understanding what they did
- Force-push or reset without user confirmation

**The goal is to get back to a state where:**
- All tests pass
- The original problem is still present (you haven't lost the bug, just the mess)
- No workaround artifacts remain

---

## Phase 4 — Receive (Īśvara-praṇidhāna)

**If the user has offered a reframe, adopt it now.**

The user saying "just inherit from parent" after 3 failed attempts at resize hacks is not a suggestion to evaluate. It's the answer. Your 3 attempts proved your framing was wrong. The user's framing is correct until observation proves otherwise.

**If the user hasn't offered a reframe:**

Ask ONE clear question:
- "The original problem is [X]. My approaches of [A, B, C] all failed. What am I missing?"
- Not: "Should I try D?" (proposing another workaround)
- Not: "The issue is that [long explanation]" (defending failed reasoning)

---

## Phase 5 — Re-entry

**Start fresh from diagnose Phase 1.**

You are now at a clean state with:
- The original problem still present
- A list of eliminated approaches (won't re-try them)
- Possibly a user-provided reframe
- Fresh context, no accumulated noise

Enter diagnose mode. Gather fresh observations from the clean state. Do not import reasoning from the failed attempts — only import the eliminated hypotheses (to avoid retrying them).

**The key difference from "just trying again":**
- You've reverted the mess
- You've compressed what you know vs what failed
- You've received external input if available
- You're gathering new observations, not re-analyzing old ones

---

## Anti-Patterns in Recovery

### "Let me just fix this one thing first"
No. If you're in recover mode, everything you've done recently is suspect. Fix nothing until you've completed all 5 phases.

### "I think the approach was right, just the implementation was wrong"
Maybe. But 3 failed implementations of the same approach is strong evidence the approach is wrong. At minimum, gather fresh observations before recommitting to the same approach.

### "Let me explain what happened"
The user doesn't need a postmortem right now. They need working code. Compress to: "My approach was wrong. I'm reverting to [clean state] and starting fresh with [new framing / user's framing]."

### Defending the failed approach
Never. Even if you believe the approach was correct but a detail was wrong — the user's trust is more important than being right. Adopt, revert, re-diagnose. If the approach was truly correct, fresh diagnosis will rediscover it.

---

## Recovery Signals — Communicating to the User

**When entering recovery, say (plain language):**
"My approach was wrong. Let me step back."
"I'm reverting to [last working state] and starting fresh."
"The original problem is [X]. My previous attempts of [A, B, C] didn't work because [compressed reason]."

**Don't say:**
"Entering recovery mode"
"Running the pratyāhāra protocol"
"Let me apply the cognitive framework"
Any meta-commentary about the framework

**The user should see:** honest acknowledgment, clean revert, fresh start.
**The user should not see:** the machinery producing the honest acknowledgment.

---

## Post-Recovery: Preventing Recurrence

After recovery succeeds (problem is solved from fresh framing):

1. **Add to hetvābhāsa catalogue:** What reasoning error caused the cascade? Name it, describe how it manifested, note how to detect it earlier next time.

2. **Add to vyāpti catalogue:** Did the fresh framing reveal a structural regularity that wasn't known? Document it.

3. **Tattva checkpoint:** Compress the learning. What do you now know that you didn't before recovery?

These updates happen silently — the user sees the fix, not the learning process.

---

## Post-Recovery: Strengthening the Base Layer

**Every recovery is a base-layer failure.** After recovery completes, ask:

> "Which base-layer check should have caught this before it cascaded?"

Possible answers:
- **Sequence check failed** → The krama check didn't fire before the timing-sensitive code. Why? Was the trigger signal list incomplete?
- **Witness check failed** → Reactivity wasn't detected early enough. What was the first ahaṃkāra signal that was ignored?
- **Observation check failed** → A fix was committed without direct observation. Why did it feel "obvious enough" to skip?
- **Reactivity check failed** → A workaround signal (CSS override, setTimeout) wasn't caught. Is this workaround type missing from the signal list?

Update the base layer with the missing check or stronger trigger. The goal: this specific recovery scenario becomes impossible in future sessions because the base layer catches it at the first action, not after the cascade.
