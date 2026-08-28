<purpose>
Put an issue on the project board and set its Status in one operation, with every
identifier derived from the repository rather than pasted from a previous session.

`gh project item-add` does not set a Status. An item added without one sits with an
empty Status field, which is invisible to a board viewed by column — so it reads as
handled while being in no column at all. That second call is the one that gets skipped,
which is the whole reason this is a command rather than a note.
</purpose>

<inputs>
$ARGUMENTS — the issue number, and optionally the target column
(e.g. `365`, or `365 In Progress`). Default column is `Todo`.
</inputs>

<constraints>
Projection is ONE-WAY (PROJECT_MANAGEMENT.md §10). Local state flows out to the board;
board state is never read back to decide what happens locally. This command writes and
reports. It must not consult a Status to choose a branch of its own behaviour — once
both sides write, nothing can say which is real.

DERIVE every identifier, never store one. The board number, the project node id, the
Status field id and the option id all come from the repository at run time. A stored id
is correct right up until someone renames a column or moves the board, and a stale id
cannot be told from a live one by looking at it — the same failure as a stored commit
sha that a squash has already deleted.
</constraints>

<process>

<step name="project_and_move">
One block, because every value below is derived from the one above it and a shell block
inherits nothing from its neighbours.

```bash
ISSUE=<the issue number from $ARGUMENTS>
WANT=<the target column from $ARGUMENTS, or "Todo">

read -r OWNER REPO_NAME <<<"$(gh repo view --json owner,name \
  --jq '.owner.login + " " + .name')"

# The board is linked to the repo, so the repo can be asked which board is its own.
BOARD=$(gh api graphql -f owner="$OWNER" -f name="$REPO_NAME" -f query='
  query($owner:String!,$name:String!){
    repository(owner:$owner,name:$name){
      projectsV2(first:10){ nodes { number title } }
    }
  }' --jq '.data.repository.projectsV2.nodes[0].number')

if [ -z "$BOARD" ]; then
  echo "no board is linked to $OWNER/$REPO_NAME — nothing to update, and nothing guessed"
  exit 1
fi

PROJECT_ID=$(gh project view "$BOARD" --owner "$OWNER" --format json --jq '.id')

FIELD_ID=$(gh project field-list "$BOARD" --owner "$OWNER" --format json \
  --jq '.fields[] | select(.name == "Status") | .id')

# `gh --jq` takes exactly ONE argument and does not accept jq's `--arg`; passing one
# makes gh read the flags as positionals and fail with "accepts at most 1 arg(s)". So the
# option list comes back as plain `id name` lines and the match happens in the shell,
# where the wanted value is data rather than something interpolated into a program.
STATUS_OPTIONS=$(gh project field-list "$BOARD" --owner "$OWNER" --format json \
  --jq '.fields[] | select(.name == "Status") | .options[] | "\(.id) \(.name)"')

# Split on the FIRST space only: a column name contains spaces ("In Progress") and an id
# does not, so everything after the first field is the name.
OPTION_ID=$(printf '%s\n' "$STATUS_OPTIONS" \
  | awk -v want="$WANT" '{ id = $1; $1 = ""; sub(/^ /, ""); if ($0 == want) print id }')

# A column name that matches nothing must stop here. Continuing would run item-add and
# skip item-edit, producing exactly the statusless item this command exists to prevent —
# and it would report success while doing it.
if [ -z "$OPTION_ID" ]; then
  echo "board $BOARD has no Status column named \"$WANT\". Its columns are:"
  # Listed from the SAME response the match was attempted against, not a second query —
  # two reads of a board that someone may be editing can disagree, and then the error
  # message names columns the match never saw.
  printf '%s\n' "$STATUS_OPTIONS" | cut -d' ' -f2-
  exit 1
fi

# add-or-get: for an issue already on the board this returns the existing item and
# creates nothing, so the same command adds a new issue and moves an existing one.
ITEM_ID=$(gh project item-add "$BOARD" --owner "$OWNER" \
  --url "https://github.com/$OWNER/$REPO_NAME/issues/$ISSUE" --format json --jq '.id')

if [ -z "$ITEM_ID" ]; then
  echo "could not put issue #$ISSUE on board $BOARD — check the number exists in $OWNER/$REPO_NAME"
  exit 1
fi

# The edit is the half that gets skipped, so its failure is the one that must not be
# reported as success. An item added whose Status was never set is on the board in no
# column at all — invisible to every column-filtered view, and reading as handled. Say
# so in those words, because the reader has to know there is now something to repair.
if ! gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" >/dev/null; then
  echo "issue #$ISSUE was ADDED to board $BOARD but its Status was NOT set —"
  echo "it is on the board in no column. Re-run this command to finish the move."
  exit 1
fi

echo "#$ISSUE -> $WANT   board $BOARD ($OWNER/$REPO_NAME), item $ITEM_ID"
```
</step>

<step name="report">
State what was done, naming the board and the column — both derived values, so a reader
can see which board was written to rather than assuming it was the one they meant. If
the run stopped at either guard above, report that instead; a command that writes
nothing must not be reported as one that wrote.

Do NOT report Done transitions as work this command performs. Closing an issue through a
merged PR moves its item to Done on its own, so a Done set by hand is duplicating a
mechanism that already runs — and hiding whether the automatic one fired.
</step>

</process>
