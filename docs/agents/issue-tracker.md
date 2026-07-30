# Issue tracker: GitHub Issues

Issues live on GitHub: `snowplow-industry-solutions/signals-google-cx-agent-studio`.
The PRD stays in-repo at `.scratch/signals-cx-agent-demo/PRD.md`.

## Conventions

- Issue IDs are GitHub issue numbers (`#N`).
- Pipeline/triage state is a label on the issue; a closed issue means `done`.
  Status labels: `ready-for-agent`, `in-progress`, `ready-for-human`,
  `awaiting-human-test`, `needs-human` (plus triage labels `needs-triage`,
  `needs-info`, `wontfix`). An open issue with no status label reads as
  `needs-triage`. Exactly one status label at a time — `tracker.sh set-status`
  maintains that invariant.
- Auto-merge is opt-in (`SANDCASTLE_AUTO_MERGE=1 npm run afk`). By default the
  pipeline never merges: approved work lands as an open PR plus an alert, and a
  human tests and merges it. With auto-merge off, only a closed issue satisfies
  a blocker — `awaiting-human-test` work sits on an unmerged branch.
- Checkpoint issues carry the `checkpoint:human-test-required` label: the
  pipeline never auto-merges them even with auto-merge on, and
  `awaiting-human-test` on them does not satisfy blockers.
- Blockers are `#N` references inside a `## Blocked by` section of the issue
  body. `.sandcastle/tracker.sh` parses exactly that shape.
- Comments and conversation history are ordinary GitHub issue comments.
- Never use closing keywords (`closes #N`, `fixes #N`) in PRs — issues are
  closed by a human after the manual test passes, not by a merge.

## Tooling

`.sandcastle/tracker.sh` wraps `gh` with the pipeline's semantics
(`list`, `list-all`, `view`, `set-status`, `park`). Auth comes from `GH_TOKEN`
in the environment or `.sandcastle/.env` (gitignored), falling back to
`gh auth login` state. Sandboxed pipeline agents get no GitHub credentials;
only the host touches the tracker.

## When a skill says "publish to the issue tracker"

`gh issue create` with the appropriate status label (usually `needs-triage`
or `ready-for-agent`), a `## Blocked by` section when dependencies exist, and
the `checkpoint:human-test-required` label when a human must gate the merge.

## When a skill says "fetch the relevant ticket"

`gh issue view <n> --comments` (or `.sandcastle/tracker.sh view <n>` for body
plus comments in one shot). The user will normally pass the issue number.

## Migration record (2026-07-29)

The tracker previously lived as markdown under
`.scratch/signals-cx-agent-demo/issues/`; done issues and the PR-file records
remain there as history. Open issues were ported:

| Local file | GitHub issue |
| --- | --- |
| `09-product-cards-stretch.md` | #1 |
| `10-terraform-agent-config.md` | #2 |
| `12-agent-commentary-with-widgets.md` | #3 |
| `13-chat-loading-indicator.md` | #4 |
