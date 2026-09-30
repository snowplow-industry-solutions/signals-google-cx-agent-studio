-- =============================================================================
-- Agent self-tracking analytics (BigQuery)
-- =============================================================================
--
-- Queries over the atomic events table for the Atelier Concierge's Snowplow
-- self-tracking: tool executions, detected intents, decisions,
-- constraint violations, the products the agent surfaced, whether shoppers
-- acted on them, and the combined shopper + agent session timeline.
--
-- How to use
--   * The FROM clauses read `PROJECT.DATASET.events`. Point them at the
--     dataset your BigQuery Loader writes to, e.g.:
--       sed -i '' 's/PROJECT\.DATASET\./my-project.my_dataset./g' analytics/*.sql
--   * Every query is self-contained: copy one block into the BigQuery console.
--   * Each query starts with the same `events` CTE: a partition filter on
--     load_tstamp (required if the table enforces partition filters) and a
--     dedup on event_id. Widen the 30-day window as needed.
--   * BigQuery Loader v2 creates one column per schema *major* version
--     (`..._1`) and only creates a column once the first good event for that
--     schema lands. A "Field name X does not exist" error therefore means no
--     such event has been loaded yet, not a typo. Drop that line and re-run.
--   * No bot filter is applied. To drop automated browser traffic, filter on
--     the YAUAA entity's agent_name (e.g. 'HeadlessChrome'); see the header of
--     analytics/ecommerce-web-analytics.sql.
--
-- Column reference (Iglu Central com.snowplow.agent.tracking 1-0-0 and the
-- repo's com.snowplow_demo.fashion 1-0-0 data structures)
--
--   unstruct_event_com_snowplow_agent_tracking_tool_execution_1
--       invocation_id, step_number, execution_duration_ms, success,
--       error_type, error_message, executed_at
--   unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1
--       invocation_id, intent_id, intent_category, confidence, reasoning, detected_at
--   unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1
--       invocation_id, decision_id, decision_type, reasoning, considerations[], logged_at
--   unstruct_event_com_snowplow_agent_tracking_constraint_violation_1
--       invocation_id, violation_id, constraint_type, user_requirement,
--       reason_not_met, alternatives_considered[], recommendation, violated_at
--   contexts_com_snowplow_agent_tracking_agent_context_1  (REPEATED, one element)
--       invocation_id, session_id (chat session), user_id, agent_type,
--       model_name, model_provider, application_version,
--       conversation_messages_count, current_step_number
--   contexts_com_snowplow_agent_tracking_tool_context_1   (REPEATED, one element)
--       tool_name, tool_category ('business' | 'self_tracking'), tool_call_id, tool_description
--   contexts_com_snowplow_demo_fashion_conversation_1      (REPEATED, one element)
--       chat_session_id, turn_id, turn_index, channel
--   contexts_com_snowplow_demo_fashion_catalog_search_1    (on searchCatalog tool_execution)
--       category, designer, occasion, color, max_price, query, limit,
--       result_count, product_ids[]
--   contexts_com_snowplow_demo_fashion_context_lookup_1    (on getUserContext tool_execution)
--       profile_returned, activity_returned, profile_attribute_count,
--       activity_event_count, signals_round_trip_ms, degraded_reason
--   Shopper-side (browser) events, same vendor:
--       unstruct_event_com_snowplow_demo_fashion_product_viewed_1        product_id, product_name
--       unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1  list_id, list_name, product_id
--       unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1   list_id, list_name, list_type, product_count
--       unstruct_event_com_snowplow_demo_fashion_cart_updated_1          action, product_id, quantity, cart_line_count
--       unstruct_event_com_snowplow_demo_fashion_checkout_started_1      checkout_step, cart_line_count
--       unstruct_event_com_snowplow_demo_fashion_checkout_completed_1    order_value, currency, item_count
--       contexts_com_snowplow_demo_fashion_product_1                     product_id, sku, product_name, designer,
--                                                                        category, color_family, occasion, price, currency
--
-- Identity threading
--   * Server-side agent events set the shopper's domain_sessionid and
--     domain_userid in the atomic columns, so agent and shopper events join on
--     domain_sessionid with no lookup table.
--   * agent_context.invocation_id is the widget's per-turn id when that id
--     reaches the tool call, shared by every tool call and self-tracking event
--     in the same turn. When it does not arrive in time, each event gets a
--     random UUID instead and conversation.turn_id is null, so a turn has to
--     be rebuilt by ordering events within the chat session (see
--     agent/README.md "Identity headers and per-turn ids").
--   * agent_context.session_id is the CX Agent Studio chat session id. Group
--     on it to rebuild a conversation.
--   * Agent events are identified by event_vendor = 'com.snowplow.agent.tracking'
--     (or platform = 'srv', or the '-agent' app_id suffix).
--   * Concierge card clicks fire product_list_clicked with
--     list_id = 'concierge_recommendations'.
--
-- Browser-side message_sent / message_received events carry the shopper's
-- domain_sessionid and a conversation entity whose turn_id matches the
-- server-side agent_context.invocation_id for the same turn. Their
-- session_id is the chat session id when the widget exposes one, otherwise
-- the domain_sessionid.
-- =============================================================================


-- =============================================================================
-- 1. TOOL USAGE
-- =============================================================================

-- 1a. Every agent tool invocation by tool, including the self-tracking tools.
--     tool_execution events are only emitted for the two business tools
--     (getUserContext, searchCatalog); the self-tracking tools emit their own
--     event type, so this counts on tool_context, which every agent event carries.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  tc.tool_category,
  tc.tool_name,
  e.event_name,
  COUNT(*)                                    AS invocations,
  COUNT(DISTINCT ac.session_id)               AS chat_sessions,
  COUNT(DISTINCT ac.invocation_id)            AS turns,
  COUNT(DISTINCT e.domain_sessionid)          AS shopper_sessions,
  MIN(e.derived_tstamp)                       AS first_seen,
  MAX(e.derived_tstamp)                       AS last_seen
FROM events e
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_tool_context_1)  AS tc
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
WHERE e.event_vendor = 'com.snowplow.agent.tracking'
GROUP BY 1, 2, 3
ORDER BY invocations DESC;


-- 1b. Business tool executions: success rate, latency percentiles, error types.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  tc.tool_name,
  COUNT(*)                                                        AS calls,
  COUNTIF(te.success)                                             AS successes,
  COUNTIF(NOT te.success)                                         AS failures,
  ROUND(SAFE_DIVIDE(COUNTIF(te.success), COUNT(*)), 3)            AS success_rate,
  APPROX_QUANTILES(te.execution_duration_ms, 100)[OFFSET(50)]     AS p50_ms,
  APPROX_QUANTILES(te.execution_duration_ms, 100)[OFFSET(95)]     AS p95_ms,
  MAX(te.execution_duration_ms)                                   AS max_ms,
  ROUND(AVG(te.execution_duration_ms))                            AS avg_ms,
  ARRAY_AGG(DISTINCT te.error_type IGNORE NULLS)                  AS error_types
FROM events e
JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_tool_context_1) AS tc
CROSS JOIN UNNEST([e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1]) AS te
WHERE e.event_name = 'tool_execution'
GROUP BY 1
ORDER BY calls DESC;


-- 1c. Tool executions per day: volume, failure count and p95 latency trend.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  DATE(e.derived_tstamp)                                                              AS day,
  tc.tool_name,
  COUNT(*)                                                                            AS calls,
  COUNTIF(NOT e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.success)  AS failures,
  APPROX_QUANTILES(
    e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.execution_duration_ms, 100
  )[OFFSET(95)]                                                                       AS p95_ms
FROM events e
JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_tool_context_1) AS tc
WHERE e.event_name = 'tool_execution'
GROUP BY 1, 2
ORDER BY 1, 2;


-- 1d. getUserContext quality: how often the agent actually had Signals context.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  cl.degraded_reason,
  cl.profile_returned,
  cl.activity_returned,
  COUNT(*)                                                     AS lookups,
  ROUND(AVG(cl.profile_attribute_count), 1)                    AS avg_profile_attributes,
  ROUND(AVG(cl.activity_event_count), 1)                       AS avg_activity_events,
  APPROX_QUANTILES(cl.signals_round_trip_ms, 100)[OFFSET(50)]  AS signals_p50_ms,
  APPROX_QUANTILES(cl.signals_round_trip_ms, 100)[OFFSET(95)]  AS signals_p95_ms
FROM events e
JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_context_lookup_1) AS cl
WHERE e.event_name = 'tool_execution'
GROUP BY 1, 2, 3
ORDER BY lookups DESC;


-- 1e. searchCatalog filters and catalog gaps: which filter combinations the
--     agent uses and which return nothing.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  cs.category,
  cs.designer,
  cs.occasion,
  cs.color,
  CASE
    WHEN cs.max_price IS NULL   THEN 'no budget'
    WHEN cs.max_price < 500     THEN '< 500'
    WHEN cs.max_price < 1000    THEN '500-999'
    WHEN cs.max_price < 2000    THEN '1000-1999'
    ELSE '2000+'
  END                                              AS budget_band,
  cs.query IS NOT NULL                             AS used_free_text,
  COUNT(*)                                         AS searches,
  COUNTIF(cs.result_count = 0)                     AS zero_result_searches,
  ROUND(AVG(cs.result_count), 1)                   AS avg_results,
  ARRAY_AGG(DISTINCT cs.query IGNORE NULLS LIMIT 5) AS sample_queries
FROM events e
JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
WHERE e.event_name = 'tool_execution'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY searches DESC;


-- =============================================================================
-- 2. INTENTS AND DECISIONS (REASONING)
-- =============================================================================

-- 2a. Detected intent distribution with confidence.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  ui.intent_category,
  COUNT(*)                                            AS intents,
  COUNT(DISTINCT ac.session_id)                       AS chat_sessions,
  ROUND(AVG(ui.confidence), 3)                        AS avg_confidence,
  ROUND(MIN(ui.confidence), 2)                        AS min_confidence,
  COUNTIF(ui.confidence < 0.6)                        AS low_confidence_intents,
  ARRAY_AGG(ui.reasoning IGNORE NULLS ORDER BY e.derived_tstamp DESC LIMIT 3) AS recent_reasoning
FROM events e
CROSS JOIN UNNEST([e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1]) AS ui
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
WHERE e.event_name = 'user_intent_detected'
GROUP BY 1
ORDER BY intents DESC;


-- 2b. Decisions by type, with the most common considerations the agent weighed.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
decisions AS (
  SELECT
    e.event_id,
    e.derived_tstamp,
    e.unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1 AS d
  FROM events e
  WHERE e.event_name = 'agent_decision_logged'
)
SELECT
  d.decision_type,
  COUNT(*)                                          AS decisions,
  ROUND(AVG(ARRAY_LENGTH(d.considerations)), 1)     AS avg_considerations,
  ROUND(AVG(LENGTH(d.reasoning)))                   AS avg_reasoning_chars,
  ARRAY(
    SELECT AS STRUCT LOWER(c) AS consideration, COUNT(*) AS n
    FROM decisions d2, UNNEST(d2.d.considerations) AS c
    WHERE d2.d.decision_type = d.decision_type
    GROUP BY 1 ORDER BY n DESC LIMIT 10
  )                                                 AS top_considerations,
  ARRAY_AGG(d.reasoning ORDER BY derived_tstamp DESC LIMIT 3) AS recent_reasoning
FROM decisions
GROUP BY d.decision_type
ORDER BY decisions DESC;


-- 2c. Reasoning text mining without an LLM: top words and bigrams across
--     decision reasoning (swap in user_intent_detected.reasoning or
--     constraint_violation.reason_not_met the same way).
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
reasoning AS (
  SELECT
    unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.decision_type AS decision_type,
    REGEXP_EXTRACT_ALL(LOWER(unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.reasoning), r'[a-z][a-z\-]{2,}') AS tokens
  FROM events
  WHERE event_name = 'agent_decision_logged'
),
stopwords AS (
  SELECT w FROM UNNEST([
    'the','and','for','with','that','this','the','are','was','has','have','from','their','they','them',
    'will','would','can','into','but','not','you','your','our','its','also','been','which','than',
    'then','when','who','what','how','all','any','each','more','most','some','such','only','other',
    'about','after','before','because','while','where','there','here','these','those','over','under',
    'shopper','user','customer','agent','concierge'
  ]) AS w
),
unigrams AS (
  SELECT r.decision_type, t AS term, 'word' AS kind
  FROM reasoning r, UNNEST(r.tokens) AS t
  WHERE t NOT IN (SELECT w FROM stopwords)
),
bigrams AS (
  SELECT r.decision_type, b AS term, 'bigram' AS kind
  FROM reasoning r, UNNEST(ML.NGRAMS(r.tokens, [2, 2], ' ')) AS b
  WHERE SPLIT(b, ' ')[OFFSET(0)] NOT IN (SELECT w FROM stopwords)
    AND SPLIT(b, ' ')[OFFSET(1)] NOT IN (SELECT w FROM stopwords)
)
SELECT kind, decision_type, term, COUNT(*) AS occurrences
FROM (SELECT * FROM unigrams UNION ALL SELECT * FROM bigrams)
GROUP BY 1, 2, 3
QUALIFY ROW_NUMBER() OVER (PARTITION BY kind, decision_type ORDER BY occurrences DESC) <= 15
ORDER BY kind, decision_type, occurrences DESC;


-- 2d. LLM theming of the reasoning with BigQuery's built-in Gemini function.
--     One-time setup (once per project):
--       1. Create a Cloud resource connection in the dataset's region:
--            bq mk --connection --location=REGION --connection_type=CLOUD_RESOURCE gemini_conn
--       2. Grant the connection's service account roles/aiplatform.user.
--     Then replace PROJECT.REGION.gemini_conn below. AI.GENERATE returns a
--     STRUCT; .result is the text. Cost is per row, so this query samples.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sample AS (
  SELECT
    unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.decision_type AS decision_type,
    unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.reasoning     AS reasoning
  FROM events
  WHERE event_name = 'agent_decision_logged'
  ORDER BY derived_tstamp DESC
  LIMIT 200
),
themed AS (
  SELECT
    decision_type,
    reasoning,
    AI.GENERATE(
      (
        'A fashion shopping assistant logged the decision rationale below. ',
        'Reply with ONE lowercase theme label of 2-4 words describing the main driver of the decision ',
        '(for example "budget constraint", "occasion match", "designer preference", "widget vs text", ',
        '"clarifying question", "signals context used"). Reply with the label only. Rationale: ',
        reasoning
      ),
      connection_id => 'PROJECT.REGION.gemini_conn',
      endpoint      => 'gemini-2.5-flash'
    ).result AS theme
  FROM sample
)
SELECT
  decision_type,
  LOWER(TRIM(theme))                                    AS theme,
  COUNT(*)                                              AS decisions,
  ARRAY_AGG(reasoning LIMIT 2)                          AS examples
FROM themed
GROUP BY 1, 2
ORDER BY decisions DESC;


-- =============================================================================
-- 3. AGENT SPLIT (model / prompt / deployment)
-- =============================================================================

-- 3a. Everything the agent_context entity can split on, with headline metrics.
--     Only model_name (AGENT_MODEL_NAME env var) and app_id vary between
--     deployments; application_version is never populated by the storefront.
--     To compare prompt versions, set AGENT_MODEL_NAME per deploy or populate
--     application_version with the CX Agent Studio app version.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  e.app_id,
  ac.agent_type,
  ac.model_provider,
  ac.model_name,
  ac.application_version,
  COUNT(DISTINCT ac.session_id)                                                       AS chat_sessions,
  COUNT(DISTINCT ac.invocation_id)                                                    AS turns,
  COUNTIF(e.event_name = 'tool_execution')                                            AS tool_calls,
  ROUND(SAFE_DIVIDE(
    COUNTIF(e.event_name = 'tool_execution'
            AND NOT e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.success),
    COUNTIF(e.event_name = 'tool_execution')), 3)                                     AS tool_failure_rate,
  APPROX_QUANTILES(
    IF(e.event_name = 'tool_execution',
       e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.execution_duration_ms, NULL),
    100)[OFFSET(50)]                                                                  AS tool_p50_ms,
  COUNTIF(e.event_name = 'user_intent_detected')                                      AS intents,
  ROUND(AVG(e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.confidence), 3)
                                                                                      AS avg_intent_confidence,
  COUNTIF(e.event_name = 'agent_decision_logged')                                     AS decisions,
  COUNTIF(e.event_name = 'constraint_violation')                                      AS constraint_violations,
  ROUND(SAFE_DIVIDE(COUNTIF(e.event_name = 'constraint_violation'),
                    COUNT(DISTINCT ac.invocation_id)), 3)                             AS violations_per_turn
FROM events e
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
WHERE e.event_vendor = 'com.snowplow.agent.tracking'
GROUP BY 1, 2, 3, 4, 5
ORDER BY chat_sessions DESC;


-- 3b. Self-tracking protocol compliance per agent variant: does each turn get
--     exactly one intent and at most one decision, as the instructions ask?
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
turns AS (
  SELECT
    ac.model_name,
    e.app_id,
    ac.invocation_id                                                                   AS turn_id,
    COUNTIF(e.event_name = 'tool_execution')                                           AS tool_calls,
    COUNTIF(e.event_name = 'tool_execution' AND tc.tool_name = 'getUserContext')       AS context_lookups,
    COUNTIF(e.event_name = 'tool_execution' AND tc.tool_name = 'searchCatalog')        AS catalog_searches,
    COUNTIF(e.event_name = 'user_intent_detected')                                     AS intents,
    COUNTIF(e.event_name = 'agent_decision_logged')                                    AS decisions,
    COUNTIF(e.event_name = 'constraint_violation')                                     AS violations
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
  LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_tool_context_1) AS tc
  WHERE e.event_vendor = 'com.snowplow.agent.tracking'
  GROUP BY 1, 2, 3
)
SELECT
  model_name,
  app_id,
  COUNT(*)                                          AS turns,
  ROUND(AVG(tool_calls), 2)                         AS avg_tool_calls_per_turn,
  ROUND(SAFE_DIVIDE(COUNTIF(intents = 1), COUNT(*)), 3)      AS share_turns_with_one_intent,
  ROUND(SAFE_DIVIDE(COUNTIF(intents = 0), COUNT(*)), 3)      AS share_turns_missing_intent,
  ROUND(SAFE_DIVIDE(COUNTIF(intents > 1), COUNT(*)), 3)      AS share_turns_over_tracking_intent,
  ROUND(SAFE_DIVIDE(COUNTIF(catalog_searches > 0 AND decisions = 0), COUNTIF(catalog_searches > 0)), 3)
                                                    AS share_searches_without_decision,
  ROUND(SAFE_DIVIDE(COUNTIF(decisions > 1), COUNT(*)), 3)    AS share_turns_over_tracking_decision,
  ROUND(SAFE_DIVIDE(COUNTIF(violations > 0), COUNT(*)), 3)   AS share_turns_with_violation
FROM turns
GROUP BY 1, 2
ORDER BY turns DESC;


-- =============================================================================
-- 4. CONSTRAINT VIOLATIONS
-- =============================================================================

-- 4a. What the catalog keeps failing to satisfy, and what the agent did about it.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
violations AS (
  SELECT
    e.derived_tstamp,
    e.domain_sessionid,
    e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1 AS cv,
    ac.session_id AS chat_session_id
  FROM events e
  LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
  WHERE e.event_name = 'constraint_violation'
)
SELECT
  cv.constraint_type,
  COUNT(*)                                                          AS violations,
  COUNT(DISTINCT chat_session_id)                                   AS chat_sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(cv.recommendation IS NOT NULL), COUNT(*)), 3)
                                                                    AS share_with_alternative_recommended,
  ROUND(AVG(ARRAY_LENGTH(cv.alternatives_considered)), 1)           AS avg_alternatives_considered,
  ARRAY_AGG(STRUCT(cv.user_requirement, cv.reason_not_met, cv.recommendation)
            ORDER BY derived_tstamp DESC LIMIT 5)                    AS recent_examples
FROM violations
GROUP BY 1
ORDER BY violations DESC;


-- 4b. The specific requirements that fail most often (normalised free text),
--     as merchandising signals.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  cv.constraint_type,
  LOWER(TRIM(REGEXP_REPLACE(cv.user_requirement, r'[^\w\s£$€]', ''))) AS requirement,
  COUNT(*)                                                              AS times_unmet,
  ARRAY_AGG(DISTINCT cv.reason_not_met LIMIT 3)                         AS reasons,
  ARRAY_AGG(DISTINCT cv.recommendation IGNORE NULLS LIMIT 3)            AS alternatives_offered
FROM events e
CROSS JOIN UNNEST([e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1]) AS cv
WHERE e.event_name = 'constraint_violation'
GROUP BY 1, 2
ORDER BY times_unmet DESC
LIMIT 50;


-- 4c. Which catalog searches led to a violation in the same turn: the filter
--     combination that triggered it, and whether the search was empty or
--     just not good enough.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
searches AS (
  SELECT
    e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.invocation_id AS turn_id,
    cs.category, cs.designer, cs.occasion, cs.color, cs.max_price, cs.query, cs.result_count
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  WHERE e.event_name = 'tool_execution'
),
violations AS (
  SELECT
    cv.invocation_id AS turn_id,
    cv.constraint_type,
    cv.user_requirement
  FROM events e
  CROSS JOIN UNNEST([e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1]) AS cv
  WHERE e.event_name = 'constraint_violation'
)
SELECT
  v.constraint_type,
  s.category, s.designer, s.occasion, s.color, s.max_price,
  COUNT(*)                                   AS violations,
  COUNTIF(s.result_count = 0)                AS from_empty_search,
  COUNTIF(s.result_count > 0)                AS from_non_empty_search,
  ARRAY_AGG(DISTINCT v.user_requirement LIMIT 3) AS sample_requirements
FROM violations v
JOIN searches s USING (turn_id)
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY violations DESC;


-- =============================================================================
-- 5. WHAT THE AGENT RECOMMENDS
-- =============================================================================

-- 5a. Products most often returned by the agent's catalog searches (the best
--     available proxy for "recommended": the agent renders these as cards).
--     Product names come from the product entity on any shopper-side event.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
product_dim AS (
  SELECT
    p.product_id,
    ANY_VALUE(p.product_name)  AS product_name,
    ANY_VALUE(p.designer)      AS designer,
    ANY_VALUE(p.category)      AS category,
    ANY_VALUE(p.price)         AS price
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  GROUP BY 1
),
surfaced AS (
  SELECT
    pid                          AS product_id,
    pos                          AS position_in_results,
    e.domain_sessionid,
    ac.session_id                AS chat_session_id
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  LEFT JOIN UNNEST(cs.product_ids) AS pid WITH OFFSET AS pos
  LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
  WHERE e.event_name = 'tool_execution'
)
SELECT
  s.product_id,
  d.product_name,
  d.designer,
  d.category,
  d.price,
  COUNT(*)                                        AS times_surfaced,
  COUNT(DISTINCT s.chat_session_id)               AS chat_sessions,
  COUNTIF(s.position_in_results = 0)              AS times_first_result,
  ROUND(AVG(s.position_in_results), 2)            AS avg_position
FROM surfaced s
LEFT JOIN product_dim d USING (product_id)
GROUP BY 1, 2, 3, 4, 5
ORDER BY times_surfaced DESC
LIMIT 50;


-- 5b. Designer / category mix the agent surfaces vs. what shoppers view on
--     their own: is the concierge steering towards a slice of the catalog?
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
product_dim AS (
  SELECT p.product_id, ANY_VALUE(p.designer) AS designer, ANY_VALUE(p.category) AS category
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  GROUP BY 1
),
agent_surfaced AS (
  SELECT d.designer, d.category, COUNT(*) AS n
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  JOIN UNNEST(cs.product_ids) AS pid
  LEFT JOIN product_dim d ON d.product_id = pid
  WHERE e.event_name = 'tool_execution'
  GROUP BY 1, 2
),
shopper_viewed AS (
  SELECT p.designer, p.category, COUNT(*) AS n
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  WHERE e.event_name = 'product_viewed'
  GROUP BY 1, 2
)
SELECT
  COALESCE(a.designer, s.designer)                       AS designer,
  COALESCE(a.category, s.category)                       AS category,
  IFNULL(a.n, 0)                                         AS agent_surfaced,
  ROUND(SAFE_DIVIDE(a.n, SUM(a.n) OVER ()), 3)           AS agent_share,
  IFNULL(s.n, 0)                                         AS shopper_views,
  ROUND(SAFE_DIVIDE(s.n, SUM(s.n) OVER ()), 3)           AS shopper_share
FROM agent_surfaced a
FULL OUTER JOIN shopper_viewed s USING (designer, category)
ORDER BY agent_surfaced DESC;


-- =============================================================================
-- 6. DO SHOPPERS ACT ON THE RECOMMENDATIONS?
-- =============================================================================

-- 6a. Concierge card clicks by product, with click-through rate against how
--     often the product was surfaced.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
surfaced AS (
  SELECT pid AS product_id, COUNT(*) AS times_surfaced, COUNT(DISTINCT e.domain_sessionid) AS sessions_surfaced
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  JOIN UNNEST(cs.product_ids) AS pid
  WHERE e.event_name = 'tool_execution'
  GROUP BY 1
),
clicks AS (
  SELECT
    e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id AS product_id,
    ANY_VALUE(p.product_name)                                                     AS product_name,
    COUNT(*)                                                                      AS clicks,
    COUNT(DISTINCT e.domain_sessionid)                                            AS sessions_clicked
  FROM events e
  LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  WHERE e.event_name = 'product_list_clicked'
    AND e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id = 'concierge_recommendations'
  GROUP BY 1
)
SELECT
  s.product_id,
  c.product_name,
  s.times_surfaced,
  s.sessions_surfaced,
  IFNULL(c.clicks, 0)                                          AS concierge_clicks,
  IFNULL(c.sessions_clicked, 0)                                AS sessions_clicked,
  ROUND(SAFE_DIVIDE(c.sessions_clicked, s.sessions_surfaced), 3) AS session_ctr
FROM surfaced s
LEFT JOIN clicks c USING (product_id)
ORDER BY concierge_clicks DESC, times_surfaced DESC;


-- 6b. Recommendation funnel per (session, product): surfaced by the agent ->
--     concierge card clicked -> product page viewed -> added to cart ->
--     session checked out. Every downstream step must occur after the
--     recommendation.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
recommended AS (
  SELECT e.domain_sessionid, pid AS product_id,
         MIN(e.derived_tstamp) AS first_recommended_at, COUNT(*) AS times_recommended
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  JOIN UNNEST(cs.product_ids) AS pid
  WHERE e.event_name = 'tool_execution' AND e.domain_sessionid IS NOT NULL
  GROUP BY 1, 2
),
clicked AS (
  SELECT domain_sessionid,
         unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id AS product_id,
         MIN(derived_tstamp) AS first_click_at
  FROM events
  WHERE event_name = 'product_list_clicked'
    AND unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id = 'concierge_recommendations'
  GROUP BY 1, 2
),
viewed AS (
  SELECT domain_sessionid,
         unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_id AS product_id,
         ARRAY_AGG(derived_tstamp ORDER BY derived_tstamp) AS view_times
  FROM events
  WHERE event_name = 'product_viewed'
  GROUP BY 1, 2
),
added AS (
  SELECT domain_sessionid,
         unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id AS product_id,
         ARRAY_AGG(derived_tstamp ORDER BY derived_tstamp) AS add_times
  FROM events
  WHERE event_name = 'cart_updated'
    AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart'
  GROUP BY 1, 2
),
purchased AS (
  SELECT domain_sessionid, MAX(derived_tstamp) AS last_checkout_at
  FROM events
  WHERE event_name = 'checkout_completed'
  GROUP BY 1
),
funnel AS (
  SELECT
    r.domain_sessionid,
    r.product_id,
    r.first_recommended_at,
    c.first_click_at > r.first_recommended_at                                                  AS clicked_after,
    (SELECT COUNT(*) > 0 FROM UNNEST(v.view_times) t WHERE t > r.first_recommended_at)          AS viewed_after,
    (SELECT COUNT(*) > 0 FROM UNNEST(a.add_times) t WHERE t > r.first_recommended_at)           AS added_after,
    p.last_checkout_at > r.first_recommended_at                                                 AS purchased_after
  FROM recommended r
  LEFT JOIN clicked   c USING (domain_sessionid, product_id)
  LEFT JOIN viewed    v USING (domain_sessionid, product_id)
  LEFT JOIN added     a USING (domain_sessionid, product_id)
  LEFT JOIN purchased p USING (domain_sessionid)
)
SELECT
  COUNT(*)                                                     AS recommended_session_products,
  COUNT(DISTINCT domain_sessionid)                             AS sessions_with_recommendations,
  COUNTIF(clicked_after)                                       AS clicked,
  COUNTIF(viewed_after)                                        AS viewed,
  COUNTIF(added_after)                                         AS added_to_cart,
  COUNTIF(purchased_after)                                     AS session_purchased,
  ROUND(SAFE_DIVIDE(COUNTIF(clicked_after), COUNT(*)), 3)      AS click_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(viewed_after), COUNT(*)), 3)       AS view_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(added_after), COUNT(*)), 3)        AS add_to_cart_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(added_after), COUNTIF(clicked_after)), 3) AS add_to_cart_rate_given_click
FROM funnel;


-- 6c. Same funnel, by product: which recommendations convert.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
product_dim AS (
  SELECT p.product_id, ANY_VALUE(p.product_name) AS product_name, ANY_VALUE(p.designer) AS designer
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  GROUP BY 1
),
recommended AS (
  SELECT e.domain_sessionid, pid AS product_id, MIN(e.derived_tstamp) AS first_recommended_at
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  JOIN UNNEST(cs.product_ids) AS pid
  WHERE e.event_name = 'tool_execution' AND e.domain_sessionid IS NOT NULL
  GROUP BY 1, 2
),
clicked AS (
  SELECT domain_sessionid,
         unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id AS product_id,
         MIN(derived_tstamp) AS first_click_at
  FROM events
  WHERE event_name = 'product_list_clicked'
    AND unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id = 'concierge_recommendations'
  GROUP BY 1, 2
),
added AS (
  SELECT domain_sessionid,
         unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id AS product_id,
         MAX(derived_tstamp) AS last_add_at
  FROM events
  WHERE event_name = 'cart_updated'
    AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart'
  GROUP BY 1, 2
)
SELECT
  r.product_id,
  d.product_name,
  d.designer,
  COUNT(*)                                                             AS sessions_recommended,
  COUNTIF(c.first_click_at > r.first_recommended_at)                   AS sessions_clicked,
  COUNTIF(a.last_add_at   > r.first_recommended_at)                    AS sessions_added_to_cart,
  ROUND(SAFE_DIVIDE(COUNTIF(c.first_click_at > r.first_recommended_at), COUNT(*)), 3) AS click_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(a.last_add_at   > r.first_recommended_at), COUNT(*)), 3) AS add_to_cart_rate
FROM recommended r
LEFT JOIN clicked c USING (domain_sessionid, product_id)
LEFT JOIN added   a USING (domain_sessionid, product_id)
LEFT JOIN product_dim d ON d.product_id = r.product_id
GROUP BY 1, 2, 3
ORDER BY sessions_recommended DESC;


-- =============================================================================
-- 7. USER JOURNEY: SHOPPER + AGENT TOGETHER
-- =============================================================================

-- 7a. Agent-assisted vs. unassisted sessions. A session is agent-assisted if
--     any agent event carries its domain_sessionid. Read with care: shoppers
--     who open the concierge are self-selected, so this is a descriptive
--     comparison, not a causal lift.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    domain_sessionid,
    LOGICAL_OR(event_vendor = 'com.snowplow.agent.tracking')                           AS agent_assisted,
    COUNTIF(event_vendor = 'com.snowplow.agent.tracking')                              AS agent_events,
    COUNT(DISTINCT IF(event_vendor = 'com.snowplow.agent.tracking',
                      contexts_com_snowplow_agent_tracking_agent_context_1[SAFE_OFFSET(0)].invocation_id, NULL))
                                                                                       AS agent_turns,
    COUNTIF(event_name = 'page_view')                                                  AS page_views,
    COUNTIF(event_name = 'product_viewed')                                             AS product_views,
    COUNT(DISTINCT IF(event_name = 'product_viewed',
                      unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_id, NULL))
                                                                                       AS distinct_products_viewed,
    COUNTIF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart')
                                                                                       AS add_to_carts,
    COUNTIF(event_name = 'checkout_started') > 0                                       AS started_checkout,
    COUNTIF(event_name = 'checkout_completed') > 0                                     AS purchased,
    MAX(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value)     AS order_value,
    TIMESTAMP_DIFF(MAX(derived_tstamp), MIN(derived_tstamp), SECOND)                   AS duration_s
  FROM events
  WHERE domain_sessionid IS NOT NULL
  GROUP BY 1
)
SELECT
  agent_assisted,
  COUNT(*)                                                  AS sessions,
  ROUND(AVG(agent_turns), 1)                                AS avg_agent_turns,
  ROUND(AVG(page_views), 1)                                 AS avg_page_views,
  ROUND(AVG(product_views), 1)                              AS avg_product_views,
  ROUND(AVG(distinct_products_viewed), 1)                   AS avg_distinct_products_viewed,
  ROUND(AVG(add_to_carts), 2)                               AS avg_add_to_carts,
  ROUND(SAFE_DIVIDE(COUNTIF(add_to_carts > 0), COUNT(*)), 3)  AS add_to_cart_session_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(started_checkout), COUNT(*)), 3)  AS checkout_start_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 3)         AS purchase_rate,
  ROUND(AVG(IF(purchased, order_value, NULL)), 2)           AS avg_order_value,
  ROUND(AVG(duration_s))                                    AS avg_session_seconds
FROM sessions
GROUP BY 1
ORDER BY 1 DESC;


-- 7b. Before vs. after the first agent turn, within agent-assisted sessions:
--     does shopping behaviour change once the concierge is involved?
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
first_agent AS (
  SELECT domain_sessionid, MIN(derived_tstamp) AS first_agent_at
  FROM events
  WHERE event_vendor = 'com.snowplow.agent.tracking' AND domain_sessionid IS NOT NULL
  GROUP BY 1
),
phased AS (
  SELECT
    e.domain_sessionid,
    IF(e.derived_tstamp < f.first_agent_at, 'before_agent', 'after_agent') AS phase,
    e.event_name,
    e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action AS cart_action,
    e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id AS list_id
  FROM events e
  JOIN first_agent f USING (domain_sessionid)
  WHERE e.event_vendor != 'com.snowplow.agent.tracking'
)
SELECT
  phase,
  COUNT(DISTINCT domain_sessionid)                                   AS sessions,
  COUNTIF(event_name = 'page_view')                                  AS page_views,
  COUNTIF(event_name = 'product_viewed')                             AS product_views,
  COUNTIF(event_name = 'product_list_clicked'
          AND list_id = 'concierge_recommendations')                 AS concierge_card_clicks,
  COUNTIF(event_name = 'product_list_clicked'
          AND list_id != 'concierge_recommendations')                AS other_list_clicks,
  COUNTIF(event_name = 'cart_updated' AND cart_action = 'add_to_cart') AS add_to_carts,
  COUNTIF(event_name = 'checkout_started')                           AS checkouts_started,
  COUNTIF(event_name = 'checkout_completed')                         AS checkouts_completed
FROM phased
GROUP BY 1
ORDER BY 1 DESC;


-- 7c. One session's full timeline, shopper and agent events interleaved.
--     Defaults to the most recent agent-assisted session; replace the
--     `target` CTE with a literal domain_sessionid to inspect a specific one.
--     The message_received and message_context columns only exist once the
--     first browser message event has loaded; until then this query fails
--     with "Name ... not found" on those columns.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
target AS (
  SELECT domain_sessionid
  FROM events
  WHERE event_vendor = 'com.snowplow.agent.tracking' AND domain_sessionid IS NOT NULL
  ORDER BY derived_tstamp DESC
  LIMIT 1
  -- or: SELECT 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' AS domain_sessionid
)
SELECT
  e.derived_tstamp,
  CASE
    WHEN e.event_name = 'message_sent' THEN 'shopper'
    WHEN e.event_vendor = 'com.snowplow.agent.tracking' THEN 'agent'
    ELSE 'shopper'
  END                                                                     AS actor,
  e.event_name,
  COALESCE(ac.invocation_id, cv.turn_id)                                  AS turn_id,
  tc.tool_name,
  CASE e.event_name
    WHEN 'page_view' THEN e.page_urlpath
    WHEN 'product_list_viewed' THEN FORMAT('%s (%d products)',
        e.unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.list_id,
        e.unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.product_count)
    WHEN 'product_list_clicked' THEN FORMAT('%s -> %s',
        e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id,
        IFNULL(p.product_name, e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id))
    WHEN 'product_viewed' THEN e.unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_name
    WHEN 'cart_updated' THEN FORMAT('%s %s',
        e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action,
        IFNULL(p.product_name, e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id))
    WHEN 'checkout_started' THEN e.unstruct_event_com_snowplow_demo_fashion_checkout_started_1.checkout_step
    WHEN 'checkout_completed' THEN FORMAT('order %t %s',
        e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value,
        e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.currency)
    WHEN 'tool_execution' THEN FORMAT('%s %s in %dms%s',
        tc.tool_name,
        IF(e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.success, 'ok', 'FAILED'),
        e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.execution_duration_ms,
        IFNULL(FORMAT(' | %d results: %s', cs.result_count, ARRAY_TO_STRING(cs.product_ids, ', ')), ''))
    WHEN 'user_intent_detected' THEN FORMAT('%s (%.2f) %s',
        e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.intent_category,
        e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.confidence,
        IFNULL(e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.reasoning, ''))
    WHEN 'agent_decision_logged' THEN FORMAT('%s: %s',
        e.unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.decision_type,
        e.unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.reasoning)
    WHEN 'constraint_violation' THEN FORMAT('%s: "%s" -> %s',
        e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1.constraint_type,
        e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1.user_requirement,
        e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1.reason_not_met)
    WHEN 'message_sent' THEN IFNULL(mc.message_preview, FORMAT('%d chars', mc.message_length))
    WHEN 'message_received' THEN FORMAT('%dms | %s',
        e.unstruct_event_com_snowplow_agent_tracking_message_received_1.response_time_ms,
        IFNULL(mc.message_preview, FORMAT('%d chars', mc.message_length)))
    ELSE NULL
  END                                                                     AS detail
FROM events e
JOIN target t USING (domain_sessionid)
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_tool_context_1)  AS tc
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_message_context_1) AS mc
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_conversation_1)    AS cv
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1)  AS cs
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_product_1)         AS p
WHERE e.event_name != 'page_ping'
ORDER BY e.derived_tstamp, e.dvce_created_tstamp;


-- 7d. Turn-level reconstruction: one row per agent turn with what the agent
--     detected, decided, searched for and got back, plus the shopper's next
--     action after the turn.
--     `tool_calls` below is the source of truth for tool calls per turn. The
--     browser's message_received.tool_calls_count is a schema-required
--     placeholder that is always 0 (the widget cannot see server-side tool
--     calls) and must not be read as a count.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
turns AS (
  SELECT
    ac.session_id                                                                     AS chat_session_id,
    ac.invocation_id                                                                  AS turn_id,
    ANY_VALUE(e.domain_sessionid)                                                     AS domain_sessionid,
    MIN(e.derived_tstamp)                                                             AS turn_started_at,
    MAX(e.derived_tstamp)                                                             AS turn_ended_at,
    ANY_VALUE(e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.intent_category)   AS intent,
    ANY_VALUE(e.unstruct_event_com_snowplow_agent_tracking_user_intent_detected_1.confidence)        AS intent_confidence,
    ARRAY_AGG(e.unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.decision_type IGNORE NULLS) AS decision_types,
    ANY_VALUE(e.unstruct_event_com_snowplow_agent_tracking_agent_decision_logged_1.reasoning)        AS decision_reasoning,
    ARRAY_AGG(e.unstruct_event_com_snowplow_agent_tracking_constraint_violation_1.constraint_type IGNORE NULLS) AS constraint_types,
    COUNTIF(e.event_name = 'tool_execution')                                          AS tool_calls,
    LOGICAL_OR(e.event_name = 'tool_execution'
               AND NOT e.unstruct_event_com_snowplow_agent_tracking_tool_execution_1.success) AS any_tool_failed,
    ANY_VALUE(cs.result_count)                                                        AS search_results,
    ANY_VALUE(cs.product_ids)                                                         AS surfaced_product_ids,
    ANY_VALUE(cl.degraded_reason)                                                     AS context_degraded_reason
  FROM events e
  JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_agent_context_1) AS ac
  LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_context_lookup_1) AS cl
  WHERE e.event_vendor = 'com.snowplow.agent.tracking'
  GROUP BY 1, 2
),
shopper_actions AS (
  SELECT
    domain_sessionid,
    derived_tstamp,
    event_name,
    COALESCE(
      unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id,
      unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_id,
      unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id) AS product_id,
    unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id AS list_id
  FROM events
  WHERE event_name IN ('product_list_clicked', 'product_viewed', 'cart_updated', 'checkout_started', 'checkout_completed')
)
SELECT
  t.*,
  TIMESTAMP_DIFF(t.turn_ended_at, t.turn_started_at, MILLISECOND) AS turn_span_ms,
  next_action.event_name                                          AS next_shopper_event,
  next_action.product_id                                          AS next_shopper_product_id,
  next_action.product_id IN UNNEST(t.surfaced_product_ids)        AS next_product_was_surfaced,
  TIMESTAMP_DIFF(next_action.derived_tstamp, t.turn_ended_at, SECOND) AS seconds_to_next_shopper_event
FROM turns t
LEFT JOIN (
  SELECT
    t.turn_id,
    ARRAY_AGG(STRUCT(s.event_name, s.product_id, s.derived_tstamp)
              ORDER BY s.derived_tstamp LIMIT 1)[SAFE_OFFSET(0)] AS next_action
  FROM turns t
  JOIN shopper_actions s
    ON s.domain_sessionid = t.domain_sessionid
   AND s.derived_tstamp > t.turn_ended_at
  GROUP BY 1
) n USING (turn_id)
ORDER BY t.turn_started_at DESC;


-- 7e. Concierge adoption and outcomes by device. Server-side agent events
--     carry no user agent of their own (they come from the Node tracker), so
--     each session's device is taken from the YAUAA entity on its browser
--     events and joined on domain_sessionid. Shows whether phone shoppers open
--     the concierge more or less than desktop shoppers, how deep their
--     conversations go, and how assisted vs. unassisted sessions convert on
--     each device class.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
session_device AS (
  SELECT
    e.domain_sessionid,
    ANY_VALUE(ua.device_class)  AS device_class,
    ANY_VALUE(ua.agent_name)    AS browser,
    ANY_VALUE(ua.operating_system_name) AS os
  FROM events e
  JOIN UNNEST(e.contexts_nl_basjes_yauaa_context_1) AS ua
  WHERE e.platform = 'web' AND e.domain_sessionid IS NOT NULL
  GROUP BY 1
),
sessions AS (
  SELECT
    e.domain_sessionid,
    IFNULL(d.device_class, 'unknown')                                                  AS device_class,
    LOGICAL_OR(e.event_vendor = 'com.snowplow.agent.tracking')                         AS agent_assisted,
    COUNT(DISTINCT IF(e.event_vendor = 'com.snowplow.agent.tracking',
                      e.contexts_com_snowplow_agent_tracking_agent_context_1[SAFE_OFFSET(0)].invocation_id, NULL))
                                                                                       AS agent_turns,
    COUNTIF(e.event_name = 'product_list_clicked'
            AND e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id = 'concierge_recommendations')
                                                                                       AS concierge_card_clicks,
    COUNTIF(e.event_name = 'constraint_violation')                                     AS constraint_violations,
    COUNTIF(e.event_name = 'cart_updated'
            AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') AS add_to_carts,
    COUNTIF(e.event_name = 'checkout_completed') > 0                                   AS purchased,
    MAX(e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value)   AS order_value
  FROM events e
  LEFT JOIN session_device d USING (domain_sessionid)
  WHERE e.domain_sessionid IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  device_class,
  COUNT(*)                                                                    AS sessions,
  COUNTIF(agent_assisted)                                                     AS agent_assisted_sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(agent_assisted), COUNT(*)), 3)                    AS concierge_open_rate,
  ROUND(AVG(IF(agent_assisted, agent_turns, NULL)), 2)                        AS avg_turns_when_used,
  SUM(concierge_card_clicks)                                                  AS concierge_card_clicks,
  ROUND(SAFE_DIVIDE(SUM(concierge_card_clicks), COUNTIF(agent_assisted)), 2)  AS card_clicks_per_assisted_session,
  SUM(constraint_violations)                                                  AS constraint_violations,
  ROUND(SAFE_DIVIDE(COUNTIF(agent_assisted AND add_to_carts > 0), COUNTIF(agent_assisted)), 3)         AS assisted_add_to_cart_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(NOT agent_assisted AND add_to_carts > 0), COUNTIF(NOT agent_assisted)), 3) AS unassisted_add_to_cart_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(agent_assisted AND purchased), COUNTIF(agent_assisted)), 3)                AS assisted_purchase_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(NOT agent_assisted AND purchased), COUNTIF(NOT agent_assisted)), 3)        AS unassisted_purchase_rate,
  ROUND(AVG(IF(purchased, order_value, NULL)), 2)                             AS avg_order_value
FROM sessions
GROUP BY 1
ORDER BY sessions DESC;


-- 7f. Concierge response time and reply shape by device and browser. The
--     browser-side message_received event carries the YAUAA entity directly,
--     so no join is needed: response_time_ms is what the shopper waited on
--     that device, and message_length is how long a reply the agent gave.
--     Requires at least one loaded message_received event.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  ua.device_class,
  ua.agent_name                                                            AS browser,
  ua.operating_system_name                                                 AS os,
  COUNT(DISTINCT e.domain_sessionid)                                       AS sessions,
  COUNT(*)                                                                 AS replies,
  APPROX_QUANTILES(e.unstruct_event_com_snowplow_agent_tracking_message_received_1.response_time_ms, 100)[OFFSET(50)] AS response_p50_ms,
  APPROX_QUANTILES(e.unstruct_event_com_snowplow_agent_tracking_message_received_1.response_time_ms, 100)[OFFSET(95)] AS response_p95_ms,
  ROUND(AVG(mc.message_length))                                            AS avg_reply_chars,
  ROUND(AVG(e.br_viewwidth))                                               AS avg_viewport_width
FROM events e
JOIN UNNEST(e.contexts_nl_basjes_yauaa_context_1)                          AS ua
LEFT JOIN UNNEST(e.contexts_com_snowplow_agent_tracking_message_context_1) AS mc
WHERE e.event_name = 'message_received'
GROUP BY 1, 2, 3
ORDER BY replies DESC;
