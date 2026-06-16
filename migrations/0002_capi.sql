-- 0002_capi.sql
-- Phase 2: CTWA extraction columns on webhook_events, plus the conversions /
-- capi_events_log / meta_ads_cache tables that drive Meta CAPI Lead firing
-- and ad-name enrichment. See plan: extend krob-wa-tracer with CTWA + CAPI.

-- ---- webhook_events: new CTWA columns -----------------------------------
-- (keep existing track_id/track_source/has_track_data — uazapi's own fields)

ALTER TABLE webhook_events ADD COLUMN ctwa_clid          TEXT;
ALTER TABLE webhook_events ADD COLUMN entry_point_source TEXT;  -- e.g. "ctwa_ad"
ALTER TABLE webhook_events ADD COLUMN entry_point_app    TEXT;  -- e.g. "instagram"
ALTER TABLE webhook_events ADD COLUMN ad_source_id       TEXT;  -- Meta ad id
ALTER TABLE webhook_events ADD COLUMN ad_source_url      TEXT;
ALTER TABLE webhook_events ADD COLUMN ad_title           TEXT;
ALTER TABLE webhook_events ADD COLUMN ad_body            TEXT;
ALTER TABLE webhook_events ADD COLUMN is_ctwa            INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_webhook_is_ctwa
  ON webhook_events(is_ctwa, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_ctwa_clid
  ON webhook_events(ctwa_clid);

-- ---- conversions: one row per unique ctwa_clid --------------------------

CREATE TABLE IF NOT EXISTS conversions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  ctwa_clid                TEXT NOT NULL UNIQUE,
  first_seen_at            INTEGER NOT NULL,              -- unix ms
  webhook_event_id         INTEGER,                       -- FK -> webhook_events.id
  sender_pn                TEXT,                          -- E.164 digits (no @s.whatsapp.net)
  sender_name              TEXT,
  instance_name            TEXT,

  -- Ad metadata captured directly from the WA payload
  ad_id                    TEXT,
  ad_source_url            TEXT,
  ad_title                 TEXT,
  ad_body                  TEXT,
  entry_point_app          TEXT,
  entry_point_source       TEXT,
  ctwa_payload_b64         TEXT,                          -- raw blob, forensic

  -- Lead lifecycle
  lead_status              TEXT NOT NULL DEFAULT 'pending',
                                                          -- pending | sending | sent | failed | dead | expired | skipped_no_creds
  lead_event_id            TEXT,
  lead_sent_at             INTEGER,
  lead_attempts            INTEGER NOT NULL DEFAULT 0,
  lead_next_attempt_at     INTEGER,
  lead_last_error          TEXT,

  -- Purchase lifecycle (Phase 3 hooks — schema only, no detector yet)
  purchase_status          TEXT,
  purchase_event_id        TEXT,
  purchase_sent_at         INTEGER,
  purchase_value           REAL,
  purchase_currency        TEXT,
  purchase_attempts        INTEGER NOT NULL DEFAULT 0,
  purchase_next_attempt_at INTEGER,
  purchase_last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_conv_lead_sweep
  ON conversions(lead_status, lead_next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_conv_ad_id
  ON conversions(ad_id);
CREATE INDEX IF NOT EXISTS idx_conv_first_seen
  ON conversions(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_sender_pn
  ON conversions(sender_pn);

-- ---- capi_events_log: audit row per HTTP call to Meta -------------------

CREATE TABLE IF NOT EXISTS capi_events_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversion_id   INTEGER,                                -- FK -> conversions.id (nullable for unattributed fires)
  attempted_at    INTEGER NOT NULL,                       -- unix ms
  event_name      TEXT NOT NULL,                          -- Lead | Purchase
  event_id        TEXT,                                   -- what we sent as event_id
  request_body    TEXT,                                   -- full JSON we sent (PII already hashed)
  response_status INTEGER,                                -- HTTP status, NULL if request never went out
  response_body   TEXT,                                   -- Meta response or 'skipped: ...'
  duration_ms     INTEGER,
  was_test        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_capi_log_by_conv
  ON capi_events_log(conversion_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_log_by_time
  ON capi_events_log(attempted_at DESC);

-- ---- meta_ads_cache: resolved ad metadata from Marketing API ------------

CREATE TABLE IF NOT EXISTS meta_ads_cache (
  ad_id              TEXT PRIMARY KEY,
  fetched_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,                    -- fetched_at + 7d typical
  ad_name            TEXT,
  adset_id           TEXT,
  adset_name         TEXT,
  campaign_id        TEXT,
  campaign_name      TEXT,
  campaign_objective TEXT,
  effective_status   TEXT,
  raw_response       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ads_cache_expires
  ON meta_ads_cache(expires_at);
