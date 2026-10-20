# Jornada performance handoff — 2026-10-20

## User request and scope

Make the Jornada funnel fast even on the first request. The user approved a scheduled incremental preparation job **every 30 minutes**, with no database triggers. Preserve attribution, all Hub/Clinisys appointment classifications, exclusive tracked/untracked/organic cohorts, deduplicated released revenue, historical contacts, arbitrary date/operational filters, and the additional Instagram branch. Do not redo Instagram tracking/backfill.

The user requested that work be saved and handed off before final publication. **The new API is not deployed to the public preview.** Do not claim that end-to-end latency is verified yet.

## Workspace and Git

Repository: `metrix0/EngravidaHub`.
Workspace: `/workspace/scratch/62b91d0294c9/engravidahub`.
Base of this checkpoint: `1cca4d2a44b46345d56d569ae2f5133c1952cb0a` on preview.
Last observed `origin/preview`: `1a384b422d8e5a30c22dd44421a2987d03f22d64` (appointment vacancy recovery). Reconcile the latest remote preview before final commit/publication. Preserve all concurrent changes. Never rewrite other agents' commits.

The earlier Jornada feature commit `ba886d25a25c13fdba6a8c45a0562cffbb096d14` was already published. This is a separate performance follow-up. This checkpoint is saved on `codex/jornada-prepared-refresh-checkpoint`, not deployed.

## Code already implemented

- `app/api/dashboard/jornada/route.ts` now re-exports the handler from `lib/dashboard/journeyEngine.ts`.
- The previous full route was moved into that shared engine. Existing summary/other dashboard behavior remains there.
- `full_pipeline_only=1` now calls **one** `dashboard_journey_prepared_v1` RPC. There is no source reconstruction, cache-warming requirement, refresh scheduling, or slow fallback on page access.
- The response retains the existing pipeline contract and adds `prepared_at` and a `Server-Timing: journey;dur=...` header.
- If the initial preparation is not ready, it returns 503. The live database is now ready, so initial backfill no longer blocks switching over.
- `prepareJourneyPatients` reuses the existing attribution, procedure classification, cross-feed deduplication, attendance, invoice chronology and revenue logic.
- It stores activity dates separately from unique-patient outcomes. It prepares outcome anchors for each possible historical entry date, so arbitrary ranges and contact filters select a patient once and use the correct entry-date outcome. It does not sum daily unique counts.
- A shared `Intl.DateTimeFormat` removes repeated formatter construction.
- Instagram transfer counts require a WhatsApp contact after the Instagram entry; direct consultation uses the corresponding Instagram anchor. Mixed-destination clicks remain excluded.
- Procedure attendance percentages were corrected to attended/scheduled and covered by a regression assertion.
- `_legacyFullJourney` remains as a reference for reconciliation tests, but no public request parameter exposes that slow implementation.
- `scripts/build-journey-worker.cjs` bundles the shared pure processor into the checked-in `supabase/functions/journey-refresh/journey-engine.mjs`. Network imports are replaced with a throwing stub so preparation must use its supplied batch.
- Edge worker source is `supabase/functions/journey-refresh/index.mjs`; operational notes are in its README.
- Existing journey tests now load the shared engine. New tests cover preparation and verify that uncached API requests perform exactly one prepared read, pass filters, expose timing and never recalculate.

No SQL files were added to the repository. Applied SQL scratch draft: `/tmp/journey-prepared-schema.sql` (IMPORTANT: this is an EARLY draft and does not contain all subsequent fixes; retrieve live function definitions before any DDL changes).

## Live Supabase resources — ALREADY APPLIED

Use only the **Engravida** connection:
- link: `link_6aca45f502008191a3ed670804fd9544`
- project: `ugvopazgxgkurtosjloh`

Enabled extensions: `pg_cron` in pg_catalog and `pg_net` in extensions.
Created unexposed schema `journey_private` and these nine tables:
`state`, `work`, `patients`, `activity`, `contacts`, `anchors`, `social`, `ads`, `tintim_versions`.
All have RLS and service-role-only policies/grants. Browser roles have neither schema usage nor public RPC execution. Do not print/read the worker token from state.

