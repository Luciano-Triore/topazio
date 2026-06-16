CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- When WE received it (server timestamp, unix ms)
  received_at INTEGER NOT NULL,

  -- Top-level payload metadata
  event_type      TEXT,    -- payload.EventType  (e.g. "messages")
  instance_name   TEXT,    -- payload.instanceName
  owner           TEXT,    -- payload.owner
  chat_source     TEXT,    -- payload.chatSource

  -- Message identification
  message_id      TEXT,    -- payload.message.id  (full WA message id)
  message_wa_id   TEXT,    -- payload.message.messageid (short)
  chat_id         TEXT,    -- e.g. 5511000000000@s.whatsapp.net
  chat_lid        TEXT,    -- e.g. 10000000000000@lid

  -- Sender info
  sender_pn       TEXT,    -- real phone number (USE THIS FOR HASHING, never sender_lid)
  sender_lid      TEXT,
  sender_name     TEXT,
  from_me         INTEGER, -- 0 or 1

  -- Group context
  is_group        INTEGER, -- 0 or 1
  group_name      TEXT,

  -- Message content
  message_type    TEXT,    -- Conversation, image, audio, etc.
  message_media   TEXT,    -- mediaType field
  message_content TEXT,    -- the text body (truncate to 2000 chars for the column; full payload below)
  message_ts      INTEGER, -- payload.message.messageTimestamp

  -- THE TRACKING GOLD — these are the fields we are hunting for
  track_id        TEXT,    -- payload.message.track_id
  track_source    TEXT,    -- payload.message.track_source
  has_track_data  INTEGER, -- 1 if track_id OR track_source is non-empty, else 0

  -- The full unmodified payload, JSON-stringified. Source of truth.
  raw_payload     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_received_at    ON webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sender_pn      ON webhook_events(sender_pn);
CREATE INDEX IF NOT EXISTS idx_has_track_data ON webhook_events(has_track_data);
CREATE INDEX IF NOT EXISTS idx_message_id     ON webhook_events(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_id        ON webhook_events(chat_id);
