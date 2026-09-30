-- =============================================================================
-- Storefront web analytics and ecommerce (BigQuery)
-- =============================================================================
--
-- Classic web-analytics and ecommerce views over the shopper-side events the
-- Atelier storefront tracks with the Snowplow browser tracker: out-of-the-box
-- page views plus the repo's own com.snowplow_demo.fashion ecommerce events.
-- Companion to analytics/agent-self-tracking.sql, which covers the agent side.
--
-- How to use
--   * The FROM clauses read `PROJECT.DATASET.events`. Point them at the
--     dataset your BigQuery Loader writes to, e.g.:
--       sed -i '' 's/PROJECT\.DATASET\./my-project.my_dataset./g' analytics/*.sql
--   * Every query is self-contained; copy one block into the BigQuery console.
--   * Each starts with the same `events` CTE: a load_tstamp partition filter,
--     a dedup on event_id, and `platform = 'web'` so server-side agent events
--     (platform 'srv') never inflate shopper metrics.
--   * The tracker does not enable activity tracking, so there are no
--     page_ping heartbeats. Time on page is approximated from the gap to the
--     next page view in the same session, and the last page of a session has
--     no value.
--   * Columns only exist once the first good event for that schema has
--     loaded; a "Field name X does not exist" error means that event has not
--     fired yet, not a typo. Drop the line and re-run.
--   * geo_* and refr_* columns are filled by enrichments. The legacy br_*,
--     os_* and dvce_type columns come from the deprecated ua-parser
--     enrichment and are NULL on a pipeline that does not run it. Device,
--     browser and OS come from the YAUAA entity instead:
--       contexts_nl_basjes_yauaa_context_1  (REPEATED, one element)
--         device_class (Desktop | Phone | Tablet | ...), device_brand,
--         device_name, agent_name (Chrome | Safari | Firefox | Edge | ...),
--         agent_name_version_major, operating_system_name,
--         operating_system_class, layout_engine_name
--     Automated browsers report agent_name 'HeadlessChrome' unless they send
--     matching Client Hints; add `AND ua.agent_name != 'HeadlessChrome'` to
--     hide them.
--
-- Events and entities (all com.snowplow_demo.fashion 1-0-0 unless noted)
--   page_view                      standard Snowplow event; page_urlpath, page_title, refr_*
--   product_list_viewed            list_id, list_name, list_type, product_count   + product[] entity
--   product_list_clicked           list_id, list_name, product_id                 + product entity
--   product_viewed                 product_id, product_name                       + product entity
--   cart_updated                   action (add_to_cart | remove_from_cart | adjust_quantity),
--                                  product_id, quantity, cart_line_count          + cart, product entities
--   cart_viewed                    (cart entity)
--   checkout_started               checkout_step, cart_line_count                 + checkout entity
--   checkout_step_viewed           checkout_step, cart_line_count                 + checkout entity
--   checkout_completed             order_value, currency, item_count              + checkout entity
--   contexts_com_snowplow_demo_fashion_product_1    product_id, sku, product_name, designer, category,
--                                                   color_family, occasion, price, currency
--   contexts_com_snowplow_demo_fashion_cart_1       cart_line_count, cart_value, currency
--   contexts_com_snowplow_demo_fashion_checkout_1   checkout_step, item_count, order_value, currency
--   contexts_com_snowplow_demo_fashion_user_1       global entity on every web event: shopper_profile_id,
--                                                   favorite_category, price_affinity (refined | premium | collector),
--                                                   cart_value_band (entry | considered | luxury).
--                                                   The last three are Signals-computed attributes echoed
--                                                   back into the event stream.
--   contexts_com_snowplowanalytics_snowplow_web_page_1   id (page view id) on every web event
--
-- List ids used by the storefront: 'home-featured', '<collection-slug>' on
-- collection pages, '<product-id>-complete-the-look' on product pages,
-- 'cart-styling-companion' on the cart page, and 'concierge_recommendations'
-- for cards rendered by the agent in the chat widget.
--
-- Identity: domain_userid is a first-party cookie per browser, so "users"
-- here means browsers. domain_sessionidx = 1 marks a browser's first session.
-- =============================================================================


-- =============================================================================
-- 1. TRAFFIC OVERVIEW
-- =============================================================================

-- 1a. Daily headline metrics: users, sessions, page views, shopping actions,
--     orders, revenue and conversion rate.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  DATE(derived_tstamp)                                                        AS day,
  COUNT(DISTINCT domain_userid)                                               AS users,
  COUNT(DISTINCT domain_sessionid)                                            AS sessions,
  COUNT(DISTINCT IF(domain_sessionidx = 1, domain_userid, NULL))              AS new_users,
  COUNTIF(event_name = 'page_view')                                           AS page_views,
  ROUND(SAFE_DIVIDE(COUNTIF(event_name = 'page_view'),
                    COUNT(DISTINCT domain_sessionid)), 2)                     AS page_views_per_session,
  COUNTIF(event_name = 'product_viewed')                                      AS product_views,
  COUNTIF(event_name = 'cart_updated'
          AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart')
                                                                              AS add_to_carts,
  COUNTIF(event_name = 'checkout_started')                                    AS checkouts_started,
  COUNTIF(event_name = 'checkout_completed')                                  AS orders,
  ROUND(SUM(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value), 2)
                                                                              AS revenue,
  ROUND(SAFE_DIVIDE(SUM(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value),
                    COUNTIF(event_name = 'checkout_completed')), 2)           AS avg_order_value,
  ROUND(SAFE_DIVIDE(COUNT(DISTINCT IF(event_name = 'checkout_completed', domain_sessionid, NULL)),
                    COUNT(DISTINCT domain_sessionid)), 4)                     AS session_conversion_rate
FROM events
GROUP BY 1
ORDER BY 1 DESC;


-- 1b. Hour-of-day by weekday: when shoppers are on the site.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  FORMAT_TIMESTAMP('%A', derived_tstamp)          AS weekday,
  EXTRACT(DAYOFWEEK FROM derived_tstamp)          AS weekday_num,
  EXTRACT(HOUR FROM derived_tstamp)               AS hour_utc,
  COUNT(DISTINCT domain_sessionid)                AS sessions,
  COUNTIF(event_name = 'page_view')               AS page_views,
  COUNTIF(event_name = 'checkout_completed')      AS orders
FROM events
GROUP BY 1, 2, 3
ORDER BY weekday_num, hour_utc;


-- 1c. Traffic sources: referrer medium and source, and campaign parameters.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
-- Attribute each session to its first page view.
session_source AS (
  SELECT
    domain_sessionid,
    ARRAY_AGG(STRUCT(
      IFNULL(refr_medium, 'direct')  AS medium,
      refr_source                    AS source,
      refr_urlhost                   AS referrer_host,
      mkt_source, mkt_medium, mkt_campaign
    ) ORDER BY derived_tstamp LIMIT 1)[OFFSET(0)] AS src
  FROM events
  WHERE event_name = 'page_view'
  GROUP BY 1
),
session_outcome AS (
  SELECT
    domain_sessionid,
    COUNTIF(event_name = 'page_view')                                      AS page_views,
    COUNTIF(event_name = 'checkout_completed') > 0                         AS purchased,
    SUM(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value) AS revenue
  FROM events
  GROUP BY 1
)
SELECT
  s.src.medium,
  s.src.source,
  s.src.referrer_host,
  s.src.mkt_source,
  s.src.mkt_medium,
  s.src.mkt_campaign,
  COUNT(*)                                                       AS sessions,
  ROUND(AVG(o.page_views), 2)                                    AS avg_page_views,
  ROUND(SAFE_DIVIDE(COUNTIF(o.page_views = 1), COUNT(*)), 3)     AS bounce_rate,
  COUNTIF(o.purchased)                                           AS orders,
  ROUND(SAFE_DIVIDE(COUNTIF(o.purchased), COUNT(*)), 4)          AS conversion_rate,
  ROUND(SUM(o.revenue), 2)                                       AS revenue
FROM session_source s
JOIN session_outcome o USING (domain_sessionid)
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY sessions DESC;


-- 1d. Devices, browsers and operating systems (YAUAA entity), with the
--     shopping funnel per combination. The legacy dvce_type / br_family /
--     os_family columns can be NULL; see the header.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    e.domain_sessionid,
    ANY_VALUE(e.domain_userid)                                         AS domain_userid,
    ANY_VALUE(ua.device_class)                                         AS device_class,
    ANY_VALUE(ua.device_name)                                          AS device_name,
    ANY_VALUE(ua.agent_name)                                           AS browser,
    ANY_VALUE(ua.agent_name_version_major)                             AS browser_version,
    ANY_VALUE(ua.operating_system_name)                                AS os,
    ANY_VALUE(e.geo_country)                                           AS country,
    ANY_VALUE(e.br_lang)                                               AS language,
    COUNTIF(e.event_name = 'page_view')                                AS page_views,
    COUNTIF(e.event_name = 'product_viewed')                           AS product_views,
    COUNTIF(e.event_name = 'cart_updated'
            AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') AS add_to_carts,
    COUNTIF(e.event_name = 'checkout_started') > 0                     AS started_checkout,
    COUNTIF(e.event_name = 'checkout_completed') > 0                   AS purchased,
    MAX(e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value) AS order_value,
    TIMESTAMP_DIFF(MAX(e.derived_tstamp), MIN(e.derived_tstamp), SECOND) AS duration_s
  FROM events e
  LEFT JOIN UNNEST(e.contexts_nl_basjes_yauaa_context_1) AS ua
  WHERE e.domain_sessionid IS NOT NULL
  GROUP BY 1
)
SELECT
  IFNULL(device_class, 'unknown')                              AS device_class,
  IFNULL(browser, 'unknown')                                   AS browser,
  IFNULL(os, 'unknown')                                        AS os,
  COUNT(DISTINCT domain_userid)                                AS users,
  COUNT(*)                                                     AS sessions,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()), 3)       AS session_share,
  ROUND(AVG(page_views), 1)                                    AS avg_page_views,
  ROUND(AVG(product_views), 1)                                 AS avg_product_views,
  ROUND(AVG(duration_s))                                       AS avg_session_seconds,
  ROUND(SAFE_DIVIDE(COUNTIF(page_views <= 1), COUNT(*)), 3)    AS bounce_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(add_to_carts > 0), COUNT(*)), 3)   AS add_to_cart_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(started_checkout), COUNT(*)), 3)   AS checkout_start_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 3)          AS purchase_rate,
  ROUND(AVG(IF(purchased, order_value, NULL)), 2)              AS avg_order_value,
  ARRAY_AGG(DISTINCT device_name IGNORE NULLS LIMIT 3)         AS sample_devices
FROM sessions
GROUP BY 1, 2, 3
ORDER BY sessions DESC;


-- 1e. Funnel by device class only: the phone vs. desktop vs. tablet story in
--     one row each, with each step as a share of the step before it.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    e.domain_sessionid,
    ANY_VALUE(ua.device_class)                                        AS device_class,
    ANY_VALUE(ua.operating_system_class)                              AS os_class,
    COUNTIF(e.event_name = 'product_viewed') > 0                      AS viewed_product,
    COUNTIF(e.event_name = 'cart_updated'
            AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') > 0 AS added_to_cart,
    COUNTIF(e.event_name = 'cart_viewed') > 0                         AS viewed_cart,
    COUNTIF(e.event_name = 'checkout_started') > 0                    AS started_checkout,
    COUNTIF(e.event_name = 'checkout_completed') > 0                  AS purchased,
    SUM(e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value) AS revenue
  FROM events e
  LEFT JOIN UNNEST(e.contexts_nl_basjes_yauaa_context_1) AS ua
  WHERE e.domain_sessionid IS NOT NULL
  GROUP BY 1
)
SELECT
  IFNULL(device_class, 'unknown')                                              AS device_class,
  COUNT(*)                                                                     AS sessions,
  COUNTIF(viewed_product)                                                      AS viewed_product,
  COUNTIF(added_to_cart)                                                       AS added_to_cart,
  COUNTIF(viewed_cart)                                                         AS viewed_cart,
  COUNTIF(started_checkout)                                                    AS started_checkout,
  COUNTIF(purchased)                                                           AS purchased,
  ROUND(SAFE_DIVIDE(COUNTIF(viewed_product), COUNT(*)), 3)                     AS view_rate,
  ROUND(SAFE_DIVIDE(COUNTIF(added_to_cart), COUNTIF(viewed_product)), 3)       AS view_to_cart,
  ROUND(SAFE_DIVIDE(COUNTIF(started_checkout), COUNTIF(added_to_cart)), 3)     AS cart_to_checkout,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNTIF(started_checkout)), 3)         AS checkout_to_purchase,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 3)                          AS session_conversion,
  ROUND(SUM(revenue), 2)                                                       AS revenue,
  ROUND(SAFE_DIVIDE(SUM(revenue), COUNTIF(purchased)), 2)                      AS avg_order_value
FROM sessions
GROUP BY 1
ORDER BY sessions DESC;


-- =============================================================================
-- 2. PAGES
-- =============================================================================

-- 2a. Top pages: views, sessions, and approximate time on page from the gap
--     to the next page view in the same session.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
page_views AS (
  SELECT
    domain_sessionid,
    domain_userid,
    page_urlpath,
    derived_tstamp,
    TIMESTAMP_DIFF(
      LEAD(derived_tstamp) OVER (PARTITION BY domain_sessionid ORDER BY derived_tstamp),
      derived_tstamp, SECOND)                                              AS seconds_to_next_page
  FROM events
  WHERE event_name = 'page_view'
)
SELECT
  page_urlpath,
  CASE
    WHEN page_urlpath = '/'                          THEN 'home'
    WHEN STARTS_WITH(page_urlpath, '/products/')     THEN 'product'
    WHEN STARTS_WITH(page_urlpath, '/collections/')  THEN 'collection'
    WHEN page_urlpath = '/cart'                      THEN 'cart'
    WHEN page_urlpath = '/checkout'                  THEN 'checkout'
    ELSE 'other'
  END                                                          AS page_type,
  COUNT(*)                                                     AS page_views,
  COUNT(DISTINCT domain_sessionid)                             AS sessions,
  COUNT(DISTINCT domain_userid)                                AS users,
  ROUND(AVG(seconds_to_next_page))                             AS avg_seconds_on_page,
  APPROX_QUANTILES(seconds_to_next_page, 100)[OFFSET(50)]      AS median_seconds_on_page,
  COUNTIF(seconds_to_next_page IS NULL)                        AS exits
FROM page_views
GROUP BY 1, 2
ORDER BY page_views DESC;


-- 2b. Landing pages: sessions, bounce rate and conversion by entry page.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    domain_sessionid,
    ARRAY_AGG(IF(event_name = 'page_view', page_urlpath, NULL) IGNORE NULLS
              ORDER BY derived_tstamp LIMIT 1)[SAFE_OFFSET(0)]          AS landing_page,
    ARRAY_AGG(IF(event_name = 'page_view', page_urlpath, NULL) IGNORE NULLS
              ORDER BY derived_tstamp DESC LIMIT 1)[SAFE_OFFSET(0)]     AS exit_page,
    COUNTIF(event_name = 'page_view')                                  AS page_views,
    COUNTIF(event_name = 'checkout_completed') > 0                     AS purchased,
    TIMESTAMP_DIFF(MAX(derived_tstamp), MIN(derived_tstamp), SECOND)   AS duration_s
  FROM events
  GROUP BY 1
),
-- Top three exit pages per landing page, built as a plain aggregate and
-- joined back. BigQuery rejects a correlated ARRAY(SELECT ...) that reads
-- another CTE ("Correlated subqueries that reference other tables are not
-- supported unless they can be de-correlated").
exit_pages AS (
  SELECT
    landing_page,
    ARRAY_AGG(STRUCT(exit_page, n) ORDER BY n DESC LIMIT 3) AS top_exit_pages
  FROM (
    SELECT landing_page, exit_page, COUNT(*) AS n
    FROM sessions
    WHERE landing_page IS NOT NULL
    GROUP BY 1, 2
  )
  GROUP BY 1
)
SELECT
  s.landing_page,
  COUNT(*)                                                      AS sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(s.page_views = 1), COUNT(*)), 3)    AS bounce_rate,
  ROUND(AVG(s.page_views), 2)                                   AS avg_page_views,
  ROUND(AVG(s.duration_s))                                      AS avg_duration_s,
  COUNTIF(s.purchased)                                          AS orders,
  ROUND(SAFE_DIVIDE(COUNTIF(s.purchased), COUNT(*)), 4)         AS conversion_rate,
  ANY_VALUE(x.top_exit_pages)                                   AS top_exit_pages
FROM sessions s
LEFT JOIN exit_pages x USING (landing_page)
WHERE s.landing_page IS NOT NULL
GROUP BY s.landing_page
ORDER BY sessions DESC;


-- 2c. Most common page paths (first five pages of a session).
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
paths AS (
  SELECT
    domain_sessionid,
    STRING_AGG(
      REGEXP_REPLACE(REGEXP_REPLACE(page_urlpath, r'^/products/.+', '/products/*'), r'^/collections/.+', '/collections/*'),
      ' > ' ORDER BY derived_tstamp LIMIT 5)                             AS path,
    COUNTIF(event_name = 'checkout_completed') > 0                       AS purchased
  FROM events
  WHERE event_name = 'page_view'
  GROUP BY 1
)
SELECT
  path,
  COUNT(*)                                             AS sessions,
  COUNTIF(purchased)                                   AS orders,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 4)  AS conversion_rate
FROM paths
GROUP BY 1
ORDER BY sessions DESC
LIMIT 25;


-- =============================================================================
-- 3. PRODUCTS AND MERCHANDISING
-- =============================================================================

-- 3a. Product performance: impressions, list clicks, detail views, add to
--     carts, and the view-to-cart rate.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
product_dim AS (
  SELECT
    p.product_id,
    ANY_VALUE(p.product_name)  AS product_name,
    ANY_VALUE(p.designer)      AS designer,
    ANY_VALUE(p.category)      AS category,
    ANY_VALUE(p.color_family)  AS color_family,
    ANY_VALUE(p.occasion)      AS occasion,
    ANY_VALUE(p.price)         AS price
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  GROUP BY 1
),
impressions AS (
  SELECT p.product_id, COUNT(*) AS impressions
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  WHERE e.event_name = 'product_list_viewed'
  GROUP BY 1
),
metrics AS (
  SELECT
    COALESCE(
      unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id,
      unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_id,
      unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id)                 AS product_id,
    COUNTIF(event_name = 'product_list_clicked')                                          AS list_clicks,
    COUNTIF(event_name = 'product_viewed')                                                AS detail_views,
    COUNT(DISTINCT IF(event_name = 'product_viewed', domain_sessionid, NULL))             AS viewing_sessions,
    COUNTIF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') AS add_to_carts,
    COUNTIF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'remove_from_cart') AS removes,
    COUNT(DISTINCT IF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart',
            domain_sessionid, NULL))                                                      AS carting_sessions
  FROM events
  WHERE event_name IN ('product_list_clicked', 'product_viewed', 'cart_updated')
  GROUP BY 1
)
SELECT
  m.product_id,
  d.product_name,
  d.designer,
  d.category,
  d.price,
  IFNULL(i.impressions, 0)                                        AS list_impressions,
  m.list_clicks,
  ROUND(SAFE_DIVIDE(m.list_clicks, i.impressions), 3)             AS list_ctr,
  m.detail_views,
  m.add_to_carts,
  m.removes,
  ROUND(SAFE_DIVIDE(m.carting_sessions, m.viewing_sessions), 3)   AS view_to_cart_rate
FROM metrics m
LEFT JOIN product_dim d USING (product_id)
LEFT JOIN impressions i USING (product_id)
WHERE m.product_id IS NOT NULL
ORDER BY m.detail_views DESC;


-- 3b. Category and designer roll-up.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  p.category,
  p.designer,
  COUNTIF(e.event_name = 'product_viewed')                                            AS detail_views,
  COUNTIF(e.event_name = 'cart_updated'
          AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') AS add_to_carts,
  ROUND(SAFE_DIVIDE(
    COUNTIF(e.event_name = 'cart_updated'
            AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart'),
    COUNTIF(e.event_name = 'product_viewed')), 3)                                     AS view_to_cart_rate,
  ROUND(AVG(p.price), 2)                                                              AS avg_price_viewed
FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
WHERE e.event_name IN ('product_viewed', 'cart_updated')
GROUP BY 1, 2
ORDER BY detail_views DESC;


-- 3c. Product list performance: which placements earn clicks. The concierge
--     list is the agent's product cards inside the chat widget.
--
--     The widget fires product_list_viewed when concierge cards render and
--     product_list_clicked when one is clicked. Data loaded before the
--     impression tracking existed has clicks but no browser-side concierge
--     impressions; for that case the row falls back to the server-side
--     searchCatalog tool_execution events: the number of product ids the
--     agent's searches returned. That is an upper bound on cards shown (the
--     agent does not render every result), so impression_source labels
--     which one the row used.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
agent_surfaced AS (
  -- Server-side (platform 'srv'): products the agent's catalog searches returned.
  SELECT
    COUNT(*)                                    AS searches,
    SUM(ARRAY_LENGTH(cs.product_ids))           AS products_surfaced
  FROM `PROJECT.DATASET.events` e
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_catalog_search_1) AS cs
  WHERE DATE(e.load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND e.event_name = 'tool_execution'
),
lists AS (
  SELECT
    COALESCE(unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.list_id,
             unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id)      AS list_id,
    ANY_VALUE(COALESCE(unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.list_name,
                       unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_name)) AS list_name,
    ANY_VALUE(unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.list_type)   AS list_type,
    COUNTIF(event_name = 'product_list_viewed')                                           AS list_views,
    SUM(IF(event_name = 'product_list_viewed',
           unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.product_count, 0)) AS product_impressions,
    COUNTIF(event_name = 'product_list_clicked')                                          AS clicks,
    COUNT(DISTINCT IF(event_name = 'product_list_clicked', domain_sessionid, NULL))       AS clicking_sessions
  FROM events
  WHERE event_name IN ('product_list_viewed', 'product_list_clicked')
  GROUP BY 1
)
SELECT
  CASE
    WHEN list_id = 'concierge_recommendations'           THEN 'agent concierge cards'
    WHEN list_id = 'home-featured'                       THEN 'home featured'
    WHEN list_id = 'cart-styling-companion'              THEN 'cart styling companion'
    WHEN ENDS_WITH(list_id, '-complete-the-look')        THEN 'product page: complete the look'
    ELSE 'collection page'
  END                                                    AS placement,
  list_id,
  list_name,
  IF(use_agent_surfaced, (SELECT searches FROM agent_surfaced), list_views)                         AS list_views,
  IF(use_agent_surfaced, (SELECT products_surfaced FROM agent_surfaced), product_impressions)       AS product_impressions,
  IF(use_agent_surfaced, 'agent searchCatalog results (upper bound)', 'product_list_viewed')         AS impression_source,
  clicks,
  clicking_sessions,
  ROUND(SAFE_DIVIDE(clicks,
        IF(use_agent_surfaced, (SELECT products_surfaced FROM agent_surfaced), product_impressions)), 3) AS click_through_rate
FROM (
  SELECT *, (list_id = 'concierge_recommendations' AND list_views = 0) AS use_agent_surfaced
  FROM lists
)
ORDER BY clicks DESC;


-- =============================================================================
-- 4. ECOMMERCE FUNNEL, REVENUE AND ABANDONMENT
-- =============================================================================

-- 4a. Session funnel: viewed a product -> added to cart -> viewed cart ->
--     started checkout -> completed, with step-to-step conversion.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    domain_sessionid,
    COUNTIF(event_name = 'page_view') > 0                                       AS s1_visited,
    COUNTIF(event_name = 'product_viewed') > 0                                  AS s2_viewed_product,
    COUNTIF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') > 0
                                                                                AS s3_added_to_cart,
    COUNTIF(event_name = 'cart_viewed') > 0                                     AS s4_viewed_cart,
    COUNTIF(event_name = 'checkout_started') > 0                                AS s5_started_checkout,
    COUNTIF(event_name = 'checkout_completed') > 0                              AS s6_purchased
  FROM events
  GROUP BY 1
),
steps AS (
  SELECT 1 AS step, 'visited'           AS name, COUNTIF(s1_visited)          AS sessions FROM sessions UNION ALL
  SELECT 2, 'viewed a product',   COUNTIF(s2_viewed_product)   FROM sessions UNION ALL
  SELECT 3, 'added to cart',      COUNTIF(s3_added_to_cart)    FROM sessions UNION ALL
  SELECT 4, 'viewed cart',        COUNTIF(s4_viewed_cart)      FROM sessions UNION ALL
  SELECT 5, 'started checkout',   COUNTIF(s5_started_checkout) FROM sessions UNION ALL
  SELECT 6, 'purchased',          COUNTIF(s6_purchased)        FROM sessions
)
SELECT
  step,
  name,
  sessions,
  ROUND(SAFE_DIVIDE(sessions, FIRST_VALUE(sessions) OVER (ORDER BY step)), 4)       AS share_of_all_sessions,
  ROUND(SAFE_DIVIDE(sessions, LAG(sessions) OVER (ORDER BY step)), 4)               AS step_conversion,
  LAG(sessions) OVER (ORDER BY step) - sessions                                     AS dropped_off
FROM steps
ORDER BY step;


-- 4b. Checkout step progression (checkout_started / checkout_step_viewed /
--     checkout_completed), to see where the checkout leaks.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  e.event_name,
  co.checkout_step,
  COUNT(*)                                     AS events,
  COUNT(DISTINCT e.domain_sessionid)           AS sessions,
  ROUND(AVG(co.order_value), 2)                AS avg_basket_value,
  ROUND(AVG(co.item_count), 2)                 AS avg_items
FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_checkout_1) AS co
WHERE e.event_name IN ('checkout_started', 'checkout_step_viewed', 'checkout_completed')
GROUP BY 1, 2
ORDER BY sessions DESC;


-- 4c. Revenue: orders, revenue, average order value and basket size per day.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
)
SELECT
  DATE(derived_tstamp)                                                           AS day,
  unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.currency         AS currency,
  COUNT(*)                                                                       AS orders,
  COUNT(DISTINCT domain_userid)                                                  AS buyers,
  ROUND(SUM(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value), 2) AS revenue,
  ROUND(AVG(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value), 2) AS avg_order_value,
  ROUND(AVG(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.item_count), 2)  AS avg_items_per_order,
  ROUND(MAX(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value), 2) AS largest_order
FROM events
WHERE event_name = 'checkout_completed'
GROUP BY 1, 2
ORDER BY 1 DESC;


-- 4d. Cart abandonment: sessions that added to cart but did not purchase,
--     with the value left behind (last cart entity seen in the session).
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
carts AS (
  SELECT
    e.domain_sessionid,
    ARRAY_AGG(c.cart_value ORDER BY e.derived_tstamp DESC LIMIT 1)[OFFSET(0)]      AS last_cart_value,
    ARRAY_AGG(c.cart_line_count ORDER BY e.derived_tstamp DESC LIMIT 1)[OFFSET(0)] AS last_cart_lines,
    MAX(e.derived_tstamp)                                                          AS last_cart_event_at
  FROM events e, UNNEST(e.contexts_com_snowplow_demo_fashion_cart_1) AS c
  GROUP BY 1
),
sessions AS (
  SELECT
    domain_sessionid,
    COUNTIF(event_name = 'cart_updated'
            AND unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') > 0 AS added,
    COUNTIF(event_name = 'checkout_started') > 0                                                   AS started_checkout,
    COUNTIF(event_name = 'checkout_completed') > 0                                                 AS purchased
  FROM events
  GROUP BY 1
)
SELECT
  CASE
    WHEN s.purchased                       THEN 'purchased'
    WHEN s.started_checkout                THEN 'abandoned at checkout'
    ELSE                                        'abandoned cart'
  END                                                   AS outcome,
  COUNT(*)                                              AS sessions,
  ROUND(SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()), 3) AS share,
  ROUND(SUM(c.last_cart_value), 2)                      AS cart_value,
  ROUND(AVG(c.last_cart_value), 2)                      AS avg_cart_value,
  ROUND(AVG(c.last_cart_lines), 2)                      AS avg_cart_lines
FROM sessions s
LEFT JOIN carts c USING (domain_sessionid)
WHERE s.added
GROUP BY 1
ORDER BY sessions DESC;


-- =============================================================================
-- 5. SHOPPER SEGMENTS
-- =============================================================================

-- 5a. New vs returning browsers.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    domain_sessionid,
    ANY_VALUE(domain_sessionidx)                                       AS session_index,
    COUNTIF(event_name = 'page_view')                                  AS page_views,
    COUNTIF(event_name = 'product_viewed')                             AS product_views,
    COUNTIF(event_name = 'checkout_completed') > 0                     AS purchased,
    SUM(unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value) AS revenue,
    TIMESTAMP_DIFF(MAX(derived_tstamp), MIN(derived_tstamp), SECOND)   AS duration_s
  FROM events
  GROUP BY 1
)
SELECT
  IF(session_index = 1, 'new', 'returning')             AS visitor_type,
  COUNT(*)                                              AS sessions,
  ROUND(AVG(page_views), 2)                             AS avg_page_views,
  ROUND(AVG(product_views), 2)                          AS avg_product_views,
  ROUND(AVG(duration_s))                                AS avg_duration_s,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 4)   AS conversion_rate,
  ROUND(SAFE_DIVIDE(SUM(revenue), COUNTIF(purchased)), 2) AS avg_order_value
FROM sessions
GROUP BY 1
ORDER BY 1;


-- 5b. Signals-derived shopper attributes: the user entity carries the
--     price_affinity, favorite_category and cart_value_band that Signals
--     computed and the storefront echoed back onto every event. Segment
--     behaviour by them. Attributes are taken as of the session's last event.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
sessions AS (
  SELECT
    e.domain_sessionid,
    ARRAY_AGG(STRUCT(u.price_affinity, u.favorite_category, u.cart_value_band)
              ORDER BY e.derived_tstamp DESC LIMIT 1)[OFFSET(0)]            AS attrs,
    COUNTIF(e.event_name = 'product_viewed')                                AS product_views,
    COUNTIF(e.event_name = 'cart_updated'
            AND e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action = 'add_to_cart') AS add_to_carts,
    COUNTIF(e.event_name = 'checkout_completed') > 0                        AS purchased,
    SUM(e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value) AS revenue
  FROM events e
  LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_user_1) AS u
  GROUP BY 1
)
SELECT
  IFNULL(attrs.price_affinity, 'unknown')               AS price_affinity,
  IFNULL(attrs.favorite_category, 'unknown')            AS favorite_category,
  IFNULL(attrs.cart_value_band, 'unknown')              AS cart_value_band,
  COUNT(*)                                              AS sessions,
  ROUND(AVG(product_views), 2)                          AS avg_product_views,
  ROUND(AVG(add_to_carts), 2)                           AS avg_add_to_carts,
  COUNTIF(purchased)                                    AS orders,
  ROUND(SAFE_DIVIDE(COUNTIF(purchased), COUNT(*)), 4)   AS conversion_rate,
  ROUND(SAFE_DIVIDE(SUM(revenue), COUNTIF(purchased)), 2) AS avg_order_value
FROM sessions
GROUP BY 1, 2, 3
ORDER BY sessions DESC;


-- 5c. Does the favourite category Signals computed match what the shopper
--     actually browses? Category of each product view vs. the favourite
--     category on the same event's user entity.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
views AS (
  SELECT
    IFNULL(u.favorite_category, 'not yet computed')     AS signals_favorite_category,
    p.category                                          AS viewed_category,
    COUNT(*)                                            AS product_views
  FROM events e
  LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_user_1) AS u
  JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
  WHERE e.event_name = 'product_viewed'
  GROUP BY 1, 2
)
SELECT
  signals_favorite_category,
  viewed_category,
  product_views,
  ROUND(SAFE_DIVIDE(product_views,
        SUM(product_views) OVER (PARTITION BY signals_favorite_category)), 3) AS share_within_segment,
  signals_favorite_category = viewed_category                                 AS matches_favorite
FROM views
ORDER BY 1, product_views DESC;


-- =============================================================================
-- 6. ONE SHOPPER'S SESSION
-- =============================================================================

-- 6a. Plain event timeline for one session (shopper events only; the
--     interleaved shopper + agent version is query 7c in
--     analytics/agent-self-tracking.sql). Defaults to the most recent
--     session that purchased; swap in a literal domain_sessionid to inspect
--     a specific one.
WITH events AS (
  SELECT *
  FROM `PROJECT.DATASET.events`
  WHERE DATE(load_tstamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND platform = 'web'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY collector_tstamp) = 1
),
target AS (
  SELECT domain_sessionid
  FROM events
  WHERE event_name = 'checkout_completed'
  ORDER BY derived_tstamp DESC
  LIMIT 1
  -- or: SELECT 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' AS domain_sessionid
)
SELECT
  e.derived_tstamp,
  TIMESTAMP_DIFF(e.derived_tstamp,
                 LAG(e.derived_tstamp) OVER (ORDER BY e.derived_tstamp), SECOND) AS seconds_since_previous,
  e.event_name,
  e.page_urlpath,
  CASE e.event_name
    WHEN 'product_list_viewed'  THEN FORMAT('%s (%d products)',
        e.unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.list_id,
        e.unstruct_event_com_snowplow_demo_fashion_product_list_viewed_1.product_count)
    WHEN 'product_list_clicked' THEN FORMAT('%s -> %s',
        e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.list_id,
        IFNULL(p.product_name, e.unstruct_event_com_snowplow_demo_fashion_product_list_clicked_1.product_id))
    WHEN 'product_viewed'       THEN FORMAT('%s (%s, %t %s)',
        e.unstruct_event_com_snowplow_demo_fashion_product_viewed_1.product_name,
        IFNULL(p.designer, ''), p.price, IFNULL(p.currency, ''))
    WHEN 'cart_updated'         THEN FORMAT('%s %s -> cart %t',
        e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.action,
        IFNULL(p.product_name, e.unstruct_event_com_snowplow_demo_fashion_cart_updated_1.product_id),
        c.cart_value)
    WHEN 'cart_viewed'          THEN FORMAT('%d lines, %t', c.cart_line_count, c.cart_value)
    WHEN 'checkout_started'     THEN e.unstruct_event_com_snowplow_demo_fashion_checkout_started_1.checkout_step
    WHEN 'checkout_completed'   THEN FORMAT('order %t %s, %d items',
        e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.order_value,
        e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.currency,
        e.unstruct_event_com_snowplow_demo_fashion_checkout_completed_1.item_count)
    ELSE NULL
  END                                                                       AS detail,
  u.price_affinity,
  u.favorite_category,
  u.cart_value_band
FROM events e
JOIN target t USING (domain_sessionid)
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_product_1) AS p
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_cart_1)    AS c
LEFT JOIN UNNEST(e.contexts_com_snowplow_demo_fashion_user_1)    AS u
ORDER BY e.derived_tstamp, e.dvce_created_tstamp;
