-- scripts/backfill_ctwa.sql
--
-- One-shot backfill for events captured before migration 0002. Pulls CTWA
-- fields out of raw_payload into the new indexed columns, fixes message_content
-- for ExtendedTextMessage rows (where the old extractor stored NULL), then
-- seeds the conversions table from any CTWA-tagged rows.
--
-- Idempotent: COALESCE preserves anything already set; INSERT OR IGNORE on
-- conversions keys off ctwa_clid UNIQUE.

-- ctwaClid lives inside externalAdReply, not at the contextInfo top level.
UPDATE webhook_events
SET
  ctwa_clid          = COALESCE(ctwa_clid,          json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.ctwaClid')),
  entry_point_source = COALESCE(entry_point_source, json_extract(raw_payload, '$.message.content.contextInfo.entryPointConversionSource')),
  entry_point_app    = COALESCE(entry_point_app,    json_extract(raw_payload, '$.message.content.contextInfo.entryPointConversionApp')),
  ad_source_id       = COALESCE(ad_source_id,       json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.sourceID')),
  ad_source_url      = COALESCE(ad_source_url,      json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.sourceURL')),
  ad_title           = COALESCE(ad_title,           json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.title')),
  ad_body            = COALESCE(ad_body,            json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.body')),
  is_ctwa            = CASE WHEN json_extract(raw_payload, '$.message.content.contextInfo.externalAdReply.ctwaClid') IS NOT NULL THEN 1 ELSE COALESCE(is_ctwa, 0) END,
  message_content    = COALESCE(
                         message_content,
                         substr(json_extract(raw_payload, '$.message.text'), 1, 2000),
                         substr(json_extract(raw_payload, '$.message.content.text'), 1, 2000)
                       )
WHERE raw_payload IS NOT NULL;

INSERT OR IGNORE INTO conversions (
  ctwa_clid, first_seen_at, webhook_event_id,
  sender_pn, sender_name, instance_name,
  ad_id, ad_source_url, ad_title, ad_body,
  entry_point_app, entry_point_source, ctwa_payload_b64,
  lead_status
)
SELECT
  we.ctwa_clid,
  we.received_at,
  we.id,
  replace(replace(we.sender_pn, '@s.whatsapp.net', ''), '@lid', ''),
  we.sender_name,
  we.instance_name,
  we.ad_source_id,
  we.ad_source_url,
  we.ad_title,
  we.ad_body,
  we.entry_point_app,
  we.entry_point_source,
  COALESCE(
    json_extract(we.raw_payload, '$.message.content.contextInfo.ctwaPayload'),
    json_extract(we.raw_payload, '$.message.content.contextInfo.conversionData')
  ),
  'pending'
FROM webhook_events we
WHERE we.is_ctwa = 1
  AND we.ctwa_clid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM conversions c WHERE c.ctwa_clid = we.ctwa_clid);

-- Quick verification queries (run separately, not via --file):
--   SELECT COUNT(*) FROM webhook_events WHERE is_ctwa = 1;
--   SELECT COUNT(*) FROM conversions;
--   SELECT id, ctwa_clid, sender_pn, ad_id, lead_status FROM conversions ORDER BY first_seen_at DESC;