Created service-only, SECURITY INVOKER public functions with fixed search paths:
- `dashboard_journey_refresh_v1()` — change discovery, source fingerprints, daily reconciliation, ad/social snapshots, batch dispatch.
- `dashboard_journey_dispatch_v1()` — private authenticated HTTP invocation of the Edge Function.
- `dashboard_journey_claim_v1(text)` — token validation and leased batch claim (100 patients, 3-minute leases, SKIP LOCKED).
- `dashboard_journey_source_v1(uuid[])` — supplies bounded raw source data and the existing `dashboard_journey_outcomes_v1` output.
- `dashboard_journey_save_v1(uuid,uuid,jsonb)` — atomic patient/fact replacement, removes completed work, publishes readiness/checkpoint when done.
- `dashboard_journey_fail_v1(uuid,text)` — retains failed work and records error.
- `dashboard_journey_prepared_v1(timestamptz,timestamptz,uuid[],uuid[],uuid[],text[],text[])` — aggregates prepared facts into three exclusive pipelines and Instagram/ad counts.
- private `journey_private.normalize(text)`.

The existing `dashboard_journey_outcomes_v1(uuid[],date)` from the earlier feature remains in use; it was not replaced in this follow-up. Its global phone uniqueness check and server-only grants remain important.

### Scheduled job and deployed worker

- Supabase Cron job ID **1**, name `jornada-prepared-refresh`, schedule **`*/30 * * * *`**, active.
- Command: `select public.dashboard_journey_refresh_v1();`.
- First job of each São Paulo calendar day performs full reconciliation; other runs use changed source timestamps with a 2-minute overlap.
- TinTim has no update timestamp, so its change discovery compares row fingerprints, including deletions/relinks.
- Changed unlinked appointments trigger a broader reconciliation rather than guessing identity.
- `work` is a resumable batch work list created by the scheduled job; there are **no database triggers**.
- Edge Function `journey-refresh`, ID `789ba4e5-77ab-4f0d-a200-ac2d9de98bad`, active version **3**.
- URL: `https://ugvopazgxgkurtosjloh.supabase.co/functions/v1/journey-refresh`.
- JWT gateway verification is false because the handler authenticates a random database-held `x-journey-token` through the service-only claim RPC. Anonymous and invalid-token requests cannot start processing. No service key is stored in cron or shipped to the browser.
- Edge receives default Supabase service credentials from its own environment. Nothing needs copying from Vercel.

### Backfill status (last verified 15:29 UTC / 12:29 BRT)

- ready: **true**
- prepared patients: **30,278**
- pending work: **0**
- last_error: **null**
- completed_at: `2026-10-20T15:27:21.366882+00:00`
- checkpoint: `2026-10-20T15:10:48.737743+00:00`

The first automatic 15:30 UTC run was not yet verified when pausing. Check `cron.job_run_details`, state, pending leases and Edge errors after resuming.

### Runtime issues discovered and fixed

1. Save function had an ambiguous PL/pgSQL `p` reference. Fixed the JSON alias to `j.value`.
2. PostgREST's safe-update guard rejects metadata UPDATE without WHERE. All state updates in refresh/save/fail now use `WHERE id=true`.
3. Holding the singleton state row lock throughout a batch caused lock timeouts. Save now checks the run without that lock and acquires the state lock only after patient replacement/work deletion, immediately before finalization. Backfill completed successfully after this change.
4. Organic classification initially used a resolved origin even when it had no tracking evidence. The pure classifier now returns per-conversation organic IDs using the existing coverage rule; affected patients were reprocessed with worker version 3.
5. Prepared query initially scanned the contact CTE once per patient. Replaced correlated scans with grouped first/last/Instagram contact facts. Full-size database query is now about **785 ms** in the last EXPLAIN ANALYZE.

Do not reapply the scratch SQL draft: it would reintroduce these fixed definitions.

## Accuracy and performance evidence

Default range: 2026-07-22 through 2026-09-20 (inclusive), SQL bounds 2026-07-22T03:00Z to 2026-09-21T03:00Z.
All three cohort sizes exactly match the prior live implementation:
- paid: **3,734**
- untracked WhatsApp: **6,027**
- organic/other: **4,289**

Prepared output after backfill:
- paid: consultation scheduled 650, attended 409; procedure scheduled 363, attended 340; authorized clients 70; released R$560,321.97.
- untracked: consultation scheduled 499, attended 330; procedure scheduled 1,061, attended 944; authorized clients 205; released R$1,495,086.59.
- organic: consultation scheduled 917, attended 727; procedure scheduled 1,814, attended 1,627; authorized clients 661; released R$5,616,248.14.
- Instagram: exclusive Direct clicks **199,444**, paid chats **8,176**, unlinked chats 8,176, confirmed transfers and direct consultations **0** in this mature historical range.

Some outcome counts/revenue differ from the earlier live sample taken around 10:39 BRT. They may reflect live updates, source ordering or deduplication differences; **full outcome parity still needs verification**. Do not claim exact outcome equality yet.

