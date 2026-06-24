// GET /api/health?key=...&days=30   (or ?from=&to=)
//
// Tracking-health metrics for the dashboard, aggregated from event_log over the
// window. Auth: DASH_KEY. (The dash template fetched /api/events?limit=1 for a
// `recovery` blob, but that endpoint is WEBHOOK_SECRET-gated and returns no such
// field — this purpose-built endpoint replaces it for the operator dashboard.)
//
// Response: {
//   days,
//   recovery: {
//     total_events, real_events,
//     itp_recovered,       // fbp resolved from the middleware HTTP cookie
//     adblock_recovered,   // pixel JS sent no fbp/fbc, server-side still fired
//     fbp_from_pixel, fbp_from_middleware, fbp_from_session, fbp_none
//   }
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

  try {
    const row = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total_events,
        SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS real_events,
        SUM(CASE WHEN is_bot = 0 AND fbp_source = 'middleware_http' THEN 1 ELSE 0 END) AS itp_recovered,
        SUM(CASE WHEN is_bot = 0 AND pixel_was_blocked = 1 THEN 1 ELSE 0 END) AS adblock_recovered,
        SUM(CASE WHEN fbp_source = 'pixel_js' THEN 1 ELSE 0 END) AS fbp_from_pixel,
        SUM(CASE WHEN fbp_source = 'middleware_http' THEN 1 ELSE 0 END) AS fbp_from_middleware,
        SUM(CASE WHEN fbp_source = 'tracker_http' THEN 1 ELSE 0 END) AS fbp_from_session,
        SUM(CASE WHEN fbp_source = 'none' OR fbp_source IS NULL THEN 1 ELSE 0 END) AS fbp_none
      FROM event_log
      WHERE timestamp >= ? AND timestamp <= ?
    `).bind(since, until).first();

    const num = v => Number(v || 0);
    return json({
      days,
      recovery: {
        total_events: num(row?.total_events),
        real_events: num(row?.real_events),
        itp_recovered: num(row?.itp_recovered),
        adblock_recovered: num(row?.adblock_recovered),
        fbp_from_pixel: num(row?.fbp_from_pixel),
        fbp_from_middleware: num(row?.fbp_from_middleware),
        fbp_from_session: num(row?.fbp_from_session),
        fbp_none: num(row?.fbp_none),
      },
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
