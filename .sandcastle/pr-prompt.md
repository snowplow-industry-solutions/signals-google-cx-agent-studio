# Write the PR file for issue {{ISSUE_ID}} (branch {{BRANCH}})

You are the clerk agent. The work on this branch is implemented, reviewed, and
approved. Produce the pull-request record and manual testing plan for the human.

There is no GitHub remote yet, so the "PR" is a markdown file. When the real
repo exists these files become actual PR descriptions.

## Task

Read `{{ISSUE_FILE}}`, `git log main..HEAD --oneline`, and `git diff main...HEAD --stat`
(dig into the full diff where the summary needs it). Then write
`.scratch/signals-cx-agent-demo/PR-{{ISSUE_ID}}.md` with exactly these sections:

```
# PR: <issue title>

**Branch:** {{BRANCH}}
**Issue:** {{ISSUE_FILE}}

## Summary
<2–4 sentences: what changed and why>

## Changes
<bullet list of the meaningful changes, grouped by area>

## Pipeline review record
<one line per stage: implement/review/fix cycles that ran>

## Manual testing plan
<step-by-step plan a human runs locally. For EACH acceptance criterion in the
issue: exact commands to run (e.g. npm --prefix storefront run dev), URLs to
open, what to click/type, and the precise expected result. Include a
prerequisites subsection (env vars, services) and a "if it fails" note saying
what to check first.>

## Rollback
<one line: how to undo (revert merge commit / delete branch)>
```

## Rules

- The manual testing plan is the whole point — make it complete and copy-pasteable.
- Do not modify any other file. **Never touch `Status:` or `Checkpoint:` lines.**
- Commit the PR file on this branch with message `Add PR file for {{ISSUE_ID}}`.

When the file is written and committed, output exactly:

<promise>COMPLETE</promise>