Two fresh attempts to fetch the currently deployed legacy full funnel for comparison returned HTTP 500 after approximately **70 s** and **77 s**. Saved in-session objects existed, but don't rely on them after handoff. The existing public preview still serves the old implementation.

## Validation already run

Passed:
- `node scripts/test-full-journey.cjs` — old calculation fixtures plus the new one-RPC/no-recompute path and filters, readiness and percentages.
- `node scripts/test-journey-preparation.cjs` — historical anchors, invoice chronology/uniqueness, shared classifications, unnamed procedures, future attendance, source deduplication, TinTim updates, no network access.
- `node scripts/test-full-journey-ui.cjs` — existing three flows/collapsing/date/error behavior.
- `node scripts/test-invoice-replacements.cjs`.
- `node scripts/test-inbox-scheduling.cjs`.
- `npx eslint app/api/dashboard/jornada/route.ts lib/dashboard/journeyEngine.ts` — zero errors/warnings after renaming the reference helper.
- `npx tsc --noEmit --incremental false`.
- Full `npm run build` with placeholder build-only Supabase, GROQ and OpenAI variables. Re-run final build after reconciliation/latest edits before publication.
- `node --check` on worker/build/test files; `git diff --check`.
- Live SQL readiness, all cohort sizes, prepared query timing, anonymous permission checks and invalid worker token check.
- Security advisors: initial private-table no-policy informational findings were addressed by adding explicit service-role policies. Re-run advisors after final DDL verification.

No authenticated browser visual check and no deployed prepared-API timing have been completed. The UI itself was not redesigned in this follow-up.

## Remaining work, in order

1. Check the first scheduled 30-minute run: cron history, changed-client discovery, checkpoint advancement, no overlapping leases or errors. Verify updates/deletions/relinked patients are reconciled as intended without modifying original production records for tests.
2. Reconcile precise clinical/revenue outcomes against current source calculations, especially per-patient versus global deduplication and source row ordering. Cohort membership already matches exactly. Note: worker TinTim tie-breaking currently uses UUID lexical order, while the legacy historical loader uses numeric coercion; align via one shared nearest-event helper if relevant to observed differences.
3. Consider bounding retries per run (`attempts` is counted but currently not capped). Ensure permanent failures cannot spin between worker chains. Current failed work persists for a subsequent scheduled retry; initial backfill is clean. Initial runs dispatch four chains; assess reducing concurrency to two if database contention warrants it.
4. Complete real filter/date tests against prepared SQL (a custom range and a unit at minimum), plus empty ranges and date boundaries. Verify percentages and invoice uniqueness across all three flows.
5. Reconcile latest remote `preview` changes; keep upstream appointment vacancy recovery and all prior Jornada deep-insight/UI work. Read current files before edits.
6. Rebuild the worker and confirm the checked-in generated module matches deployed worker version 3 (redeploy both .mjs files together if necessary). Never overwrite the live DB functions with the early scratch draft.
7. Run final build/typecheck/tests and inspect the complete diff. No SQL files should be committed. Commit/push the final performance change to preview using a branch-head lease; do not overwrite concurrent updates.
8. Deploy to the correct **Engravida** Vercel project, verify the prepared API with uncached/default and custom filter requests, inspect `Server-Timing`, and only then move the preview alias. Target about 1–2 seconds; report actual end-to-end and server timing separately. Database EXPLAIN timing alone is not proof of page/API latency.

## Correct Vercel target and deployment caveats

Use Engravida Deployment link `link_6ace2bb44c208191b45614ba6c93a9bb`.
Project `hubengravida`, ID `prj_jb6BkDqYaC4smh5AeD5lIybZMP0L`.
Team `team_IZl9hS7irDpAG000kYEoKNQZ`.
Preview alias: `preview-engravida.vercel.app`.
Last published preview deployment before this follow-up: `dpl_8Ge4PiPz3wK8ocRv4oFgcN373b7T`, unique URL `hubengravida-ms8mt9zaz-hubengravida.vercel.app`, source `4d98b9fd7dbdcc9516db8b223ab9c2c96e764857`.
Inspect the alias before moving it; another agent may have updated it.

Auto Git builds on the correct project may be ignored by its configured Ignored Build Step. Earlier manual preview deployments used only the per-deployment override `projectSettings.commandForIgnoringBuildStep = "exit 1"`, `target` omitted (preview), GitHub repo ID `1271459182`, and the exact preview SHA with `withLatestCommit:false`. Do not alter global project settings or production aliases. The old iMenu account's duplicate `engravida-hub` project is the WRONG target.
