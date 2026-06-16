// functions/lib/capi.js
//
// CTWA extraction + Meta Conversions API for Business Messaging.
// Pure-ish module: extractors are pure; D1/fetch helpers take `env` and return
// plain objects. No throws on missing creds — sendCapiEvent returns a "skipped"
// shape so capture-only mode keeps working.

const GRAPH_VERSION = 'v25.0';
const PARTNER_AGENT = 'krob-wa-tracer/0.1';
const AD_CACHE_TTL_MS = 7 * 24 * 3600_000;

// Inline retry: fireLead runs inside context.waitUntil(), so it can keep
// retrying transient failures after the 200 already went back to uazapi.
// 5 attempts, short backoff — worst case ~35s, well within the Worker
// lifetime. Sustained outages are not retried (no cron); use /api/retry-pending.
const INLINE_ATTEMPTS = 5;
const INLINE_BACKOFF_MS = [1500, 4000, 10000, 20000];

// ---------- pure extractors ------------------------------------------------

export function extractMessageText(message) {
  if (!message) return null;
  // Conversation (flat) — message.text is the body
  if (typeof message.text === 'string' && message.text.length > 0) {
    return message.text;
  }
  if (typeof message.content === 'string' && message.content.length > 0) {
    return message.content;
  }
  // ExtendedTextMessage (structured) — content is an object with text inside
  if (message.content && typeof message.content === 'object') {
    const t = message.content.text;
    if (typeof t === 'string' && t.length > 0) return t;
  }
  return null;
}

export function extractCtwaContext(payload) {
  const m = payload?.message;
  if (!m) return null;
  // CTWA data is only present when content is structured (ExtendedTextMessage)
  const ctx = m?.content && typeof m.content === 'object' ? m.content.contextInfo : null;
  if (!ctx) return null;
  const ad = ctx.externalAdReply ?? {};
  // ctwaClid lives INSIDE externalAdReply, not at the contextInfo top level.
  // Fall back to ctx.ctwaClid just in case Meta ever surfaces it there.
  const ctwaClid = strOrNull(ad.ctwaClid ?? ctx.ctwaClid);
  if (!ctwaClid) return null;
  return {
    ctwaClid,
    entryPointSource: strOrNull(ctx.entryPointConversionSource),
    entryPointApp: strOrNull(ctx.entryPointConversionApp),
    ad: {
      sourceID: strOrNull(ad.sourceID),
      sourceURL: strOrNull(ad.sourceURL),
      title: strOrNull(ad.title),
      body: strOrNull(ad.body),
      greetingMessageBody: strOrNull(ad.greetingMessageBody),
    },
    ctwaPayloadB64: strOrNull(ctx.ctwaPayload ?? ctx.conversionData),
  };
}

