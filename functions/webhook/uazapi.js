// POST /webhook/uazapi
//
// Phase 1 capture + Phase 2 CTWA fan-out. Auth via shared secret in
// `x-webhook-token` (fallback `?token=`). Always stores the raw payload first,
// then returns 200 fast. CAPI Lead fire (for CTWA-tagged messages) runs after
// the response via context.waitUntil — uazapi never waits on Meta.

import {
  extractCtwaContext,
  extractMessageText,
  normalizePhone,
  upsertConversion,
  fireLead,
  enrichAdIfStale,
} from '../lib/capi.js';

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  // 1. Auth
  const token =
    request.headers.get('x-webhook-token') ||
    new URL(request.url).searchParams.get('token');
  if (!token || token !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  // 2. Parse
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  // 3. Defensive extraction
  const m = payload?.message ?? {};
  const c = payload?.chat ?? {};

  const ctwa = extractCtwaContext(payload);
  const messageContent = extractMessageText(m);

  const row = {
    received_at: Date.now(),
    event_type: payload?.EventType ?? null,
    instance_name: payload?.instanceName ?? null,
    owner: payload?.owner ?? null,
    chat_source: payload?.chatSource ?? null,
    message_id: m.id ?? null,
    message_wa_id: m.messageid ?? null,
    chat_id: m.chatid ?? c.wa_chatid ?? null,
    chat_lid: m.chatlid ?? c.wa_chatlid ?? null,
    sender_pn: m.sender_pn ?? null,
    sender_lid: m.sender_lid ?? m.sender ?? null,
    sender_name: m.senderName ?? c.wa_name ?? null,
    from_me: m.fromMe ? 1 : 0,
    is_group: m.isGroup ? 1 : 0,
    group_name: m.groupName ?? null,
    message_type: m.messageType ?? m.type ?? null,
    message_media: m.mediaType ?? null,
    message_content: messageContent ? messageContent.slice(0, 2000) : null,
    message_ts: m.messageTimestamp ?? null,
    track_id: nonEmpty(m.track_id),
    track_source: nonEmpty(m.track_source),
    has_track_data: nonEmpty(m.track_id) || nonEmpty(m.track_source) ? 1 : 0,
    // CTWA columns (Phase 2)
    ctwa_clid: ctwa?.ctwaClid ?? null,
    entry_point_source: ctwa?.entryPointSource ?? null,
    entry_point_app: ctwa?.entryPointApp ?? null,
    ad_source_id: ctwa?.ad?.sourceID ?? null,
    ad_source_url: ctwa?.ad?.sourceURL ?? null,
    ad_title: ctwa?.ad?.title ?? null,
    ad_body: ctwa?.ad?.body ?? null,
    is_ctwa: ctwa ? 1 : 0,
    raw_payload: JSON.stringify(payload),
  };

  // 4. Insert webhook_events
  const stmt = env.DB.prepare(`
    INSERT INTO webhook_events (
      received_at, event_type, instance_name, owner, chat_source,
      message_id, message_wa_id, chat_id, chat_lid,
      sender_pn, sender_lid, sender_name, from_me,
      is_group, group_name,
      message_type, message_media, message_content, message_ts,
      track_id, track_source, has_track_data,
      ctwa_clid, entry_point_source, entry_point_app,
      ad_source_id, ad_source_url, ad_title, ad_body, is_ctwa,
      raw_payload
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?
    )
  `).bind(
    row.received_at, row.event_type, row.instance_name, row.owner, row.chat_source,
    row.message_id, row.message_wa_id, row.chat_id, row.chat_lid,
    row.sender_pn, row.sender_lid, row.sender_name, row.from_me,
    row.is_group, row.group_name,
    row.message_type, row.message_media, row.message_content, row.message_ts,
    row.track_id, row.track_source, row.has_track_data,
    row.ctwa_clid, row.entry_point_source, row.entry_point_app,
    row.ad_source_id, row.ad_source_url, row.ad_title, row.ad_body, row.is_ctwa,
    row.raw_payload,
  );

  const result = await stmt.run();
  const insertedId = result.meta.last_row_id;

  // 5. CTWA fan-out: upsert conversion + async Lead fire
  if (ctwa) {
    const phone = normalizePhone(row.sender_pn);
    const eventTime = row.message_ts
      ? Math.floor(Number(row.message_ts) / 1000)
      : Math.floor(Date.now() / 1000);

    const up = await upsertConversion(env, {
      ctwa_clid: ctwa.ctwaClid,
      first_seen_at: Date.now(),
      webhook_event_id: insertedId,
      sender_pn: phone,
      sender_name: row.sender_name,
      instance_name: row.instance_name,
      ad_id: ctwa.ad.sourceID,
      ad_source_url: ctwa.ad.sourceURL,
      ad_title: ctwa.ad.title,
      ad_body: ctwa.ad.body,
      entry_point_app: ctwa.entryPointApp,
      entry_point_source: ctwa.entryPointSource,
      ctwa_payload_b64: ctwa.ctwaPayloadB64,
    });

    if (up.wasNew) {
      // Fire-and-forget — response returns immediately. The Lead POST (with
      // inline retry) and the ad-name enrichment both run after the 200.
      waitUntil(
        Promise.allSettled([
          fireLead(env, {
            conversionId: up.conversionId,
            ctwaClid: ctwa.ctwaClid,
            ad: ctwa.ad,
            phone,
            eventTime,
          }),
          enrichAdIfStale(env, ctwa.ad.sourceID),
        ]),
      );
    }

    return jsonResponse(
      { ok: true, id: insertedId, conversion_id: up.conversionId, new_conversion: up.wasNew },
      200,
    );
  }

  return jsonResponse({ ok: true, id: insertedId }, 200);
}

function nonEmpty(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
