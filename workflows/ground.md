<purpose>Establish or update the three-layer grounding (Catalogues → Ground Truth → Source Code) for an existing project. Use for projects initialized before v1.1.0 or when catalogues have ungrounded entries. Also use when adding a new external dependency.</purpose>

<process>

<step name="audit">
## Step 1: Audit Current Grounding State

Scan all catalogue files in `.anvi/` (or `~/.anvideck/projects/[project]/.anvi/`):

1. Count entries with `**REF:**` field (grounded)
2. Count entries without `**REF:**` field (ungrounded)
3. List Ground Truth docs that exist in `~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md`
4. List source directories that exist in `~/.anvideck/projects/[project]/ref/sources/*/`
5. Check dharana for boundary entries — extract external system names

Report:
```
GROUNDING AUDIT
  Catalogues:
    hetvabhasa: N/M entries grounded (N have REF, M total project-specific)
    vyapti: N/M entries grounded
    krama: N/M entries grounded
    dharana: N boundaries, N have REF
  
  Ground Truth docs: [list or "none"]
  Source code downloaded: [list dirs or "none"]
  
  External systems referenced in boundaries:
    - [system 1] — Ground Truth: [exists/missing], Source: [exists/missing]
    - [system 2] — ...
  
  Ungrounded entries needing REFs:
    - [ID]: [name] — references [system], needs GROUND_TRUTH_[SYSTEM].md
    - ...
```
</step>

<step name="identify">
## Step 2: Identify External Systems to Ground

From the audit, identify which external systems need Ground Truth docs. For each:

1. **Ask the user** which systems to prioritize (they may not all be relevant right now)
2. **Identify source availability:**
   - npm package → check for GitHub repo, readable source
   - Ruby gem → check for GitHub repo
   - API/service → check for documentation, SDK source
   - Closed source → mark as OPAQUE, document API surface only

Present the plan:
```
GROUNDING PLAN
  Systems to ground (user-approved):
    1. [system] — source at [URL], estimated [N] key files
    2. [system] — source at [URL], estimated [N] key files
  
  Systems marked OPAQUE:
    - [system] — [reason: closed source / WASM binary / etc.]
  
  Proceed? [y/n]
```
</step>

<step name="download">
## Step 3: Download Source Code

For each approved system:

1. Create directory: `~/.anvideck/projects/[project]/ref/sources/[system_name]/`
2. Download source files (prefer unminified/readable source from GitHub repos)
3. Download available documentation (README, ARCHITECTURE.md, API docs)
4. Verify completeness — list files with line counts

**Download strategy by source type:**
- **npm package on GitHub:** Fetch from `raw.githubusercontent.com/[owner]/[repo]/main/`
- **npm package without GitHub:** Use `unpkg.com/[package]@latest/` — check if source is readable
- **Ruby gem:** Fetch from `raw.githubusercontent.com/[owner]/[repo]/`
- **Web demo (closed source):** Download the JS files from the demo page via DevTools Network URLs
- **WASM binary:** Download the JS wrapper/loader, mark WASM internals as OPAQUE

Report after download:
```
DOWNLOAD COMPLETE
  [system_name]/
    Source: N files, M total lines
    Docs: N files
    Key files: [list the most important ones]
```
</step>

<step name="generate">
## Step 4: Generate Ground Truth Documents

For each downloaded system, launch an agent to generate the Ground Truth doc.

**IMPORTANT: The meta-prompt MUST be loaded into the agent's context.** Do not just reference it — read its full content and include it in the agent prompt.

### How to launch each agent:

```
1. READ the meta-prompt:
   Primary: ~/.claude/anvi/templates/ground-truth-meta-prompt.md
   Fallback: ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_META_PROMPT.md (if copied to project)

2. BUILD the agent prompt with this structure:
   
   "You are a source code pipeline tracer. Your job is to read source code
   and documentation files, then produce a Ground Truth Document.
   
   ## Meta-Prompt (FOLLOW THIS EXACTLY)
   [PASTE THE FULL CONTENT of ground-truth-meta-prompt.md HERE]
   
   ## Task
   Produce GROUND_TRUTH_[SYSTEM_NAME].md
   
   ## Source Files (READ ALL)
   [List every file in ~/.anvideck/projects/[project]/ref/sources/[system]/ with full paths]
   
   ## Documentation Files
   [List every doc file with full paths]
   
   ## What to Trace
   [Describe the system's pipeline: what goes in, what comes out,
    what stages exist between them]
   
   ## Output
   Write to: ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_[SYSTEM_NAME].md
   
   Remember: every claim must cite file:line. Code wins over docs."

3. LAUNCH the agent (use general-purpose subagent type)
```

