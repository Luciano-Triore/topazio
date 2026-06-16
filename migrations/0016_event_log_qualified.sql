-- 0016_event_log_qualified.sql
-- Manual "Qualified Lead" for WEBSITE leads (the Topázio LP funnel: ad → LP →
-- form → WhatsApp). The form fires a `Lead` into event_log; later the comercial
-- attendant marks a lead as qualified in the dashboard, which fires a Meta CAPI
-- QualifiedLead (action_source 'website', matched by fbp/fbc/external_id from
-- the lead's session). Mirrors the conversions.qualified_lead_* lifecycle
-- (0003_qualified_lead.sql) but on event_log. See functions/api/fire-qualified-lead-web.js.

ALTER TABLE event_log ADD COLUMN qualified_lead_status     TEXT;
                                                            -- sending | sent | failed | skipped_no_creds
ALTER TABLE event_log ADD COLUMN qualified_lead_event_id   TEXT;
ALTER TABLE event_log ADD COLUMN qualified_lead_sent_at    INTEGER;
ALTER TABLE event_log ADD COLUMN qualified_lead_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_log ADD COLUMN qualified_lead_last_error TEXT;
