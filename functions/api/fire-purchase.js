// POST /api/fire-purchase
//
// Manually fire a Meta CAPI Purchase for a CTWA conversion (triggered from the
// inspector — select a contact, enter a value). Gated by the same x-webhook-token
// as the rest of the API. Body: { conversion_id, value, currency?, order_id?, force? }.
//
// A business_messaging Purchase needs a ctwa_clid to attribute back to the ad, so
// this only works on conversions (CTWA contacts). By default it refuses to re-fire
// a contact whose purchase already 'sent' — pass force:true to override.

import { firePurchase } from '../lib/capi.js';

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
  const value = Number(body?.value);
  const currency = body?.currency ? String(body.currency).trim().toUpperCase() : null;
  const orderId = body?.order_id ? String(body.order_id).trim() : null;
  const force = body?.force === true;

  if (!Number.isInteger(conversionId) || conversionId <= 0) {
    return json({ ok: false, error: 'invalid_conversion_id' }, 400);
  }
  if (!Number.isFinite(value) || value <= 0) {
    return json({ ok: false, error: 'invalid_value' }, 400);
  }

  const conv = await env.DB.prepare(
    'SELECT id, ctwa_clid, sender_pn, purchase_status FROM conversions WHERE id = ?',
  ).bind(conversionId).first();

  if (!conv) return json({ ok: false, error: 'conversion_not_found' }, 404);
  if (!conv.ctwa_clid) return json({ ok: false, error: 'no_ctwa_clid' }, 422);
  if (conv.purchase_status === 'sent' && !force) {
    return json({ ok: false, error: 'already_sent', purchase_status: 'sent' }, 409);
  }

  // The purchase happens now (must fall within the 7-day CTWA attribution window).
  const eventTime = Math.floor(Date.now() / 1000);

  const r = await firePurchase(env, {
    conversionId: conv.id,
    ctwaClid: conv.ctwa_clid,
    phone: conv.sender_pn,
    value,
    currency,
    orderId,
    eventTime,
  });

  return json(
    { ok: r.status === 'sent', purchase_status: r.status, attempts: r.attempts, value, currency: currency || env.META_CURRENCY || 'BRL' },
    r.status === 'sent' ? 200 : 502,
  );
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
