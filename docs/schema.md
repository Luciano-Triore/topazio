# D1 schema reference

Two migrations, applied in order. `0001_init.sql` is the capture table;
`0002_capi.sql` adds CTWA extraction columns and the attribution tables. Apply both:
`npm run d1:init:remote` then `npm run d1:capi:remote` (and the `:local` variants for
local dev). All tables/indexes use `IF NOT EXISTS`, so re-running is safe; the `ALTER`
statements in 0002 will error on a database that already has those columns — ignore
that on a reused DB.

The guiding principle: **`webhook_events.raw_payload` is the source of truth.** Every
other column and table is derived for fast filtering/attribution and can be backfilled
from `raw_payload` (see `scripts/backfill_ctwa.sql`).

## `webhook_events` — every inbound webhook, verbatim

One row per webhook POST. Written before any attribution logic; always includes the
full `raw_payload`.

| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `received_at` | INTEGER | when *we* received it, unix ms |
| `event_type` | TEXT | `payload.EventType` |
| `instance_name`, `owner`, `chat_source` | TEXT | top-level payload metadata |
| `message_id`, `message_wa_id` | TEXT | full + short WA message ids |
| `chat_id`, `chat_lid` | TEXT | chat identifiers |
| `sender_pn` | TEXT | real phone (`@s.whatsapp.net` form) — **hash from this, never `sender_lid`** |
| `sender_lid`, `sender_name`, `from_me` | TEXT/INT | sender info; `from_me` 0/1 |
| `is_group`, `group_name` | INT/TEXT | group context |
| `message_type`, `message_media` | TEXT | `Conversation`, `ExtendedTextMessage`, media type, … |
| `message_content` | TEXT | body text, truncated to 2000 chars (full text in `raw_payload`) |
| `message_ts` | INTEGER | `payload.message.messageTimestamp` |
| `track_id`, `track_source`, `has_track_data` | TEXT/INT | uazapi's own tracking fields (empty for CTWA) |
| `ctwa_clid` | TEXT | CTWA click id (0002) |
| `entry_point_source`, `entry_point_app` | TEXT | e.g. `ctwa_ad`, `instagram` (0002) |
| `ad_source_id`, `ad_source_url`, `ad_title`, `ad_body` | TEXT | ad creative metadata from the payload (0002) |
| `is_ctwa` | INTEGER | 1 if CTWA context was found (0002) |
| `raw_payload` | TEXT NOT NULL | the full unmodified JSON — source of truth |

Indexes: `received_at DESC`, `sender_pn`, `has_track_data`, `message_id`, `chat_id`,
`(is_ctwa, received_at DESC)`, `ctwa_clid`.

## `conversions` — one row per unique CTWA click

Keyed by `ctwa_clid UNIQUE` (idempotent upsert). Tracks the Lead lifecycle and the
Purchase lifecycle.

| group | columns | notes |
|---|---|---|
| identity | `id`, `ctwa_clid` (UNIQUE), `first_seen_at`, `webhook_event_id` | FK to `webhook_events.id` |
| sender | `sender_pn`, `sender_name`, `instance_name` | `sender_pn` is E.164 digits (no `@s.whatsapp.net`) |
| ad | `ad_id`, `ad_source_url`, `ad_title`, `ad_body`, `entry_point_app`, `entry_point_source`, `ctwa_payload_b64` | `ctwa_payload_b64` kept for forensics |
| lead lifecycle | `lead_status`, `lead_event_id`, `lead_sent_at`, `lead_attempts`, `lead_next_attempt_at`, `lead_last_error` | status: `pending` \| `sending` \| `sent` \| `failed` \| `dead` \| `expired` \| `skipped_no_creds` |
| purchase lifecycle | `purchase_status`, `purchase_event_id`, `purchase_sent_at`, `purchase_value`, `purchase_currency`, `purchase_attempts`, `purchase_next_attempt_at`, `purchase_last_error` | written by manual Purchase fires (`POST /api/fire-purchase`); same status values as lead. `_next_attempt_at` unused (no auto-detector yet) |
| qualified-lead lifecycle | `qualified_lead_status`, `qualified_lead_event_id`, `qualified_lead_sent_at`, `qualified_lead_attempts`, `qualified_lead_next_attempt_at`, `qualified_lead_last_error` | written by manual Qualified Lead fires (`POST /api/fire-qualified-lead`); no value (a qualified lead has no amount). `event_id = ctwa_clid:qualified`. Added in `0003_qualified_lead.sql` |

Indexes: `(lead_status, lead_next_attempt_at)` (sweep), `ad_id`, `first_seen_at DESC`,
`sender_pn`.

## `capi_events_log` — audit row per POST to Meta

One row for every HTTP attempt to the Conversions API, so you can see exactly what was
sent and what Meta returned.

| column | notes |
|---|---|
| `id`, `conversion_id` | FK to `conversions.id` (nullable for unattributed fires) |
| `attempted_at` | unix ms |
| `event_name`, `event_id` | what was sent (`LeadSubmitted` / `Purchase` / `QualifiedLead`; `event_id` is `ctwa_clid`, `ctwa_clid:purchase`, or `ctwa_clid:qualified`) |
| `request_body` | full JSON sent (phone already SHA-256 hashed) |
| `response_status`, `response_body` | HTTP status + Meta response, or `skipped: ...` when creds are missing |
| `duration_ms` | round-trip time |
| `was_test` | 1 if a `META_TEST_EVENT_CODE` was attached |

Indexes: `(conversion_id, attempted_at DESC)`, `attempted_at DESC`.

## `meta_ads_cache` — resolved ad metadata (Marketing API)

Caches `ad_id` → ad/adset/campaign names so the inspector can show human-readable
attribution. Refreshed on a 7-day TTL.

| column | notes |
|---|---|
| `ad_id` PK | the Meta ad id |
| `fetched_at`, `expires_at` | TTL is `fetched_at + 7d` |
| `ad_name`, `adset_id`, `adset_name`, `campaign_id`, `campaign_name`, `campaign_objective`, `effective_status` | resolved fields |
| `raw_response` | full Marketing API JSON |

Index: `expires_at`.

## Handy queries

```sql
-- recent CTWA conversions and their lead status
SELECT id, ctwa_clid, sender_name, lead_status, lead_attempts
FROM conversions ORDER BY first_seen_at DESC LIMIT 20;

-- last few Meta CAPI attempts
SELECT conversion_id, event_name, response_status, was_test, substr(response_body,1,160) AS body
FROM capi_events_log ORDER BY attempted_at DESC LIMIT 10;

-- raw payload of one event (forensics)
SELECT raw_payload FROM webhook_events WHERE id = ?;
```
