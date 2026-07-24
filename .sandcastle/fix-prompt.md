# Fix review findings for issue {{ISSUE_ID}}

You are the fix agent in an unattended pipeline. A reviewer rejected the current
branch state with the findings below. Apply each fix, nothing more.

## Findings

{{FINDINGS}}

## Rules

- Address every finding; if a finding is genuinely wrong, leave the code as-is
  and explain why in your final message (the reviewer re-checks afterwards).
- Re-read `{{ISSUE_FILE}}` if a finding concerns acceptance criteria.
- No opportunistic refactors — smallest correct change per finding.
- Run `npm --prefix storefront test` and `npm --prefix storefront run lint`
  before finishing; both must pass.
- **Never modify the `Status:` or `Checkpoint:` lines in issue files.**
- Commit the fixes with a message referencing the findings.

When done, output exactly:

<promise>COMPLETE</promise>
