// POST /api/fire-qualified-lead
//
// Manually fire a Meta CAPI QualifiedLead for a CTWA conversion (triggered from
// the inspector — open a contact, click "mark qualified lead"). Gated by the same
// x-webhook-token as the rest of the API. Body: { conversion_id, force? }.
//
// A business_messaging event needs a ctwa_clid to attribute back to the ad, so this
// only works on conversions (CTWA contacts). A qualified lead carries no value. By
// default it refuses to re-fire a contact already 'sent' — pass force:true to override.

import { fireQualifiedLead } from '../lib/capi.js';

export async function onRequestPost({ request, env }) {
  const token =
    request.headers.get('x-webhook-token') ||
    new URL(request.url).searchParams.get('token');
  if (!token || token !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const conversionId = Number(body?.conversion_id);
  const force = body?.force === true;

  if (!Number.isInteger(conversionId) || conversionId <= 0) {
    return json({ ok: false, error: 'invalid_conversion_id' }, 400);
  }

  const conv = await env.DB.prepare(
    'SELECT id, ctwa_clid, sender_pn, ad_id, qualified_lead_status FROM conversions WHERE id = ?',
  ).bind(conversionId).first();

  if (!conv) return json({ ok: false, error: 'conversion_not_found' }, 404);
  if (!conv.ctwa_clid) return json({ ok: false, error: 'no_ctwa_clid' }, 422);
  if (conv.qualified_lead_status === 'sent' && !force) {
    return json({ ok: false, error: 'already_sent', qualified_lead_status: 'sent' }, 409);
  }

  // The qualification happens now (must fall within the 7-day CTWA attribution window).
  const eventTime = Math.floor(Date.now() / 1000);

  const r = await fireQualifiedLead(env, {
    conversionId: conv.id,
    ctwaClid: conv.ctwa_clid,
    adId: conv.ad_id,
    phone: conv.sender_pn,
    eventTime,
  });

  return json(
    { ok: r.status === 'sent', qualified_lead_status: r.status, attempts: r.attempts },
    r.status === 'sent' ? 200 : 502,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
