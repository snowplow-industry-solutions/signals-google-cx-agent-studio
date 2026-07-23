# 02 — Live pipeline: trial org + Signals publish

Status: ready-for-agent

## Parent

`.scratch/signals-cx-agent-demo/PRD.md`

## What to build

Stand up the Snowplow environment: create a Snowplow Free Trial org (full pipeline + Signals), point the storefront's tracker at the trial collector, and publish the existing Signals configuration (the fashion ecommerce stream attribute group and its service) from the repo's config-as-code publish script. Prove the loop end-to-end: browse the locally running storefront, then retrieve live attribute values for that session from the Signals Profile Store.

Document every setup step in the runbook as you go — the trial org is time-boxed and the environment must be re-creatable.

## Acceptance criteria

- [ ] Free Trial org exists with pipeline and Signals enabled; connection details (API URL, key, key ID, org ID) captured in env config, not committed
- [ ] Storefront events (page views + custom fashion ecommerce events) arrive in the trial pipeline from a local browse session
- [ ] Attribute group and service publish successfully via the publish script (dry-run and real)
- [ ] A real browse session's `domain_sessionid` returns populated attributes (e.g. favourite designer/category, product views count) via SDK or REST call within seconds of browsing
- [ ] Runbook documents org creation, credential setup, and publish steps

## Blocked by

- `01-storefront-foundation.md`
