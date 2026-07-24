# 02b — Live pipeline: trial org signup + live publish + end-to-end proof

Status: ready-for-human

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

Split from `02-live-pipeline.md`: this is the human half (browser signup, credential handling, live verification). The agent-doable prep is `02a-signals-publish-prep.md`.

## What to do (human)

Follow the runbook produced in 02a:

1. Create a Snowplow Free Trial org (full pipeline + Signals enabled).
2. Capture connection details (API URL, key, key ID, org ID) into local env config — not committed.
3. Point the storefront tracker env at the trial collector; browse the locally running storefront.
4. Run the Signals publish script: dry-run, then real publish of the fashion ecommerce stream attribute group and service.
5. Prove the loop: retrieve live attribute values for the browse session's `domain_sessionid` from the Signals Profile Store (SDK or REST) within seconds of browsing.
6. Fill in the runbook's placeholder values / correct any steps that didn't match reality.

## Acceptance criteria

- [ ] Free Trial org exists with pipeline and Signals enabled; connection details captured in env config, not committed
- [ ] Storefront events (page views + custom fashion ecommerce events) arrive in the trial pipeline from a local browse session
- [ ] Attribute group and service publish successfully via the publish script (dry-run and real)
- [ ] A real browse session's `domain_sessionid` returns populated attributes (e.g. favourite designer/category, product views count) via SDK or REST call within seconds of browsing
- [ ] Runbook verified against the real signup flow and updated where reality differed

## Blocked by

- `02a-signals-publish-prep.md`
