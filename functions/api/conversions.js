// GET /api/conversions
//
// Lists conversions joined with meta_ads_cache so each row carries
// campaign/adset/ad names when known. Filters: lead_status, campaign_id,
// ad_id, since (unix ms), limit, offset. Auth: x-webhook-token.

export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (auth) return auth;

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const leadStatus = url.searchParams.get('lead_status');
  const campaignId = url.searchParams.get('campaign_id');
  const adId = url.searchParams.get('ad_id');
  const since = url.searchParams.get('since');

  const where = [];
  const params = [];
  if (leadStatus) { where.push('c.lead_status = ?'); params.push(leadStatus); }
  if (campaignId) { where.push('mac.campaign_id = ?'); params.push(campaignId); }
  if (adId)       { where.push('c.ad_id = ?'); params.push(adId); }
  if (since) {
    const n = Number(since);
    if (Number.isFinite(n)) { where.push('c.first_seen_at >= ?'); params.push(n); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const listSql = `
    SELECT
      c.id, c.ctwa_clid, c.first_seen_at, c.webhook_event_id,
      c.sender_pn, c.sender_name, c.instance_name,
      c.ad_id, c.ad_source_url, c.ad_title, c.ad_body,
      c.entry_point_app, c.entry_point_source,
      c.lead_status, c.lead_event_id, c.lead_sent_at,
      c.lead_attempts, c.lead_next_attempt_at, c.lead_last_error,
      c.purchase_status, c.purchase_sent_at, c.purchase_value, c.purchase_currency,
      c.qualified_lead_status, c.qualified_lead_sent_at,
      mac.ad_name, mac.adset_id, mac.adset_name,
      mac.campaign_id, mac.campaign_name, mac.campaign_objective,
      mac.effective_status AS ad_effective_status, mac.fetched_at AS ad_fetched_at
    FROM conversions c
    LEFT JOIN meta_ads_cache mac ON mac.ad_id = c.ad_id
    ${whereSql}
    ORDER BY c.first_seen_at DESC
    LIMIT ? OFFSET ?
  `;
  const countSql = `
    SELECT COUNT(*) AS n
    FROM conversions c
    LEFT JOIN meta_ads_cache mac ON mac.ad_id = c.ad_id
    ${whereSql}
  `;
  const summarySql = `
    SELECT lead_status, COUNT(*) AS n
    FROM conversions
    GROUP BY lead_status
  `;

  const [list, count, summary] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limit, offset).all(),
    env.DB.prepare(countSql).bind(...params).first(),
    env.DB.prepare(summarySql).all(),
  ]);

  const byStatus = {};
  for (const r of summary.results ?? []) byStatus[r.lead_status] = r.n;

  return json({
    conversions: list.results ?? [],
    count: count?.n ?? 0,
    limit,
    offset,
    summary: byStatus,
  });
}

function checkAuth(request, env) {
  const token =
    request.headers.get('x-webhook-token') ||
    new URL(request.url).searchParams.get('token');
  if (!token || token !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  return null;
}

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
