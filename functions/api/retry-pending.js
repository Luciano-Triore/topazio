// POST /api/retry-pending
//
// Manual recovery endpoint (NOT a cron). Gated by the same x-webhook-token as
// the rest of the API. Re-fires every conversion that isn't 'sent' yet and
// enriches any ad_id missing from the cache. Use it to flush the backfilled
// conversion, recover after a Meta outage, or backfill ad names on demand.

import { fireLead, enrichAdIfStale } from '../lib/capi.js';

const RETRY_LIMIT = 50;
const ENRICH_LIMIT = 50;

export async function onRequestPost({ request, env }) {
  const token =
    request.headers.get('x-webhook-token') ||
    new URL(request.url).searchParams.get('token');
  if (!token || token !== env.WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const result = { leads_retried: 0, leads_sent: 0, ads_enriched: 0, errors: [] };

  // 1. Re-fire conversions that never reached 'sent'
  try {
    const pending = await env.DB.prepare(`
      SELECT c.id, c.ctwa_clid, c.ad_id, c.ad_source_url, c.ad_title, c.ad_body,
             c.sender_pn, c.first_seen_at,
             (SELECT message_ts FROM webhook_events WHERE id = c.webhook_event_id) AS message_ts_hint
      FROM conversions c
      WHERE c.lead_status IN ('pending', 'failed', 'skipped_no_creds', 'sending')
      ORDER BY c.first_seen_at ASC
      LIMIT ?
    `).bind(RETRY_LIMIT).all();

    for (const c of pending.results ?? []) {
      const eventTime = c.message_ts_hint
        ? Math.floor(Number(c.message_ts_hint) / 1000)
        : Math.floor((c.first_seen_at ?? Date.now()) / 1000);
      try {
        const r = await fireLead(env, {
          conversionId: c.id,
          ctwaClid: c.ctwa_clid,
          ad: { sourceID: c.ad_id, sourceURL: c.ad_source_url, title: c.ad_title, body: c.ad_body },
          phone: c.sender_pn,
          eventTime,
        });
        result.leads_retried++;
        if (r.status === 'sent') result.leads_sent++;
      } catch (err) {
        result.errors.push(`lead ${c.id}: ${err?.message ?? err}`);
      }
    }
  } catch (err) {
    result.errors.push(`retry_query: ${err?.message ?? err}`);
  }

  // 2. Enrich ad_ids missing (or expired) from the cache
  try {
    const stale = await env.DB.prepare(`
      SELECT DISTINCT c.ad_id
      FROM conversions c
      LEFT JOIN meta_ads_cache mac ON mac.ad_id = c.ad_id
      WHERE c.ad_id IS NOT NULL
        AND (mac.ad_id IS NULL OR mac.expires_at <= ?)
      LIMIT ?
    `).bind(Date.now(), ENRICH_LIMIT).all();

    for (const r of stale.results ?? []) {
      try {
        const e = await enrichAdIfStale(env, r.ad_id);
        if (e.ok) result.ads_enriched++;
        else result.errors.push(`enrich ${r.ad_id}: ${e.status ?? ''} ${truncate(e.body, 150)}`);
      } catch (err) {
        result.errors.push(`enrich ${r.ad_id}: ${err?.message ?? err}`);
      }
    }
  } catch (err) {
    result.errors.push(`enrich_query: ${err?.message ?? err}`);
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) : s;
}
