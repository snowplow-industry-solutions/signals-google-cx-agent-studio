# Research: Can CX Agent Studio be managed as IaC with Terraform?

**Date:** 2026-07-28 · **Sources:** HashiCorp provider repo/changelog, Terraform Registry doc sources, Google Cloud REST references, GoogleCloudPlatform GitHub repos (primary sources only).

## TL;DR

**Yes — and better than expected, because there are two separate Terraform resource families and the newer one maps directly onto this demo.**

1. **Classic Conversational Agents (Dialogflow CX, `dialogflow.googleapis.com` v3)** — `google_dialogflow_cx_*`: complete coverage of the traditional resources *and* the generative-era ones (`_tool`, `_playbook`, `_generative_settings`, `_generator`), all in the **GA `google` provider**. Main gaps: the default/start playbook is auto-created (import-only), playbook `handlers`/parameters aren't in the Terraform schema, and console Integrations (Dialogflow Messenger) have no API at all.
2. **CX Agent Studio / Gemini Enterprise for CX (CES, `google.cloud.ces.v1` API)** — the surface this demo is actually built on (App → Root Agent → Tools/Toolsets → Deployment) has its own family, **`google_ces_*`**, added between provider **7.10.0 (Nov 2025) and 7.31.0 (May 2026)**, GA provider. It covers the agent shell, **Root Agent instructions**, **OpenAPI toolsets** (inline schema + auth), app versions, and — notably — the **web-widget Deployment including public-access/token-broker security settings** that `ces-messenger` consumes. Essentially everything this demo clicks through in the console is terraformable with `hashicorp/google >= 7.31.0`.

Escape hatches for anything not covered: `apps.exportApp`/`importApp` (CES, JSON/YAML) and `agents.export`/`restore` (Dialogflow CX, JSON package with direct git push), plus the console Git integration and the `dfcx-scrapi` Python library (classic surface only).

---

## 1. Terraform provider coverage