// "555381048894@s.whatsapp.net" -> "555381048894"
export function normalizePhone(senderPn) {
  if (!senderPn) return null;
  const s = String(senderPn).split('@')[0].replace(/\D/g, '');
  return s.length > 0 ? s : null;
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Meta CAPI event builders --------------------------------------

export async function buildLeadEvent({ env, ctwaClid, ad, phone, eventTime }) {
  const userData = { ctwa_clid: ctwaClid };
  if (env.META_PAGE_ID) userData.page_id = env.META_PAGE_ID;
  if (phone) userData.ph = [await sha256Hex(phone)];

  // business_messaging only accepts 'LeadSubmitted' or 'Purchase' as event_name.
  // custom_data carries currency+value like Purchase does (value 0 for a lead).
  const customData = { currency: env.META_CURRENCY || 'BRL', value: 0 };
  if (ad?.sourceID) customData.ad_id = ad.sourceID;

  const event = {
    event_name: env.META_LEAD_EVENT_NAME || 'LeadSubmitted',
    event_time: eventTime,
    event_id: ctwaClid,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
    custom_data: customData,
  };

  const body = { data: [event], partner_agent: PARTNER_AGENT };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  return body;
}

export async function buildPurchaseEvent({ env, ctwaClid, phone, value, currency, orderId, eventTime }) {
  const userData = { ctwa_clid: ctwaClid };
  if (env.META_PAGE_ID) userData.page_id = env.META_PAGE_ID;
  if (phone) userData.ph = [await sha256Hex(phone)];

  const event = {
    event_name: env.META_PURCHASE_EVENT_NAME || 'Purchase',
    event_time: eventTime,
    event_id: `${ctwaClid}:purchase${orderId ? ':' + orderId : ''}`,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
    custom_data: { currency: currency || env.META_CURRENCY || 'BRL', value },
  };
  const body = { data: [event], partner_agent: PARTNER_AGENT };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  return body;
}

export async function buildQualifiedLeadEvent({ env, ctwaClid, adId, phone, eventTime }) {
  const userData = { ctwa_clid: ctwaClid };
  if (env.META_PAGE_ID) userData.page_id = env.META_PAGE_ID;
  if (phone) userData.ph = [await sha256Hex(phone)];

  // business_messaging now accepts 'QualifiedLead' (see docs/env-vars.md). A
  // qualified lead carries no value — custom_data only optionally tags the ad.
  const customData = {};
  if (adId) customData.ad_id = adId;

  const event = {
    event_name: env.META_QUALIFIED_LEAD_EVENT_NAME || 'QualifiedLead',
    event_time: eventTime,
    event_id: `${ctwaClid}:qualified`,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
  };
  if (Object.keys(customData).length) event.custom_data = customData;

  const body = { data: [event], partner_agent: PARTNER_AGENT };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  return body;
}

// ---------- HTTP to Meta ---------------------------------------------------

export async function sendCapiEvent(env, body) {
  const t0 = Date.now();
  if (!env.META_DATASET_ID || !env.META_CAPI_TOKEN) {
    const missing = [
      !env.META_DATASET_ID && 'META_DATASET_ID',
      !env.META_CAPI_TOKEN && 'META_CAPI_TOKEN',
    ].filter(Boolean).join(',');
    return { ok: false, status: 0, body: `skipped: missing ${missing}`, duration_ms: 0 };
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(env.META_DATASET_ID)}/events`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${env.META_CAPI_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, body: text, duration_ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: 0, body: `fetch_error: ${err?.message ?? err}`, duration_ms: Date.now() - t0 };
  }
}

// ---------- Marketing API enrichment --------------------------------------

export async function enrichAd(env, adId) {
  if (!env.META_CAPI_TOKEN) {
    return { ok: false, status: 0, body: 'skipped: missing META_CAPI_TOKEN' };
  }
  const fields = [
    'name', 'effective_status',
    'adset{id,name,daily_budget,lifetime_budget,optimization_goal}',
    'campaign{id,name,objective,buying_type,daily_budget,lifetime_budget}',
  ].join(',');
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(adId)}?fields=${encodeURIComponent(fields)}`;
  let resp, text;
  try {
    resp = await fetch(url, { headers: { authorization: `Bearer ${env.META_CAPI_TOKEN}` } });
    text = await resp.text();
  } catch (err) {
    return { ok: false, status: 0, body: `fetch_error: ${err?.message ?? err}` };
  }
  if (!resp.ok) return { ok: false, status: resp.status, body: text };

  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, status: resp.status, body: `parse_error: ${text}` }; }

  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO meta_ads_cache (ad_id, fetched_at, expires_at, ad_name, adset_id, adset_name, campaign_id, campaign_name, campaign_objective, effective_status, raw_response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ad_id) DO UPDATE SET
      fetched_at=excluded.fetched_at, expires_at=excluded.expires_at,
      ad_name=excluded.ad_name, adset_id=excluded.adset_id, adset_name=excluded.adset_name,
      campaign_id=excluded.campaign_id, campaign_name=excluded.campaign_name,
      campaign_objective=excluded.campaign_objective, effective_status=excluded.effective_status,
      raw_response=excluded.raw_response
  `).bind(
    adId, now, now + AD_CACHE_TTL_MS,
    parsed.name ?? null,
    parsed.adset?.id ?? null,
    parsed.adset?.name ?? null,
    parsed.campaign?.id ?? null,
    parsed.campaign?.name ?? null,
    parsed.campaign?.objective ?? null,
    parsed.effective_status ?? null,
    text,
  ).run();

  return { ok: true, status: resp.status, body: text };
}

// Enrich only if not already cached fresh — cheap to call on every CTWA hit.
export async function enrichAdIfStale(env, adId) {
  if (!adId) return { ok: false, body: 'no_ad_id' };
  const cached = await env.DB.prepare(
    'SELECT expires_at FROM meta_ads_cache WHERE ad_id = ?',
  ).bind(adId).first();
  if (cached && cached.expires_at > Date.now()) return { ok: true, cached: true };
  return enrichAd(env, adId);
}

// ---------- D1 helpers -----------------------------------------------------

// Idempotent upsert of a conversion row keyed by ctwa_clid.
// Returns { wasNew, conversionId, status }.
export async function upsertConversion(env, fields) {
  const now = fields.first_seen_at ?? Date.now();
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO conversions (
      ctwa_clid, first_seen_at, webhook_event_id,
      sender_pn, sender_name, instance_name,
      ad_id, ad_source_url, ad_title, ad_body,
      entry_point_app, entry_point_source, ctwa_payload_b64,
      lead_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    fields.ctwa_clid, now, fields.webhook_event_id ?? null,
    fields.sender_pn ?? null, fields.sender_name ?? null, fields.instance_name ?? null,
    fields.ad_id ?? null, fields.ad_source_url ?? null, fields.ad_title ?? null, fields.ad_body ?? null,
    fields.entry_point_app ?? null, fields.entry_point_source ?? null, fields.ctwa_payload_b64 ?? null,
    'pending',
  ).run();

  const wasNew = (insert.meta?.changes ?? 0) > 0;
  const row = await env.DB.prepare(
    'SELECT id, lead_status FROM conversions WHERE ctwa_clid = ?',
  ).bind(fields.ctwa_clid).first();
  return { wasNew, conversionId: row?.id ?? null, status: row?.lead_status ?? null };
}

export async function logCapiAttempt(env, { conversionId, eventName, eventId, requestBody, response, wasTest }) {
  await env.DB.prepare(`
    INSERT INTO capi_events_log (
      conversion_id, attempted_at, event_name, event_id,
      request_body, response_status, response_body, duration_ms, was_test
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    conversionId ?? null,
    Date.now(),
    eventName,
    eventId ?? null,
    requestBody ? JSON.stringify(requestBody) : null,
    response.status ?? null,
    response.body ?? null,
    response.duration_ms ?? null,
    wasTest ? 1 : 0,
  ).run();
}

