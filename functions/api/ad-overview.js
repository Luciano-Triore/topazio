// GET /api/ad-overview?key=...&days=30
//
// Visão de mídia paga por página (A vs B) para o dashboard:
//   - investimento total (Meta) na janela
//   - investimento por página, separando campanhas pelo MARCADOR no nome
//     (env CAMPAIGN_TAG_A / CAMPAIGN_TAG_B; defaults '[A]' / '[B]')
//   - leads por página (event_log, Lead, não-bot)
//   - custo por lead por página (spend / leads; null se 0 leads)
//
// Spend vem de `ad_spend` (sincronizada por /api/sync/meta-ads). Campanhas cujo
// nome não contém nenhum dos marcadores entram só no total, não em A/B.
//
// Response: {
//   days, currency,
//   total_spend, spend_a, spend_b, spend_untagged,
//   leads_a, leads_b, cpl_a, cpl_b,
//   tag_a, tag_b
// }
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

  const { sinceTs: since, untilTs: until, sinceDate, untilDate, days } = resolveWindow(url);

  const tagA = env.CAMPAIGN_TAG_A || '[A]';
  const tagB = env.CAMPAIGN_TAG_B || '[B]';

  try {
    const SUMS = `
      COALESCE(SUM(spend_cents), 0)        AS cents,
      COALESCE(SUM(impressions), 0)        AS impressions,
      COALESCE(SUM(reach), 0)              AS reach,
      COALESCE(SUM(link_clicks), 0)        AS link_clicks,
      COALESCE(SUM(landing_page_views), 0) AS landing_page_views
    `;

    // Raw sums for the whole window (all campaigns) or a tag-filtered slice.
    // tag === null → total. Deriving rates from these summed counts (rather than
    // averaging per-day rates) is the only correct way to aggregate a window.
    const aggregate = async (tag) => {
      const where = tag == null
        ? `platform = 'meta' AND date >= ? AND date <= ?`
        : `platform = 'meta' AND date >= ? AND date <= ? AND campaign_name LIKE ?`;
      const binds = tag == null ? [sinceDate, untilDate] : [sinceDate, untilDate, `%${tag}%`];
      const r = await env.DB.prepare(`
        SELECT ${SUMS}, MAX(currency) as currency
        FROM ad_spend WHERE ${where}
      `).bind(...binds).first();
      return {
        spend: Number(r?.cents || 0) / 100,
        impressions: Number(r?.impressions || 0),
        reach: Number(r?.reach || 0),
        link_clicks: Number(r?.link_clicks || 0),
        landing_page_views: Number(r?.landing_page_views || 0),
        currency: r?.currency || 'BRL',
      };
    };

    // Turn raw sums into the dashboard metric set. Rates are null when their
    // denominator is 0 so the UI shows '—' instead of a misleading 0 or NaN.
    const derive = (a) => ({
      spend: a.spend,
      impressions: a.impressions,
      reach: a.reach,
      link_clicks: a.link_clicks,
      landing_page_views: a.landing_page_views,
      frequency: a.reach > 0 ? a.impressions / a.reach : null,
      link_ctr: a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : null,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
      cpc_link: a.link_clicks > 0 ? a.spend / a.link_clicks : null,
      cost_per_lpv: a.landing_page_views > 0 ? a.spend / a.landing_page_views : null,
    });

    const aTotal = await aggregate(null);
    const aA = await aggregate(tagA);
    const aB = await aggregate(tagB);

    const totalSpend = aTotal.spend;
    const spendA = aA.spend;
    const spendB = aB.spend;
    const spendUntagged = Math.max(0, totalSpend - spendA - spendB);
    const totalRow = { currency: aTotal.currency };

    // --- Leads por página --- (subquery: agrupa pelo valor derivado, não pela
    // coluna crua `page`, que separaria '' de 'A')
    const leadRows = await env.DB.prepare(`
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

    let leadsA = 0, leadsB = 0;
    for (const r of leadRows.results || []) {
      if (r.page === 'A') leadsA += Number(r.count || 0);
      else if (r.page === 'B') leadsB += Number(r.count || 0);
    }

    return json({
      days,
      currency: totalRow?.currency || 'BRL',
      total_spend: totalSpend,
      spend_a: spendA,
      spend_b: spendB,
      spend_untagged: spendUntagged,
      leads_a: leadsA,
      leads_b: leadsB,
      cpl_a: leadsA > 0 ? spendA / leadsA : null,
      cpl_b: leadsB > 0 ? spendB / leadsB : null,
      tag_a: tagA,
      tag_b: tagB,
      // Per-página métricas Meta (alcance, frequência, impressões, CTR link,
      // CPM, CPC link, visualizações de página, custo/visualização).
      metrics: {
        a: derive(aA),
        b: derive(aB),
        total: derive(aTotal),
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