Latest provider release at time of writing: **v7.41.0** ([releases](https://github.com/hashicorp/terraform-provider-google/releases)). All "since" versions and dates below are from the provider changelogs: [CHANGELOG.md](https://github.com/hashicorp/terraform-provider-google/blob/main/CHANGELOG.md), [CHANGELOG_v4.md](https://github.com/hashicorp/terraform-provider-google/blob/main/CHANGELOG_v4.md), [CHANGELOG_v3.md](https://github.com/hashicorp/terraform-provider-google/blob/main/CHANGELOG_v3.md). Field details verified against the provider doc sources in [`website/docs/r/`](https://github.com/hashicorp/terraform-provider-google/tree/main/website/docs/r) (the source of the Registry pages). Every resource below exists in **both** `google` and `google-beta` unless marked beta-only.

### 1a. Classic surface — `google_dialogflow_cx_*` ([Registry docs](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/dialogflow_cx_agent))

| Resource | Provider | Since | Notes |
|---|---|---|---|
| `google_dialogflow_cx_agent` | GA | 3.73.0 (21 Jun 2021) | Agent shell: languages, logging (`enable_stackdriver_logging`, `advanced_settings.logging_settings`), speech/TTS, `security_settings` link, `git_integration_settings` (GitHub), `gen_app_builder_settings` (data-store engine link, 6.36.0), `start_playbook` (7.0.0, 26 Aug 2025 — **restricted to the auto-created default playbook ID `00000000-...-000000000000`**). **No `labels` field.** |
| `google_dialogflow_cx_flow` | GA | 3.76.0 (19 Jul 2021) | Incl. `knowledge_connector_settings` (6.35.0) and generative fallback on event handlers (6.36.0). |
| `google_dialogflow_cx_intent` | GA | 3.76.0 | |
| `google_dialogflow_cx_version` | GA | 3.76.0 | Flow versions. |
| `google_dialogflow_cx_page` | GA | 3.79.0 (9 Aug 2021) | Incl. `knowledge_connector_settings` (6.35.0). |
| `google_dialogflow_cx_entity_type` | GA | 3.79.0 | |
| `google_dialogflow_cx_environment` | GA | 3.80.0 (16 Aug 2021) | |
| `google_dialogflow_cx_webhook` | GA | 4.37.0 (19 Sep 2022) | Incl. flexible webhooks (6.45.0) and `service_account_auth_config` (7.17.0). |
| `google_dialogflow_cx_test_case` | GA | 4.83.0 (18 Sep 2023) | |
| `google_dialogflow_cx_security_settings` | GA | 4.84.0 (26 Sep 2023) | Redaction/retention. |
| **`google_dialogflow_cx_tool`** | GA | **6.40.0 (17 Jun 2025)** | Generative tools: `open_api_spec` (inline `text_schema` OpenAPI YAML/JSON + `authentication`: `api_key_config`, `oauth_config`, `bearer_token_config`, `service_agent_auth_config`), `data_store_spec`, `function_spec`. `connector_spec` is **beta-only**. [Doc](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/dialogflow_cx_tool) |
| **`google_dialogflow_cx_generative_settings`** | GA | **6.42.0 (1 Jul 2025)** | Per-language: `llm_model_settings` (model + prompt), `fallback_settings` (prompt templates), `generative_safety_settings` (banned phrases), `knowledge_connector_settings` (agent persona/scope). Maps to `agents.updateGenerativeSettings`. |
| **`google_dialogflow_cx_generator`** | GA | **6.45.0 (22 Jul 2025)** | Fulfillment generators. |
| **`google_dialogflow_cx_playbook`** | GA | **6.48.0 (12 Aug 2025)** | Changelog: *"initial basic support, full features to follow in a later release"*. Covers `display_name`, `goal`, `instruction` (guidelines + nested steps), `referenced_tools`, `llm_model_settings`, `playbook_type` (TASK/ROUTINE). **Not covered:** `handlers[]` (event/lifecycle), `inputParameterDefinitions`/`outputParameterDefinitions`, `codeBlock` — all present in the [v3 Playbook API](https://docs.cloud.google.com/dialogflow/cx/docs/reference/rest/v3/projects.locations.agents.playbooks). |
| `google_dialogflow_cx_tool_version` | GA | 7.17.0 (27 Jan 2026) | Snapshot versions of tools. |

Open provider issues for this family are almost all CI test-failure bots; no significant open feature requests for missing Dialogflow CX resources were found ([issue search](https://github.com/hashicorp/terraform-provider-google/issues?q=is%3Aissue+is%3Aopen+dialogflow)). The old request for playbook resources ([#23328](https://github.com/hashicorp/terraform-provider-google/issues/23328)) is closed — delivered in 6.48.0.

### 1b. CX Agent Studio surface — `google_ces_*` ([Registry docs](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/ces_app))

These wrap the **Gemini Enterprise for Customer Experience API** (`google.cloud.ces.v1`, [REST reference](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/reference/rest)) — the App/Agent/Tool/Deployment model behind CX Agent Studio and the `ces-messenger` widget.

| Resource | Provider | Since | Notes |
|---|---|---|---|
| **`google_ces_app`** | GA | **7.10.0 (4 Nov 2025)** | App shell: `global_instruction`, `model_settings` (generative model selection), `logging_settings`, `language_settings`, `guardrails` refs, `data_store_settings`, `variable_declarations`, `tool_execution_mode`, audio/channel profiles. `root_agent` is output-only at create time — see association resource. **No `labels` field.** |
| **`google_ces_toolset`** | GA | **7.10.0** | **The writable path for OpenAPI tools**: `open_api_toolset` takes an inline `open_api_schema` (YAML) + `api_authentication` (`api_key_config`, `bearer_token_config`, `oauth_config`, `service_account_auth_config`); one tool is generated per operation. Also `mcp_toolset` (7.20.0) incl. custom headers (7.25.0). |
| **`google_ces_deployment`** | GA | **7.11.0 (11 Nov 2025)** | Publishes an `app_version` to a channel. `channel_profile.web_widget_config` (modality, theme, title, persona) + **`security_settings`: `enable_public_access`, `enable_origin_check`, `allowed_origins`, `enable_recaptcha`** — i.e. the unauthenticated-access config the managed token broker (`sessions.generateChatToken`) enforces for `ces-messenger`. |
| `google_ces_example` | GA | 7.11.0 | Few-shot examples incl. tool calls/responses (7.14.0). |
| **`google_ces_agent`** | GA | **7.12.0 (18 Nov 2025)** | The Root Agent (and child agents): **`instruction`** (playbook-style prompt), `tools`, `toolsets`, `child_agents`, `model_settings`, before/after model/tool/agent callbacks (Python), `remote_dialogflow_agent` (bridge to a classic CX agent), `guardrails`. |
| `google_ces_guardrail` | GA | 7.12.0 | Incl. LLM prompt-security settings. |
| `google_ces_tool` | GA | 7.12.0 | **Caveat:** only `agent_tool`, `data_store_tool`, `file_search_tool`, `google_search_tool`, `widget_tool` are configurable. `open_api_tool`, `mcp_tool`, `connector_tool`, `remote_agent_tool` are **read-only/output-only** on this resource ([doc source](https://github.com/hashicorp/terraform-provider-google/blob/main/website/docs/r/ces_tool.html.markdown)) — create those via `google_ces_toolset`. |
| `google_ces_app_version` | GA | 7.13.0 (9 Dec 2025) | Immutable app snapshot, referenced by deployments. |
| **`google_ces_app_root_agent_association`** | GA | **7.31.0 (5 May 2026)** | Sets the app's root agent after both exist (agent must reference its parent app at create time, so the root agent can't be set on the app inline). Completes the greenfield story. |
| `google_ces_security_settings` | **beta-only** | — | `google-beta` provider required. |

Known wrinkle: [#26231](https://github.com/hashicorp/terraform-provider-google/issues/26231) (open) — `google_ces_app` returns 400 when configuring `gemini-3-flash` + `temperature` in the `us` region.

## 2. Gaps — what can NOT be terraformed today

**Classic Conversational Agents surface:**

- **Console Integrations (Dialogflow Messenger, channels) and their unauthenticated-access settings** — the v3 API has no `integrations` collection at all ([REST index](https://docs.cloud.google.com/dialogflow/cx/docs/reference/rest)), so this is console-only, full stop. (On the CES surface this gap disappears: `google_ces_deployment` covers it.)
- **Default/Root playbook content** — the start playbook is auto-created with the agent and `google_dialogflow_cx_agent.start_playbook` only accepts that default ID. Its *instructions* can only be Terraform-managed by `terraform import`-ing the default playbook into a `google_dialogflow_cx_playbook` resource (a plain apply would create a second playbook). Awkward for greenfield.
- **Playbook `handlers`, input/output parameter definitions, `codeBlock`** — in the API, not in the Terraform schema (playbook resource is still "initial basic support").
- **Data store agents** — partially covered (agent `gen_app_builder_settings`, flow/page `knowledge_connector_settings`, tool `data_store_spec`, plus `google_discovery_engine_*` resources), but the console's guided data-store-agent creation and its restore semantics (data store agents only restore into data store agents — [agent doc](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent)) don't round-trip cleanly through Terraform.

**CES / CX Agent Studio surface:**

- **OpenAPI/MCP/connector/remote-agent tools via `google_ces_tool`** — read-only there; must go through `google_ces_toolset` (works fine, just a modelling quirk).
- **`google_ces_security_settings`** — beta provider only.
- **Gemini Enterprise CX enablement/licensing/allowlisting** and console-only UX (simulator, evaluation UI runs) — outside the `ces.v1` API.
- The **`ces-messenger` embed itself** is client-side code in your web app, not a cloud resource.

**Both:** neither `google_dialogflow_cx_agent` nor `google_ces_app` exposes `labels`, so the Snowplow tagging policy can't be applied to the agent/app objects themselves — only to supporting resources (see recommendation).

## 3. Alternatives for agent-as-code

- **(a) Export/restore APIs.**
  - Dialogflow CX v3 [`agents.export`](https://docs.cloud.google.com/dialogflow/cx/docs/reference/rest/v3/projects.locations.agents/export) / `agents.restore`: `dataFormat` = `BLOB` or `JSON_PACKAGE`, optional `agentUri` (GCS) or **`gitDestination`** (`trackingBranch` + `commitMessage` — pushes the export straight to a git branch), per-environment export. Exports "all agent data" except unused flow versions/other environments ([concept doc](https://docs.cloud.google.com/dialogflow/cx/docs/concept/agent)); for generative agents that includes playbooks/tools since they are agent content — the JSON package is the format the console Git integration round-trips.
  - CES v1 [`apps.exportApp`](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/reference/rest/v1/projects.locations.apps/exportApp) / `importApp`: `exportFormat` = `JSON` or `YAML`, optional `gcsUri`, optional `appVersion`; plus `versions.restore` for point-in-time rollback. This is the whole-app snapshot path for CX Agent Studio.
- **(b) Console Git integration** (classic surface): [Git export/restore](https://docs.cloud.google.com/dialogflow/cx/docs/concept/github) — push/pull the entire agent as JSON to GitHub/GitLab/Bitbucket, token held in Secret Manager, configured under Settings in the Conversational Agents console. Whole-agent commits (not incremental); the repo/branch must contain only agent files. Terraform can itself configure this via `google_dialogflow_cx_agent.git_integration_settings` (GitHub block only; note the `access_token` lands in state in plain text). No equivalent Git integration is documented for the new CES Agent Studio console — use `exportApp` there.
- **(c) [`dfcx-scrapi`](https://github.com/GoogleCloudPlatform/dfcx-scrapi)** — actively maintained Google Python wrapper (last commit 25 Mar 2026) over the official Dialogflow CX client; core modules include `playbooks.py`, `tools.py`, `examples.py`, `generators.py`, `data_stores.py`, `engines.py`, so it does cover the generative era — but it targets the **Dialogflow CX API only**, not `ces.v1`, so it can't manage CX Agent Studio apps.

## 4. Recommendation for this repo

The demo lives on the CES surface (design decisions 1–2 and 6 in [`docs/design.md`](../design.md)), so the `google_ces_*` family — not `google_dialogflow_cx_*` — is the right IaC target. With `hashicorp/google >= 7.31.0`, virtually the whole console setup becomes code:

1. `google_ces_app` — app shell, model selection, logging, languages.
2. `google_ces_agent` — Root Agent with `instruction = file("agent/instructions.md")` (the console-format instructions this repo already keeps as an artifact), referencing the toolset.
3. `google_ces_app_root_agent_association` — wire the Root Agent to the app.
4. `google_ces_toolset` — `open_api_toolset.open_api_schema = file("agent/openapi.yaml")` (the Snowplow Signals spec) + `api_authentication` for the Signals API key.
5. `google_ces_app_version` + `google_ces_deployment` — web-widget channel profile plus `security_settings { enable_public_access = true, enable_origin_check = true, allowed_origins = [storefront origin] }`; the deployment ID feeds `ces-messenger`'s `deployment-id` attribute and the managed token broker (`token-broker-url="MANAGED"`, backed by `sessions.generateChatToken`) needs no infrastructure of its own ([ces-messenger README](https://github.com/GoogleCloudPlatform/ces-messenger)).

**Stays manual:** Gemini Enterprise CX enablement/allowlisting in the sandbox project, simulator testing, anything needing `google_ces_security_settings` (beta provider), and the storefront-side widget snippet (already in `storefront/`). **Belt-and-braces:** snapshot the live app with `apps.exportApp` (JSON) into `agent/` after console experiments, both as backup and to diff console drift against the Terraform sources. **Tagging policy:** `ces_*`/`dialogflow_cx_*` resources have no `labels` field, so apply `system`/`snowplow-owner=cc017`/`environment=dev` at the project level and on any labelled supporting resources (e.g. a GCS export bucket) instead.

If a future variant is built on classic Conversational Agents playbooks instead: Terraform covers agent + tools + additional playbooks + generative settings, but plan to `terraform import` the default playbook to manage its instructions, and accept that Dialogflow Messenger integration config stays console-only.
