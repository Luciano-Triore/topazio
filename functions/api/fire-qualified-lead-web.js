// POST /api/fire-qualified-lead-web
//
// Manually fire a Meta CAPI QualifiedLead for a WEBSITE lead (the Topázio LP
// funnel: ad → LP → form → WhatsApp). Triggered from the dashboard's
// WhatsApp/Comercial tab — the attendant marks a lead as qualified.
//
// Unlike /api/fire-qualified-lead (CTWA-only, business_messaging + ctwa_clid),
// this fires a `website` event matched by the lead's session fbp/fbc/external_id
// (+ hashed email if the form collected one). The lead lives in event_log; its
// attribution lives in the joined sessions row.
//
// Auth: ?key=<DASH_KEY> — same single secret the dashboard uses to read.
// Body: { event_id, force? }. event_id is the original Lead's event_id.
// Stable dedup: the QualifiedLead event_id is `<event_id>:qualified`, so a
// re-fire dedups at Meta within 48h rather than double-counting.

const GRAPH_VERSION = 'v25.0';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const eventId = String(body?.event_id || '').trim();
  const force = body?.force === true;
  if (!eventId) return json({ ok: false, error: 'missing_event_id' }, 400);

  // The lead + its originating session (carries the Meta identifiers).
  const lead = await env.DB.prepare(`
    SELECT
      e.event_id, e.session_id, e.timestamp, e.raw_email, e.qualified_lead_status,
      s.fbp, s.fbc, s.external_id, s.landing_url, s.ip_address, s.user_agent
    FROM event_log e
    LEFT JOIN sessions s ON e.session_id = s.session_id
    WHERE e.event_id = ? AND e.event_name = 'Lead'
    LIMIT 1
  `).bind(eventId).first();

  if (!lead) return json({ ok: false, error: 'lead_not_found' }, 404);
  if (lead.qualified_lead_status === 'sent' && !force) {
    return json({ ok: false, error: 'already_sent', qualified_lead_status: 'sent' }, 409);
  }

  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    await env.DB.prepare(
      `UPDATE event_log SET qualified_lead_status='skipped_no_creds',
         qualified_lead_attempts=qualified_lead_attempts+1,
         qualified_lead_last_error=? WHERE event_id = ?`,
    ).bind('skipped: missing META_PIXEL_ID/META_ACCESS_TOKEN', eventId).run();
    return json({ ok: false, error: 'skipped_no_creds' }, 200);
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const qualEventId = `${eventId}:qualified`;

  const userData = {};
  if (lead.ip_address) userData.client_ip_address = lead.ip_address;
  if (lead.user_agent) userData.client_user_agent = lead.user_agent;
  if (lead.raw_email) userData.em = [await sha256(lead.raw_email)];
  if (lead.external_id) userData.external_id = [await sha256(lead.external_id)];
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;

  const payload = {
    data: [{
      event_name: env.META_QUALIFIED_LEAD_EVENT_NAME || 'QualifiedLead',
      event_time: eventTime,
      event_id: qualEventId,
      event_source_url: lead.landing_url || '',
      action_source: 'website',
      user_data: userData,
    }],
  };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  await env.DB.prepare(
    `UPDATE event_log SET qualified_lead_status='sending' WHERE event_id = ?`,
  ).bind(eventId).run();

  let status = 0, ok = false, respBody = '';
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    status = resp.status;
    ok = resp.ok;
    respBody = await resp.text();
  } catch (err) {
    respBody = `fetch_error: ${err?.message ?? err}`;
  }

  if (ok) {
    await env.DB.prepare(
      `UPDATE event_log SET qualified_lead_status='sent', qualified_lead_event_id=?,
         qualified_lead_sent_at=?, qualified_lead_attempts=qualified_lead_attempts+1,
         qualified_lead_last_error=NULL WHERE event_id = ?`,
    ).bind(qualEventId, Date.now(), eventTime, eventId).run();
    return json({ ok: true, qualified_lead_status: 'sent', meta_status: status });
  }

  await env.DB.prepare(
    `UPDATE event_log SET qualified_lead_status='failed',
       qualified_lead_attempts=qualified_lead_attempts+1,
       qualified_lead_last_error=? WHERE event_id = ?`,
  ).bind(truncate(respBody, 500), eventId).run();
  return json({ ok: false, qualified_lead_status: 'failed', meta_status: status, meta_body: respBody }, 502);
}

// Meta PII hashing: normalize (lowercase + trim) then SHA-256 hex — same as
// functions/tracker.js so the QualifiedLead matches the original Lead.
async function sha256(value) {
  const normalized = String(value).toLowerCase().trim();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) : s;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
