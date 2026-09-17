# PostHog Core Web Vitals dashboard per app

A per-app dashboard for the `$web_vitals` events
[`@narduk-enterprises/narduk-analytics`](../../packages/modules/narduk-analytics/README.md#core-web-vitals)
reports. Every tile below is a PostHog **SQL insight**, so the definitions are
exact and copy-pasteable rather than a sequence of dropdown choices.

Nothing here is automated: build the dashboard in the PostHog UI when an app is
ready for it. This repository never creates or mutates PostHog dashboards.

## Before you start

1. The app must have `posthogWebVitalsEnabled: true` (or
   `POSTHOG_WEB_VITALS_ENABLED=true`) and be deployed. Confirm data is arriving:
   **Activity** → filter to the `$web_vitals` event.
2. Filter internal traffic out at the project level once, rather than in every
   query: **Project settings** → **Filter out internal and test users** → add
   `is_owner is set` and `is_internal_user is set`. This is the same setting the
   module's owner/preview tagging already documents.

## Create the dashboard

1. **Dashboards** → **New dashboard** → **Blank dashboard**.
2. Name it `<app> — Core Web Vitals` (one dashboard per app).
3. On the new dashboard, set the **date range** to `Last 7 days` and add a
   dashboard-level property filter `app = <appName>` — the `app` super property
   this module registers on every event. The date range and that filter reach
   every tile below through the `{filters}` placeholder in each query, so the
   SQL stays identical across apps.
4. For each tile: **+ New insight** → **SQL** → paste the query → **Save & add
   to dashboard**.

## Grading thresholds

Assess each metric at the **75th percentile**, which is what Google's own
thresholds are defined against:

| Metric | Good   | Needs improvement | Poor   | Unit     |
| ------ | ------ | ----------------- | ------ | -------- |
| LCP    | ≤ 2500 | 2500–4000         | > 4000 | ms       |
| INP    | ≤ 200  | 200–500           | > 500  | ms       |
| CLS    | ≤ 0.1  | 0.1–0.25          | > 0.25 | unitless |
| FCP    | ≤ 1800 | 1800–3000         | > 3000 | ms       |

Sources: [LCP](https://web.dev/articles/lcp),
[INP](https://web.dev/articles/inp), [CLS](https://web.dev/articles/cls),
[FCP](https://web.dev/articles/fcp).

TTFB is deliberately absent — PostHog's `$web_vitals` autocapture supports
exactly LCP, CLS, FCP and INP.

## Tiles

### 1. Core Web Vitals — p75

The headline. One row per metric, with its sample count so you can see when a
number is too thin to act on.

```sql
SELECT
    'LCP' AS metric,
    round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS p75,
    count(properties.$web_vitals_LCP_value) AS samples
FROM events
WHERE event = '$web_vitals' AND {filters}
UNION ALL
SELECT
    'INP',
    round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0),
    count(properties.$web_vitals_INP_value)
FROM events
WHERE event = '$web_vitals' AND {filters}
UNION ALL
SELECT
    'CLS',
    round(quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)), 3),
    count(properties.$web_vitals_CLS_value)
FROM events
WHERE event = '$web_vitals' AND {filters}
UNION ALL
SELECT
    'FCP',
    round(quantile(0.75)(toFloat(properties.$web_vitals_FCP_value)), 0),
    count(properties.$web_vitals_FCP_value)
FROM events
WHERE event = '$web_vitals' AND {filters}
```

### 2. p75 by day

Trend line for the three Core Web Vitals. CLS is on a different scale, so read
it against its own threshold rather than against the two millisecond series.

```sql
SELECT
    toStartOfDay(timestamp) AS day,
    round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)), 3) AS cls_p75
FROM events
WHERE event = '$web_vitals' AND {filters}
GROUP BY day
ORDER BY day
```

### 3. Worst routes

Where to spend the next hour. `route` is the matched route _pattern_
(`/stations/:id`), so every request for a page groups together.

```sql
SELECT
    properties.route AS route,
    count() AS samples,
    round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)), 3) AS cls_p75
FROM events
WHERE event = '$web_vitals' AND {filters}
GROUP BY route
HAVING count(properties.$web_vitals_LCP_value) >= 20
ORDER BY lcp_p75 DESC
LIMIT 20
```

### 4. p75 by deploy

Ties a regression to the commit that shipped it. `build_version` is the deployed
SHA from narduk-core's `buildVersion`.

```sql
SELECT
    properties.build_version AS build,
    min(timestamp) AS first_seen,
    count() AS samples,
    round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_CLS_value)), 3) AS cls_p75
FROM events
WHERE event = '$web_vitals' AND {filters}
GROUP BY build
ORDER BY first_seen DESC
LIMIT 10
```

### 5. LCP rating split

The p75 tells you where you sit; this tells you how many people are having a bad
time. Swap the metric and thresholds from the table above for INP or CLS.

```sql
SELECT
    multiIf(
        toFloat(properties.$web_vitals_LCP_value) <= 2500, 'good',
        toFloat(properties.$web_vitals_LCP_value) <= 4000, 'needs improvement',
        'poor'
    ) AS rating,
    count() AS samples,
    round(100 * count() / sum(count()) OVER (), 1) AS share_pct
FROM events
WHERE event = '$web_vitals'
    AND properties.$web_vitals_LCP_value IS NOT NULL
    AND {filters}
GROUP BY rating
ORDER BY samples DESC
```

### 6. p75 by connection and device class

Separates "the site is slow" from "these users are on a slow link". Both columns
come from the connection/device properties this module adds when the browser
exposes them.

```sql
SELECT
    coalesce(properties.connection_effective_type, 'unknown') AS connection,
    coalesce(properties.$device_type, 'unknown') AS device,
    count() AS samples,
    round(quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)), 0) AS lcp_p75,
    round(quantile(0.75)(toFloat(properties.$web_vitals_INP_value)), 0) AS inp_p75
FROM events
WHERE event = '$web_vitals' AND {filters}
GROUP BY connection, device
ORDER BY samples DESC
```

## Reading the numbers honestly

- **Sample count belongs beside every p75.** A p75 over a handful of events is
  noise; tiles 1, 3, 4 and 6 carry their own counts for that reason.
- **CLS and INP arrive last.** The `web-vitals` library finalizes them when the
  page is hidden, and PostHog batches for up to five seconds after that, so a
  session whose tab is discarded immediately can be missing them. Expect the CLS
  and INP sample counts to run below the LCP and FCP counts; that gap is the
  upstream batching behavior described in the module README, not a bug in the
  query.
- **`route` can read `(unmatched)`.** That is the router failing to match the
  captured URL — usually a 404 or an external redirect landing page.

## Also available without any of this

PostHog ships its own **Web Vitals** dashboard under Web Analytics, reading the
same `$web_vitals` event. It has no `route`, `build_version` or connection
breakdown, but it needs no setup at all — start there if you only want the
headline numbers.
