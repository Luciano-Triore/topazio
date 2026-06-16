// GET /api/conversions/:id
//
// Returns one conversion + the full capi_events_log history for debugging.
// Auth: x-webhook-token.

export async function onRequestGet({ request, env, params }) {
  const token =
    request.headers.get('x-webhook-token') ||
    new URL(request.url).searchParams.get('token');
  if (!token || token !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  const conv = await env.DB.prepare(`
    SELECT
      c.*,
      mac.ad_name, mac.adset_id, mac.adset_name,
      mac.campaign_id, mac.campaign_name, mac.campaign_objective,
      mac.effective_status AS ad_effective_status, mac.fetched_at AS ad_fetched_at
    FROM conversions c
    LEFT JOIN meta_ads_cache mac ON mac.ad_id = c.ad_id
    WHERE c.id = ?
  `).bind(id).first();

  if (!conv) return json({ ok: false, error: 'not_found' }, 404);

  const log = await env.DB.prepare(`
    SELECT id, attempted_at, event_name, event_id,
           request_body, response_status, response_body, duration_ms, was_test
    FROM capi_events_log
    WHERE conversion_id = ?
    ORDER BY attempted_at DESC
  `).bind(id).all();

  return json({ conversion: conv, capi_log: log.results ?? [] });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
