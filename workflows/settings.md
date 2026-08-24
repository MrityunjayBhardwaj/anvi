<purpose>
Configure Anvi project workflow toggles, model profile, and Claude Code
session retention. Forked from GSD; extended with session-retention control
over `~/.claude/settings.json` `cleanupPeriodDays`.
</purpose>

<process>

<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
```
</step>

<step name="show_current">
Display current settings from BOTH scopes:

1. Project config — read `$PM/config.json` (if present): workflow toggles
   + model profile.

2. Session retention — read `~/.claude/settings.json` and show `cleanupPeriodDays`
   (how many days Claude Code keeps local session transcripts before cleanup;
   Claude default when unset: 30):
   ```bash
   node -e 'try{const d=JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/settings.json","utf8"));console.log("Session retention (cleanupPeriodDays):",d.cleanupPeriodDays??"30 (Claude default, unset)","days")}catch(e){console.log("Session retention: ~/.claude/settings.json missing or unreadable — will be created on first set")}'
   ```
</step>

<step name="parse_change">
If $ARGUMENTS requests a change, route it to the right scope:
- Workflow toggle / model profile → project config (`apply_project_config`).
- Session retention (e.g. "retention 90", "cleanupPeriodDays 365", "keep
  sessions for 1 year", "preserve sessions 180 days") → `apply_retention`.
  Interpret natural durations into a positive integer number of DAYS
  (1 year = 365, 6 months = 180, etc.).

If no change is requested, stop after showing current values.
</step>

<step name="apply_project_config">
For a project workflow toggle / model profile change:
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
node "$CLI_PATH" config-set "${KEY}" "${VALUE}"
```
</step>

<step name="apply_retention">
For a session-retention change: write `cleanupPeriodDays` (a positive integer
number of days) into `~/.claude/settings.json`, PRESERVING every other key.
Read-modify-write the JSON — never overwrite the whole file. Refuse a
non-positive/non-integer value, and refuse to write if the file isn't a JSON
object (assigning a named key onto an array/non-object is silently dropped by
JSON.stringify — the H3 trap).

```bash
DAYS="<validated positive integer of days>"
node -e '
const fs = require("fs");
const p = process.env.HOME + "/.claude/settings.json";
const days = parseInt(process.argv[1], 10);
if (!Number.isInteger(days) || days < 1) {
  console.error("Session retention must be a positive integer number of days.");
  process.exit(1);
}
let d = {};
try { if (fs.existsSync(p)) d = JSON.parse(fs.readFileSync(p, "utf8")); }
catch (e) { console.error("settings.json is not valid JSON — aborting to avoid clobbering it."); process.exit(1); }
if (typeof d !== "object" || d === null || Array.isArray(d)) {
  console.error("settings.json is not a JSON object — aborting (a named key on a non-object is silently dropped).");
  process.exit(1);
}
const prev = d.cleanupPeriodDays;
d.cleanupPeriodDays = days;
fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
console.log(`Session retention: ${prev ?? "30 (default)"} -> ${days} days (cleanupPeriodDays). All other settings preserved.`);
' "$DAYS"
```

Confirm by re-reading `cleanupPeriodDays` from the file. The new value takes
effect on future cleanup runs; existing transcripts are not deleted immediately.
</step>

</process>

<success_criteria>
- [ ] Current project config AND session retention shown
- [ ] A requested retention change validated (positive integer days) and written to ~/.claude/settings.json
- [ ] All other settings.json keys preserved (read-modify-write, not overwrite)
- [ ] New value confirmed by re-read
- [ ] Invalid input (non-integer, non-positive, non-object file) refused instead of writing
</success_criteria>
