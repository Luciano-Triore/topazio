// GET /api/leads?key=...&days=30&limit=100
//
// Returns Lead events joined to their originating session so each row carries
// its UTMs / fbclid / gclid. This is the "where did my leads come from" view
// — the whole reason the tracking stack persists anything at all.
//
// Source: event_log (Lead events only) LEFT JOIN sessions via session_id.
// Bots are excluded by default; pass include_bots=1 to see them.
//
// Window: ?days=N (trailing) OR ?from=YYYY-MM-DD&to=YYYY-MM-DD (absolute).

import { resolveWindow } from '../lib/range.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { sinceTs: since, untilTs: until, days } = resolveWindow(url);
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  const includeBots = url.searchParams.get('include_bots') === '1';

  const botClause = includeBots ? '' : 'AND e.is_bot = 0';

  try {
    // page: usa e.page; para leads antigos (vazio) deriva da landing_url da sessão
    // ('%/topaziob%' → 'B', senão 'A'). Campos de dispositivo (browser/os/is_mobile)
    // foram removidos da resposta a pedido — não são exibidos no dashboard.
    const rows = await env.DB.prepare(`
      SELECT
        e.id,
        e.event_id,
        e.timestamp,
        e.session_id,
        e.raw_email,
        e.raw_name,
        e.raw_phone,
        CASE
          WHEN e.page IS NOT NULL AND e.page != '' THEN e.page
          WHEN s.landing_url LIKE '%/topaziob%' THEN 'B'
          ELSE 'A'
        END as page,
        e.wa_sent_at,
        e.is_bot,
        e.bot_reason,
        e.meta_status_code,
        e.meta_response_ok,
        e.meta_response_body,
        e.meta_payload_sent,
        e.ga4_status_code,
        e.ga4_response_ok,
        e.ga4_response_body,
        e.ga4_payload_sent,
        e.fbp_source,
        e.fbc_source,
        e.fbclid_source,
        s.utm_source,
        s.utm_medium,
        s.utm_campaign,
        s.utm_content,
        s.utm_term,
        s.fbclid,
        s.gclid,
        s.referrer,
        s.landing_url
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      WHERE e.event_name = 'Lead'
        AND e.timestamp >= ?
        AND e.timestamp <= ?
        ${botClause}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).bind(since, until, limit).all();

    // Summary counts grouped by utm_source for the summary card above the table.
    const summary = await env.DB.prepare(`
      SELECT
        COALESCE(NULLIF(s.utm_source, ''), '(direct)') as utm_source,
        COUNT(*) as count
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      WHERE e.event_name = 'Lead'
        AND e.timestamp >= ?
        AND e.timestamp <= ?
        AND e.is_bot = 0
      GROUP BY utm_source
      ORDER BY count DESC
    `).bind(since, until).all();

    // Quantos abriram o formulário (pop-up) no período — base para a taxa de
    // desistência: quem abriu (FormOpen) mas não enviou (Lead). Disparado pela LP.
    const formOpens = await env.DB.prepare(`
      SELECT COUNT(*) as n
      FROM event_log
      WHERE event_name = 'FormOpen'
        AND timestamp >= ?
        AND timestamp <= ?
        AND is_bot = 0
    `).bind(since, until).first();

    // Contagem de leads por página (A vs B) no período — usado nos KPIs do dash.
    // Subquery: agrupa pelo VALOR derivado de page (event_log tem coluna `page`,
    // então GROUP BY direto agruparia pela coluna crua e separaria '' de 'A').
    const byPageRows = await env.DB.prepare(`
      SELECT page, COUNT(*) as count FROM (
        SELECT
          CASE
            WHEN e.page IS NOT NULL AND e.page != '' THEN e.page
            WHEN s.landing_url LIKE '%/topaziob%' THEN 'B'
            ELSE 'A'
          END as page
        FROM event_log e
        LEFT JOIN sessions s ON e.session_id = s.session_id
        WHERE e.event_name = 'Lead'
          AND e.timestamp >= ?
          AND e.timestamp <= ?
          AND e.is_bot = 0
      )
      GROUP BY page
    `).bind(since, until).all();

    const byPage = { A: 0, B: 0 };
    for (const r of byPageRows.results || []) {
      if (r.page === 'A' || r.page === 'B') byPage[r.page] += Number(r.count || 0);
    }

    return json({
      days,
      leads: rows.results || [],
      summary: summary.results || [],
      by_page: byPage,
      form_opens: formOpens?.n ?? 0,
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