// A failure worth retrying: network/fetch error, rate limit, or Meta 5xx.
// A 4xx (bad token, malformed request) won't fix itself — fail fast.
function isRetryable(response) {
  if (response.status === 0) return true; // network/fetch error (skipped handled separately)
  if (response.status === 429) return true;
  return response.status >= 500;
}

// fireLead orchestrates: build → (send → log)×N with inline backoff → update row.
// Safe to call from waitUntil() — the 200 already went back to uazapi, and this
// keeps retrying transient failures for ~35s worst case without blocking it.
export async function fireLead(env, { conversionId, ctwaClid, ad, phone, eventTime }) {
  const body = await buildLeadEvent({ env, ctwaClid, ad, phone, eventTime });
  const wasTest = !!env.META_TEST_EVENT_CODE;
  const eventName = body.data[0].event_name; // may be customized via META_LEAD_EVENT_NAME

  await env.DB.prepare(
    "UPDATE conversions SET lead_status='sending' WHERE id = ?",
  ).bind(conversionId).run();

  let response;
  let attempts = 0;
  while (attempts < INLINE_ATTEMPTS) {
    if (attempts > 0) {
      await sleep(INLINE_BACKOFF_MS[Math.min(attempts - 1, INLINE_BACKOFF_MS.length - 1)]);
    }
    response = await sendCapiEvent(env, body);
    attempts++;
    await logCapiAttempt(env, {
      conversionId, eventName, eventId: ctwaClid,
      requestBody: body, response, wasTest,
    });

    if (response.ok) {
      await env.DB.prepare(`
        UPDATE conversions
        SET lead_status='sent', lead_event_id=?, lead_sent_at=?,
            lead_attempts=lead_attempts+?, lead_last_error=NULL, lead_next_attempt_at=NULL
        WHERE id = ?
      `).bind(ctwaClid, Date.now(), attempts, conversionId).run();
      return { status: 'sent', attempts };
    }

    if (response.status === 0 && response.body?.startsWith('skipped:')) {
      await env.DB.prepare(`
        UPDATE conversions
        SET lead_status='skipped_no_creds', lead_attempts=lead_attempts+?, lead_last_error=?
        WHERE id = ?
      `).bind(attempts, response.body, conversionId).run();
      return { status: 'skipped_no_creds', attempts };
    }

    if (!isRetryable(response)) break; // 4xx — stop, retrying won't help
  }

  await env.DB.prepare(`
    UPDATE conversions
    SET lead_status='failed', lead_attempts=lead_attempts+?, lead_last_error=?
    WHERE id = ?
  `).bind(attempts, truncate(response?.body, 500), conversionId).run();
  return { status: 'failed', attempts };
}

