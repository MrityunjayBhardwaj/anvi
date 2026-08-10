<purpose>Show available Anvi commands and usage guide.</purpose>

<process>
<step name="display">
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Anvi ► COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Getting Started
  /anvi:new-project     Initialize a new project
  /anvi:new-milestone   Start a new milestone
  /anvi:init            Initialize cognitive OS for project
  /anvi:map-codebase    Analyze a codebase with parallel mapper agents

## Orientation
  /anvi:orient          Where am I — known/unknown/assumed, go deep or wide
  /anvi:rq              Surface the right questions to ask right now
  /anvi:lens            Map the lenses that apply to the current problem

## Planning
  /anvi:discuss-phase   Gather context before planning
  /anvi:plan-phase      Create detailed phase plans
  /anvi:research-phase  Deep research for a phase
  /anvi:list-phase-assumptions  Surface assumptions before planning
  /anvi:plan-milestone-gaps     Create phases to close milestone-audit gaps

## Execution
  /anvi:execute-phase   Execute phase plans
  /anvi:do              Route freeform task to right command
  /anvi:quick           Small task with guarantees
  /anvi:fast            Trivial inline edit
  /anvi:autonomous      Run all phases autonomously
  /anvi:explore         Explore a friction point — something that should exist

## Verification
  /anvi:verify-work     UAT verification
  /anvi:verify-phase    Verify a phase achieved its goal
  /anvi:validate-phase  Fill Nyquist validation gaps for a phase
  /anvi:add-tests       Generate tests for a phase
  /anvi:audit-uat       Cross-phase UAT audit
  /anvi:audit-milestone Milestone completion audit
  /anvi:review          Peer review of plans or implementation

## UI
  /anvi:ui-phase        Generate a UI design contract (UI-SPEC.md)
  /anvi:ui-review       6-pillar visual audit of implemented UI

## Debugging
  /anvi:debug           Cognitive OS-native debugging

## Navigation
  /anvi:progress        Current status and next action
  /anvi:next            Auto-advance to next step
  /anvi:resume-work     Resume from previous session

## Project Management
  /anvi:add-phase       Add phase to roadmap
  /anvi:insert-phase    Insert urgent phase
  /anvi:remove-phase    Remove future phase
  /anvi:complete-milestone  Archive and tag milestone
  /anvi:cleanup         Archive accumulated phase directories
  /anvi:pr-branch       Create a clean PR branch (filters .anvi/project_management/)
  /anvi:pause-work      Save state for later

## Notes & Ideas
  /anvi:note            Quick note capture
  /anvi:add-todo        Add a todo
  /anvi:check-todos     Review pending todos
  /anvi:plant-seed      Forward-looking idea with triggers

## Cognitive OS
  /anvi                 Activate cognitive OS
  /anvi:session         Session-only activation
  /anvi:audit           Self-coherence audit
  /anvi:update          Update this clone to the latest anvi (framework + hooks
                        + per-project catalogue migration, idempotent)

## Ground Truth (v1.1.0+)
  /anvi:ground          Establish three-layer grounding for external systems
                        (download source → generate Ground Truth docs → wire REFs)
                        Flags: --audit-only, --system [name], --rewire, --verify

## Currency
  /anvi:currency        Check catalogue freshness — which entries have drifted
                        from the code they point at — and re-validate them
                        Flags: --stale (worklist only), --lint (grounding gaps)

## Meta
  /anvi:help            This help
  /anvi:settings        Configure workflow toggles + session retention
  /anvi:stats           Project statistics
  /anvi:health          Planning directory health
  /anvi:session-report  Session summary
  /anvi:sess-wrap       Wrap up a session — harvest learnings, print kickoff
  /anvi:ship            Create PR and prepare for merge

## Where your knowledge is stored
  NOT in this repo. Catalogues, memory and planning documents live in
    ~/.anvideck/projects/<name>/
  reached from here through ./.anvi, a gitignored symlink. The store is its
  own git repo; if it has no remote, your knowledge is on this machine only.

  Check it:  ensure-store-durable.sh ~/.anvideck        (durability, read-only)
             conformance-report.js <project-dir>        (link, grant, binding)
  Full layout, identity and durability:  STORAGE.md
```
</step>
</process>
