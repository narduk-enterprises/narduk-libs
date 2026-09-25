---
'@narduk-enterprises/narduk-core': minor
'@narduk-enterprises/create-narduk-app': patch
---

New `@narduk-enterprises/narduk-core/server/scheduled-jobs`, the Cloudflare cron dispatcher that seven apps hand-rolled (#990). `defineScheduledJobs()` is one Nitro `cloudflare:scheduled` plugin, `runScheduledJobs()` serves a plain Worker's `scheduled`, and `declaredCrons()` / `cronParity()` check the jobs against wrangler `triggers.crons`. A job runs only on a cron it declares, and each job runs behind its own error boundary under `Promise.allSettled`. One failing job therefore no longer skips the others, as Nitro's serial hooks did when operator-portal's export stopped its retention prune. An optional D1 lease (compare-and-swap upsert, released by lease id; `SCHEDULED_JOB_LEASES_SQL`) keeps a cron run and a manual trigger from overlapping.
