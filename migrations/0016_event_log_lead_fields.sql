-- Campos por-lead para a visão de atendimento do dashboard:
--   raw_name / raw_phone — nome e telefone em texto (o tracker só guardava o
--     e-mail; nome/telefone iam apenas hasheados pro Meta). Necessário para o
--     operador ver e contatar o lead a partir do /dash.
--   page — qual landing originou o lead ('A' = /topazio mulher 55+,
--     'B' = /topaziob homem 30-55). Enviado pela LP no corpo do /tracker.
--   wa_sent_at — flag manual "enviei WhatsApp para este lead" (unix seconds; 0 = não).
ALTER TABLE event_log ADD COLUMN raw_name   TEXT DEFAULT '';
ALTER TABLE event_log ADD COLUMN raw_phone  TEXT DEFAULT '';
ALTER TABLE event_log ADD COLUMN page       TEXT DEFAULT '';
ALTER TABLE event_log ADD COLUMN wa_sent_at INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_event_log_page ON event_log(page);