// firePurchase: the Purchase twin of fireLead. Triggered manually (from the
// inspector via POST /api/fire-purchase), not by a detector — so it takes the
// value/currency the operator entered. Same build → (send → log)×N → update
// shape, writing the purchase_* columns instead of lead_*. event_id is stable
// per contact (ctwa_clid:purchase) so re-fires dedup at Meta within 48h rather
// than double-counting; pass orderId only if you intend a distinct purchase.
export async function firePurchase(env, { conversionId, ctwaClid, phone, value, currency, orderId, eventTime }) {
  const cur = currency || env.META_CURRENCY || 'BRL';
  const body = await buildPurchaseEvent({ env, ctwaClid, phone, value, currency: cur, orderId, eventTime });
  const wasTest = !!env.META_TEST_EVENT_CODE;
  const eventName = body.data[0].event_name; // 'Purchase' (or META_PURCHASE_EVENT_NAME)
  const eventId = body.data[0].event_id;

  await env.DB.prepare(
    "UPDATE conversions SET purchase_status='sending' WHERE id = ?",
  ).bind(conversionId).run();

  let response;
  let attempts = 0;
  while (attempts < INLINE_ATTEMPTS) {
    if (attempts > 0) {
      await sleep(INLINE_BACKOFF_MS[Math.min(attempts - 1, INLINE_BACKOFF_MS.length - 1)]);
    }
    response = await sendCapiEvent(env, body);
    attempts++;
    await logCapiAttempt(env, {
      conversionId, eventName, eventId,
      requestBody: body, response, wasTest,
    });

    if (response.ok) {
      await env.DB.prepare(`
        UPDATE conversions
        SET purchase_status='sent', purchase_event_id=?, purchase_sent_at=?,
            purchase_value=?, purchase_currency=?,
            purchase_attempts=purchase_attempts+?, purchase_last_error=NULL, purchase_next_attempt_at=NULL
        WHERE id = ?
      `).bind(eventId, Date.now(), value, cur, attempts, conversionId).run();
      return { status: 'sent', attempts };
    }

    if (response.status === 0 && response.body?.startsWith('skipped:')) {
      await env.DB.prepare(`
        UPDATE conversions
        SET purchase_status='skipped_no_creds', purchase_attempts=purchase_attempts+?, purchase_last_error=?
        WHERE id = ?
      `).bind(attempts, response.body, conversionId).run();
      return { status: 'skipped_no_creds', attempts };
    }

    if (!isRetryable(response)) break; // 4xx — stop, retrying won't help
  }

  await env.DB.prepare(`
    UPDATE conversions
    SET purchase_status='failed', purchase_attempts=purchase_attempts+?, purchase_last_error=?
    WHERE id = ?
  `).bind(attempts, truncate(response?.body, 500), conversionId).run();
  return { status: 'failed', attempts };
}

// fireQualifiedLead: the Qualified-Lead twin of firePurchase. Triggered manually
// (from the inspector via POST /api/fire-qualified-lead) when an operator decides
// a CTWA contact is genuinely qualified. No value — just a QualifiedLead fire.
// Same build → (send → log)×N → update shape, writing the qualified_lead_*
// columns. event_id is stable per contact (ctwa_clid:qualified) so re-fires dedup
// at Meta rather than double-counting.
export async function fireQualifiedLead(env, { conversionId, ctwaClid, adId, phone, eventTime }) {
  const body = await buildQualifiedLeadEvent({ env, ctwaClid, adId, phone, eventTime });
  const wasTest = !!env.META_TEST_EVENT_CODE;
  const eventName = body.data[0].event_name; // 'QualifiedLead' (or META_QUALIFIED_LEAD_EVENT_NAME)
  const eventId = body.data[0].event_id;

  await env.DB.prepare(
    "UPDATE conversions SET qualified_lead_status='sending' WHERE id = ?",
  ).bind(conversionId).run();

  let response;
  let attempts = 0;
  while (attempts < INLINE_ATTEMPTS) {
    if (attempts > 0) {
      await sleep(INLINE_BACKOFF_MS[Math.min(attempts - 1, INLINE_BACKOFF_MS.length - 1)]);
    }
    response = await sendCapiEvent(env, body);
    attempts++;
    await logCapiAttempt(env, {
      conversionId, eventName, eventId,
      requestBody: body, response, wasTest,
    });

    if (response.ok) {
      await env.DB.prepare(`
        UPDATE conversions
        SET qualified_lead_status='sent', qualified_lead_event_id=?, qualified_lead_sent_at=?,
            qualified_lead_attempts=qualified_lead_attempts+?, qualified_lead_last_error=NULL, qualified_lead_next_attempt_at=NULL
        WHERE id = ?
      `).bind(eventId, Date.now(), attempts, conversionId).run();
      return { status: 'sent', attempts };
    }

    if (response.status === 0 && response.body?.startsWith('skipped:')) {
      await env.DB.prepare(`
        UPDATE conversions
        SET qualified_lead_status='skipped_no_creds', qualified_lead_attempts=qualified_lead_attempts+?, qualified_lead_last_error=?
        WHERE id = ?
      `).bind(attempts, response.body, conversionId).run();
      return { status: 'skipped_no_creds', attempts };
    }

    if (!isRetryable(response)) break; // 4xx — stop, retrying won't help
  }

  await env.DB.prepare(`
    UPDATE conversions
    SET qualified_lead_status='failed', qualified_lead_attempts=qualified_lead_attempts+?, qualified_lead_last_error=?
    WHERE id = ?
  `).bind(attempts, truncate(response?.body, 500), conversionId).run();
  return { status: 'failed', attempts };
}

// ---------- internals ------------------------------------------------------

function strOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) : s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
