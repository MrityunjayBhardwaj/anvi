# Provenance Check — guarding the project boundary on information intake

**Type:** Always-active base-layer check (Ānvīkṣikī cognitive OS)
**Status:** ADOPTED 2026-07-12 — folded into `cognitive-os/base-layer.md` (§ On Every Action, after the Grounding Check) and pointed to from `~/.claude/CLAUDE.md` (Detail specs). This file remains the full spec. Remaining (optional): dharana "project envelope" boundary per project (§5); PostToolUse provenance hook (§5).
**Origin:** 2026-07-12, Basher session. A cross-project contamination that every existing
check passed. Written at the user's request ("this should be by design in anvi").

---

## 1. The problem — the gap

The base layer grounds claims in **source** (Grounding Check: *"is this backed by real code, or am
I inferring?"*) and in **observation** (Lokāyata). Both silently assume a *single, implicit project
context*. But the tool surfaces the agent draws from are **not project-scoped**:

- **Account-wide clouds** — `Artifact(list)` returns every artifact the *account* ever published,
  across all projects; MCP servers, web fetch, and hosted galleries are account/workspace-wide.
- **The filesystem** — the file tools run with the user's full permissions; they are **not**
  sandboxed to the current repo. Sibling repos, home, and shared reference trees are all readable.
- **Recalled memory** — can name entities that belong to adjacent projects.

None of these carry an intrinsic "which project does this belong to" tag, and **no check asks the
question.** So when a surface returns something *plausible and internally coherent*, the agent
treats it as authoritative for the current project **without verifying its origin.**

The result is **cross-project contamination**: another project's roadmap, artifacts, vocabulary, or
file leaks in as if it were this project's ground truth.

**Why the existing checks miss it — the false green.** The contaminating datum is usually *real*: a
genuine published artifact, a genuine file on disk. So the **Grounding Check passes** ("it's backed
by a real source!") while the conclusion is still wrong. Grounding and Provenance are **different
axes**:

> **Grounding asks: "Is this real?"   Provenance asks: "Is this real *for THIS project*?"**

A perfectly grounded source *from the wrong project* is the trap. A claim must clear **both** gates —
source-real **and** source-belongs — before it is authoritative.

In the framework's own terms this is a **boundary** failure — the *project envelope* is a boundary
like any system boundary, and the framework already teaches that boundaries are where silent
failures hide (boundary-pair observation; domain-aligned abstractions). Dharana tracks system
boundaries *within* a project; nothing guards the **outer envelope** — the boundary between "this
project" and "everything else my tools can reach."

**The broad tool access is not the bug. Failing to tag the origin of what that access returns is.**

---

## 2. The instance (2026-07-12, Basher)

1. Working in **Basher** (a 3D procedural-video app). User asked: *"what's in the artifact?"*
2. Called `Artifact(list)` — an **account-wide** gallery. It returned 5 artifacts: two titled
   *"Visor…"*, three *"Stave…"*. **None were Basher's.**
3. **Without checking provenance**, I assumed the two newest ("Visor") were "the Basher artifact,"
   fetched them, and summarized them as Basher's.
4. Everything downstream inherited the error: I imported Visor's **VS.1–16 roadmap**, its **"Add
   animation / VS.5"** concept, and its **four-layer-IR thesis** into a Basher conversation — and
   built a mockup on that false basis.
5. Compounded when the user pointed me at `~/Documents/projects/MoGraph-DSL/.artifacts/
   visor-sharpening-map.md` — a **different repo**, freely readable. I read it correctly but had
   already fused the two projects.
6. Corrected only when the user said **"?? this is the basher project."**
7. Even the correction over-shot ("Visor is a *different* project") until I read Basher's own
   `VISOR.md` and found the true, nuanced relation: **Visor is a sister 2D product, thesis'd inside
   Basher, reusing Basher's substrate, prototyped in the MoGraph-DSL repo.** Had I checked
   provenance *and* the in-repo docs first, I'd have had that right from the start.

**The tell:** every artifact and file I cited was *real*. Grounding was green the whole way. The
missing gate was **provenance.**

---

## 3. The fix — a new always-active check

Add to `cognitive-os/base-layer.md`, under **On Every Action**, as the sibling of the Grounding
Check:

### Provenance Check
**Internal concept:** adhikaraṇa (Nyāya — the locus a property truly resides in)
**Plain language:** "Does this information belong to the project I'm working in — or just to my
account / machine?"

Before treating any tool result as authoritative for the current project:
1. Is the surface I just used **intrinsically scoped to this project**, or is it **account-wide /
   machine-wide / web-wide**? (Artifact galleries, filesystem reads outside the project dir, web
   fetch, MCP servers, and cross-project memory are **not** project-scoped.)
2. If not intrinsically scoped: **name the datum's origin** — which repo / project / account-context
   produced it? If I can't name it, I don't know it belongs here.
3. Does that origin **match the project I'm working in**? If it doesn't — or I can't tell — it is
   **EXTERNAL**. Label it external and do **not** treat it as this project's ground truth until
   confirmed.

**This is a different gate from the Grounding Check.** Grounding asks *"is this real?"*; Provenance
asks *"is this real for THIS project?"* A perfectly grounded source from the wrong project passes
Grounding and fails here. Run both.

**Trigger signals:** a result from an account- or machine-wide surface — a published-artifact
gallery listing, a file read outside the current repo, a web/MCP fetch, a memory recall naming an
unfamiliar project; or any artifact / file / vocabulary that does not trace into the current
project's directory or its designated reference area.

**Failure example:** In a Basher session, `Artifact(list)` returns artifacts titled *"Visor…"*.
Treating them as Basher's — they belong to a sibling product — imports an entire wrong roadmap.
Grounding passes (the artifacts are real); Provenance fails (they belong to another project).

---

## 4. Defining the project envelope (so the check is enforceable, not vibes)

The current project's boundary = the union of:
- its **repo working directory** (the primary working dir) + any explicitly declared additional
  working dirs;
- its **designated reference area** — `~/.anvideck/projects/[project]/` (Ground Truth + `.anvi/`
  catalogues);
- its **own memory namespace** — `~/.claude/projects/[project-slug]/memory/`.

**Everything else is EXTERNAL** and must be provenance-tagged before use: sibling repos, other
projects' `.artifacts/`, the account-wide artifact gallery, other projects' memory, arbitrary
web/MCP content.

**Practice that makes the boundary visible in the reasoning:** when citing any artifact/file/doc as
authoritative, **state its path/origin** so the boundary shows — e.g. *"per
`docs/UNIFICATION-DESIGN.md` [in-repo]"* vs *"per `MoGraph-DSL/.artifacts/…` [EXTERNAL]"*. A cite
without a locus is a provenance blind spot.

---

## 5. Integration with the rest of the framework

- **Dharana:** register the **project envelope** as the *outermost* tracked boundary — an
  "information-intake boundary" — with silent-failure mode *"cross-project contamination via
  account/FS/web surfaces (galleries, sibling repos, memory)."*
  ORIGIN = this instance; WHY = a grounded-but-foreign source is invisible to every source-level
  check; HOW = provenance-tag every datum from a non-scoped surface before trusting it.
- **Dhyana:** each session's scope includes *"guard the project envelope on intake"* — the check
  fires when a tool returns non-scoped data, not only at review time.
- **Boundary-pair observation:** apply it to *information intake* — observe not just the datum but
  *which side of the project boundary produced it*.
- **Optional hook (enforcement, immune to context compression):** a PostToolUse hook on
  `Artifact(list)` / filesystem reads outside the project dir / `WebFetch` that injects a one-line
  provenance reminder ("result is account/FS-wide — confirm it belongs to [project] before using").
  Mirrors `catalogue-context-injector.js`.
- **Promotion:** single occurrence → memory; recurrence → dharana. This one is promoted **directly**
  to a base-layer check because the failure class is **structural** — the tool surfaces are
  non-scoped by construction, in *every* project — not project-specific.

---

## 6. Adoption checklist
1. ✅ DONE (2026-07-12) — folded **§3 Provenance Check** into `cognitive-os/base-layer.md`, under
   *On Every Action*, immediately after the Grounding Check.
2. ✅ DONE (2026-07-12) — added the pointer in `~/.claude/CLAUDE.md`'s "Detail specs loaded on
   demand" list.
3. TODO — add the dharana "project envelope" boundary to each project's `.anvi/dharana.md` at next
   `/anvi:orient` (structural — applies to every project).
4. TODO (optional) — wire the PostToolUse provenance hook.
