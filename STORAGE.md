# Where your knowledge is stored

**Short answer:** not in your repo. It lives in `~/.anvideck/`, and your repo holds a
gitignored symlink pointing there.

This document is the single description of that layout. Commands **link here** rather than
restating it — a layout explained in six places disagrees with itself within two changes.

---

## The layout

```
your-repo/
  .anvi  ──────symlink──────►  ~/.anvideck/projects/<name>/.anvi
  .gitignore                   contains `.anvi` — the link is never committed

~/.anvideck/                        ← a git repo of its own → anvi_artifacts (private)
  .backup-decision.json             ← present only if you declined the backup (see below)
  projects/<name>/
    PROVENANCE.json                 ← identity record — BESIDE .anvi/, not inside it
    .anvi/                          ← the knowledge base
      hetvabhasa.md                 error patterns
      vyapti.md                     invariants
      krama.md                      lifecycle patterns
      dharana.md                    project boundaries and focus
    memory/                         session memory, where a project has it
    ref/                            Ground Truth docs + vendored source snapshots
    project_management/             planning documents, once migrated
```

`<name>` is the project directory's basename. A name alone does **not** grant access — see
*Identity* below.

## Why it is not in your repo

Three reasons, in order of how much they bite:

1. **Public repos.** Catalogues record real defects, real paths, and how systems actually
   fail. That is not something to push to a public remote by accident. The symlink is
   gitignored, so it cannot be committed even carelessly.
2. **One copy, not two.** A symlink is an alias, not a duplicate. There is no local copy to
   drift out of sync with a central one, and no merge to perform between them.
3. **Knowledge outlives a checkout.** Deleting and re-cloning a repo does not destroy what
   you learned working in it.

## Durability — the part worth understanding

Your repo's git history does **not** back this up, because none of it is in your repo. The
store's durability is entirely its own:

| state | what it means |
|---|---|
| `DURABLE` | `~/.anvideck` is a git repo **with a remote** — committed and pushed off this machine |
| `NO_REMOTE` | a git repo, versioned locally, **pushed nowhere** — a disk failure loses it |
| `NO_REPO` | not a git repo — **tracked nowhere at all**, no history |
| `NO_DIR` | the store does not exist yet; created on first use |

Check it any time:

```bash
bash ~/.claude/anvi/scripts/ensure-store-durable.sh ~/.anvideck    # detect only, no writes
```

`/anvi:init` offers to create the backup repo (default name `anvi_artifacts`, default
visibility **private**). Creating a GitHub repository is outward-facing, so it never happens
without your explicit consent.

**If you decline**, the store is still made a local git repo, so you keep version history —
you simply have no off-machine copy. That is a legitimate choice; it is only a problem when
it is a surprise.

Your answer is remembered, in `~/.anvideck/.backup-decision.json`. `/anvi:init` will not ask
again — it will still *tell* you where your knowledge stands, because you are always entitled
to know that, but stating is not asking. Only `/anvi:update` revisits the question, and it
says so when it does. The record is deleted the moment the store actually gets a remote, since
by then it answers a question that no longer exists.

You can create the remote later:

```bash
bash ~/.claude/anvi/scripts/ensure-store-durable.sh --apply --create-remote \
     --repo-name anvi_artifacts --visibility private ~/.anvideck
```

## Identity — why a folder name is not enough

The store is addressed as `~/.anvideck/projects/<basename-of-your-directory>/`. A name is
self-asserted: any folder can be called anything. So `PROVENANCE.json` records who the
project actually belongs to — the normalized git remote, or the location when there is no
remote:

```json
{
  "remote": "github.com/owner/project",
  "worktrees": ["/Users/you/code/project"]
}
```

At lookup time the **name selects which record to consult; the record decides whether you
are served.** A directory that merely shares a name gets nothing.

`worktrees` is a list on purpose — two checkouts of one repository are both legitimately
that project.

The record sits *beside* `.anvi/` rather than inside it, so checking whether you may open
the knowledge base does not require opening the knowledge base first. It also covers
`memory/`, `ref/` and `project_management/`, not just the catalogues.

### If a project is declined

You will see a message naming the state and a remedy. The common one:

```
⚠ anvi: declining to serve '.anvi' for <dir> — UNBOUND. no provenance record
  for this store project. bind this directory:
  node scripts/bind-store.js --apply <dir>
```

| state | meaning | what to do |
|---|---|---|
| `UNBOUND` | no record yet | run the bind command above |
| `MISMATCH` | a record exists and this directory is not it | a genuine name collision — resolve by hand |
| `UNVERIFIABLE` | anvi's own identity module is missing | re-run `install.sh` |

Reads and writes differ on purpose: `UNVERIFIABLE` still serves reads with a warning, but
refuses writes. Breaking every read because *our* module is missing would be worse than the
risk; an unverifiable write is the direction you cannot undo.

## Checking the state of a project

```bash
node ~/.claude/anvi/scripts/conformance-report.js <project-dir>
```

Reports the link, the access grant, the binding, durability, and whether planning documents
have been migrated.

## Moving or removing it

- **Moving the store** — it is a plain git directory; move it and re-run
  `install.sh --migrate` so the symlinks are repointed.
- **Detaching one project** — copy `~/.anvideck/projects/<name>/.anvi/` back into the repo,
  replace the symlink, and drop `.anvi` from `.gitignore`. Nothing prevents this; the
  catalogues are ordinary markdown.
- **Deleting it** — the knowledge is gone unless the store was pushed. That is the whole
  point of the durability section above.
