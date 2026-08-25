<purpose>Create a clean PR branch by filtering out .anvi/project_management/ commits. Forked from GSD. Pure utility, no cognitive integration.</purpose>

<process>
<step name="create_branch">Create PR branch from current state.</step>
<step name="resolve_tree">
```bash
CLI_PATH="$HOME/.claude/anvi/bin/anvi-tools.cjs"
PM="$(node "$CLI_PATH" planning-root --raw)"   # resolved, never spelled (invariant 2)
echo "$PM"                                     # the value the steps below use
```
</step>
<step name="filter">Remove the `$PM` directory from the branch. On an unmigrated project it
resolves to the pre-migration tree, so a spelled path would filter nothing and ship the
planning documents inside the PR — the one outcome this command exists to prevent.</step>
<step name="report">Report branch name, ready for PR.</step>
</process>