### Quality verification after generation:

For each generated doc, verify:
```bash
# Count code citations (should be 50+)
grep -cE '[a-z_]+\.(js|rb|ts|py):[0-9]+' ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md

# Count stages (should be 3+)
grep -c '^## STAGE' ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md

# Count NOT FOUND (should be <10% of citations)
grep -ci 'NOT FOUND' ~/.anvideck/projects/[project]/ref/GROUND_TRUTH_*.md
```

**Launch agents in parallel** for multiple systems.

Report after generation:
```
GROUND TRUTH GENERATED
  GROUND_TRUTH_[SYSTEM].md — N lines, N code citations, N stages, N NOT_FOUND
  ...
```
</step>

<step name="wire">
## Step 5: Wire REFs into Catalogues

For each ungrounded catalogue entry identified in Step 1:

1. Find the relevant Ground Truth doc and section
2. Find the specific `file:line` citation that supports the entry
3. Add `**REF:** GROUND_TRUTH_[SYSTEM].md#[section] — [file:line] [description]`

For each dharana boundary entry:
1. Add `**REF:**` pointing to the Ground Truth doc's boundary map or pipeline stage
2. Ensure the hook will extract and inject these REFs

**Do NOT modify the behavioral content of catalogue entries** — only add REF fields.

Report:
```
WIRING COMPLETE
  hetvabhasa: N entries wired (was M ungrounded)
  vyapti: N entries wired
  krama: N entries wired
  dharana: N boundaries wired
  
  Still ungrounded: [list any that couldn't be matched, with reason]
```
</step>

<step name="verify">
## Step 6: Verify the Chain

Test the complete three-layer chain:

1. Pick 3 catalogue entries at random
2. For each, follow the chain: entry → REF → Ground Truth doc section → file:line → actual source code
3. Verify the source code actually supports the catalogue claim
4. If any chain breaks, fix it

Test the hook:
1. Simulate an edit to a file at a catalogued boundary
2. Verify the hook output includes Ground Truth REFs

Report:
```
VERIFICATION
  Chain test 1: [entry ID] → [Ground Truth section] → [file:line] ✓/✗
  Chain test 2: [entry ID] → [Ground Truth section] → [file:line] ✓/✗
  Chain test 3: [entry ID] → [Ground Truth section] → [file:line] ✓/✗
  
  Hook test: [boundary file] → injects [N] Ground Truth refs ✓/✗
```
</step>

<step name="update-dharana">
## Step 7: Update Dharana Ground Truth Inventory

Add or update section 5 of dharana.md:

```markdown
## 5. Ground Truth Inventory

| System | Ground Truth Doc | Source Location | Last Verified | Opaque Regions |
|--------|-----------------|-----------------|---------------|----------------|
| [name] | GROUND_TRUTH_[NAME].md | ~/.anvideck/projects/[project]/ref/sources/[name]/ | [date] | [list or "none"] |
| ... | ... | ... | ... | ... |

Ungrounded catalogue entries: [count] (down from [original count])
```
</step>

<step name="report">
## Step 8: Final Report

```
GROUNDING COMPLETE

Before:
  Ungrounded entries: [N]
  Ground Truth docs: [N]
  Source systems: [N]

After:
  Ungrounded entries: [N] (delta: -[N])
  Ground Truth docs: [N] (new: [N])
  Source systems: [N] (new: [N])
  Code citations: [total across all Ground Truth docs]

Three-layer chain verified: ✓
Hook injects Ground Truth refs: ✓

Next: Run /anvi:orient to load grounded context for this session.
```
</step>

</process>

<arguments>
- `--system [name]` — Ground only a specific external system (skip audit of others)
- `--audit-only` — Run Steps 1-2 only, report without downloading or generating
- `--rewire` — Skip download/generate, only re-wire REFs from existing Ground Truth docs
- `--verify` — Run Step 6 only (verify existing chains)
</arguments>
