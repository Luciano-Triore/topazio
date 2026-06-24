// GET /api/wa-conversions?key=...&days=30   (or ?from=&to=)
//
// WhatsApp / Click-to-WhatsApp conversions for the TRIORE dashboard. This is
// the end of the funnel the operator cares about: who actually reached WhatsApp
// from an ad, and whether the Meta CAPI `LeadSubmitted` fired for them.
//
// Auth: DASH_KEY (the operator dashboard). NOTE: /api/conversions already
// exists but is gated by WEBHOOK_SECRET (used by the public/ inspector) — we
// keep that one untouched and expose this DASH_KEY-scoped, date-windowed view
// for the dashboard.
//
// Source: conversions LEFT JOIN meta_ads_cache (ad name/campaign when known),
// windowed on conversions.first_seen_at.
//
// Response: {
//   days, count,
//   conversions: [ { first_seen_at, sender_name, sender_pn, ad_title,
//                    ad_name, campaign_name, lead_status, qualified_lead_status,
//                    purchase_status, lead_last_error } ],
//   summary: { <lead_status>: <n> }   // over the window
// }

import { resolveWindow } from '../lib/range.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { sinceTs: since, untilTs: until, days } = resolveWindow(url);
  const limit = clampInt(url.searchParams.get('limit'), 200, 1, 500);

  try {
    const rows = await env.DB.prepare(`
      SELECT
        c.id,
        c.first_seen_at,
        c.sender_name,
        c.sender_pn,
        c.ad_id,
        c.ad_title,
        c.ad_source_url,
        c.entry_point_app,
        c.entry_point_source,
        c.lead_status,
        c.lead_sent_at,
        c.lead_last_error,
        c.qualified_lead_status,
        c.purchase_status,
        mac.ad_name,
        mac.campaign_name,
        mac.adset_name
      FROM conversions c
      LEFT JOIN meta_ads_cache mac ON mac.ad_id = c.ad_id
      WHERE c.first_seen_at >= ? AND c.first_seen_at <= ?
      ORDER BY c.first_seen_at DESC
      LIMIT ?
    `).bind(since, until, limit).all();

    const summaryRows = await env.DB.prepare(`
      SELECT COALESCE(lead_status, 'unknown') AS lead_status, COUNT(*) AS n
      FROM conversions
      WHERE first_seen_at >= ? AND first_seen_at <= ?
      GROUP BY lead_status
    `).bind(since, until).all();

    const summary = {};
    for (const r of summaryRows.results || []) summary[r.lead_status] = Number(r.n || 0);

    return json({
      days,
      count: (rows.results || []).length,
      conversions: rows.results || [],
      summary,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
