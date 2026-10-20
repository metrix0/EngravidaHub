# Jornada preparation

`journey-refresh` processes bounded batches from the private database work list. It uses the same attribution, classification, appointment deduplication and revenue functions as the API. Authentication uses a random database-held worker token checked by the service-only claim RPC; anonymous requests cannot start a batch.

The Supabase Cron job `jornada-prepared-refresh` runs at `*/30 * * * *`. It discovers source changes with an overlapping successful-run checkpoint, detects TinTim changes by fingerprint, refreshes advertising/social facts, and dispatches the worker. The first run each São Paulo calendar day reconciles all patients, including deleted/relinked data and attendance dates. Failed batches retain their work and checkpoint for retry. Patient facts are replaced transactionally; initial readiness is published only after the backfill completes.

The private schema `journey_private` contains `state`, `work`, `patients`, `activity`, `contacts`, `anchors`, `social`, `ads`, and `tintim_versions`. Neither schema access nor public RPC execution is granted to browser roles. Only the server reads the prepared aggregates through `dashboard_journey_prepared_v1`. Dates select unique patients through activity facts; the query selects the applicable historical contact before aggregating prepared entry-date outcomes. It never sums daily unique-patient totals.

Build the deployed worker module after changing shared rules:

```
node scripts/build-journey-worker.cjs
node scripts/test-journey-preparation.cjs
node scripts/test-full-journey.cjs
node scripts/test-full-journey-ui.cjs
```

Deploy `index.mjs` and `journey-engine.mjs` together to the Engravida Supabase project. JWT gateway verification is disabled because the handler authenticates its own private worker token. Keep the generated bundle in sync with the shared source. The browser/API never schedules a refresh or falls back to source reconstruction.

Operational checks: inspect `journey_private.state` (excluding its secret), pending/expired work, the cron run history, and Edge Function errors. `prepared_at` in the API response and its `Server-Timing` header report data completion and request processing time.
