# Architecture

The KROB WhatsApp tracker is a single Cloudflare Pages project. Every piece exists
to do one thing well: **capture every uazapi webhook faithfully, then attribute
Click-to-WhatsApp (CTWA) conversations back to the Meta ad that started them** —
without ever blocking or dropping an inbound message.

```
  WhatsApp user clicks a CTWA ad
            │
            ▼
   ┌─────────────────┐      POST (x-webhook-token)
   │     uazapi       │ ───────────────────────────────►  /webhook/uazapi
   │ (WhatsApp gw)    │                                         │
   └─────────────────┘                                         │ 1. auth
                                                                │ 2. store raw_payload (source of truth)
                                                                │ 3. extract columns + CTWA context
                                                                │ 4. return 200 FAST  ◄── uazapi never waits
                                                                │
                                          ┌─────────────────────┴───────────────────┐
                                          │ if CTWA:                                  │
                                          │   upsert conversions row (by ctwa_clid)   │
                                          │   waitUntil( fireLead + enrichAd )         │  ◄── runs after the 200
                                          └─────────────────────┬───────────────────┘
                                                                │
                                   ┌────────────────────────────┼───────────────────────────┐
                                   ▼                            ▼                            ▼
                            Meta Conversions API        Meta Marketing API              Cloudflare D1
                            (LeadSubmitted,              (ad → adset → campaign           webhook_events
                             business_messaging)          names, cached 7d)              conversions
                                                                                         capi_events_log
                                                                                         meta_ads_cache
                                                                                              ▲
                                              inspector UI (/) + /api/* ─────────────────────┘
```

## Design principles

**Capture first, everything else after.** The webhook stores the full `raw_payload`
into `webhook_events` before any attribution logic runs, and returns `200` as soon as
the row is written. The Meta CAPI call and ad-metadata enrichment run *after* the
response via `context.waitUntil()` — so uazapi never waits on Meta, and a slow or
failing Meta API can't cause uazapi to retry and create duplicate webhook rows.

**`raw_payload` is the source of truth.** The extracted columns (sender, message
type, CTWA fields, …) exist only for fast filtering in the inspector. If a new
interesting field turns up later, it can be backfilled from `raw_payload` without
data loss (see `scripts/backfill_ctwa.sql` for exactly this pattern).

**Defensive extraction.** Every field is read with optional chaining and `?? null`.
uazapi's payload shape changes without warning, and a missing field must never crash
the handler — a partially-extracted row is still stored.

**Idempotency by `ctwa_clid`.** A conversion is one row per unique CTWA click,
keyed by `ctwa_clid UNIQUE`. The same person messaging twice doesn't create a second
conversion or a second Lead. Meta independently dedups on `(event_name, event_id)`
for 48h, and `event_id = ctwa_clid`.

**No cron, no queue.** The Lead fires inline from the webhook via `waitUntil()`, with
up to 5 retries and short backoff (~35s worst case) for transient Meta failures. For
anything still unsent, `POST /api/retry-pending` is a manual one-call flush. This
keeps the whole system to a single Pages project with no extra moving parts.

**Capture-only without Meta creds.** If `META_DATASET_ID`/`META_CAPI_TOKEN` are unset,
`sendCapiEvent` returns a "skipped" shape and the conversion records
`lead_status='skipped_no_creds'`. CTWA data is still captured — you can deploy, watch
real traffic, and wire Meta up later.

## File map

| Path | Role |
|---|---|
| `functions/webhook/uazapi.js` | The receiver. Auth → store raw → extract → CTWA fan-out → `200`. |
| `functions/lib/capi.js` | CTWA extractors, Meta CAPI event builders, retry/`fireLead`, Marketing API enrichment, D1 helpers. |
| `functions/api/events.js`, `functions/api/events/[id].js` | List captured events; fetch one with full `raw_payload`. |
| `functions/api/conversions.js`, `functions/api/conversions/[id].js` | List CTWA conversions (joined with ad names); fetch one with its CAPI log. |
| `functions/api/retry-pending.js` | Manual flush: re-fire stuck leads, re-enrich stale ads. |
| `functions/api/fire-purchase.js` | Manually fire a Meta CAPI `Purchase` for a CTWA conversion (from the inspector). |
| `migrations/0001_init.sql`, `migrations/0002_capi.sql` | D1 schema (see `docs/schema.md`). |
| `scripts/backfill_ctwa.sql` | Backfill CTWA columns from `raw_payload` for rows captured before 0002. |
| `public/index.html` | Vanilla-JS inspector — Events + Conversions tabs, raw-payload viewer, flush button. |

## Request lifecycle (the hot path)

1. **Auth** — `x-webhook-token` header (or `?token=`) vs `WEBHOOK_SECRET`; `401` if wrong.
2. **Parse** — JSON body; `400` on invalid JSON.
3. **Extract** — defensive column extraction + `extractCtwaContext()`.
4. **Store** — one INSERT into `webhook_events` (raw payload always included).
5. **Respond** — `200 { ok, id, conversion_id?, new_conversion? }`.
6. **After the 200 (CTWA only)** — `upsertConversion`, then `waitUntil(fireLead, enrichAdIfStale)`.

See `docs/ctwa-findings.md` for the hard-won details of *where* CTWA data hides in the
payload, and `docs/schema.md` for the table layouts.
