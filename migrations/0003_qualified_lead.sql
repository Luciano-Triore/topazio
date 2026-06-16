-- 0003_qualified_lead.sql
-- Manual "Qualified Lead" conversion: a sibling of the manual Purchase flow.
-- An operator marks a CTWA contact as qualified in the inspector → fires a Meta
-- CAPI QualifiedLead event. Mirrors the purchase_* lifecycle columns, minus the
-- value/currency (a qualified lead carries no amount). See lib/capi.js
-- fireQualifiedLead() and POST /api/fire-qualified-lead.

ALTER TABLE conversions ADD COLUMN qualified_lead_status           TEXT;
                                                                   -- pending | sending | sent | failed | skipped_no_creds
ALTER TABLE conversions ADD COLUMN qualified_lead_event_id         TEXT;
ALTER TABLE conversions ADD COLUMN qualified_lead_sent_at          INTEGER;
ALTER TABLE conversions ADD COLUMN qualified_lead_attempts         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversions ADD COLUMN qualified_lead_next_attempt_at  INTEGER;
ALTER TABLE conversions ADD COLUMN qualified_lead_last_error       TEXT;
