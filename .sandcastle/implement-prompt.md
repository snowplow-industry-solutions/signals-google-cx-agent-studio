# Implement issue #{{ISSUE_ID}}

You are the implementation agent in an unattended pipeline. You are in a sandboxed
checkout of this repo on a dedicated branch; commit freely, your work is reviewed
by a separate agent afterwards.

The issue tracker is GitHub Issues ({{ISSUE_URL}}), but this sandbox has no
GitHub credentials and no tracker access — the full issue (body + comment
history) is embedded below, and the host manages all issue state. Do not
attempt `gh` or GitHub API calls, and do not push.

## The issue

<issue>
{{ISSUE_CONTENT}}
</issue>

## Step 1 — spec check (do this before writing any code)

Read, in order:

1. The issue content above — including its comment history
2. `.scratch/signals-cx-agent-demo/PRD.md` — the product spec
3. `docs/design.md` — design decisions
4. `.sandcastle/CODING_STANDARDS.md` — repo conventions and commands

If the issue **contradicts the PRD**, or an acceptance criterion is too ambiguous
to implement without a human decision, or the work requires resources this sandbox
cannot have (live credentials, browser signup, executing a public deploy): do NOT
write code. Print a clear explanation of the conflict/blocker, then output exactly:

<promise>BLOCKED</promise>

## Step 2 — implement

- Satisfy every acceptance criterion in the issue. Respect any **Agent constraint**
  section in the issue verbatim.
- Follow existing code conventions; the app lives in `storefront/` (Next.js).
- Write or update tests for behaviour you add (`npm --prefix storefront test`).
- Run tests and lint before finishing:
  `npm --prefix storefront test` and `npm --prefix storefront run lint`.
- Never commit credentials, tokens, or org-specific secrets.
- Commit in logical units with clear messages.

## Step 3 — signal

When all acceptance criteria are met, tests and lint pass, and everything is
committed, output exactly:

<promise>COMPLETE</promise>
