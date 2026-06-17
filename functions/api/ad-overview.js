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

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const sinceDate = ymd(new Date(since * 1000));

  const tagA = env.CAMPAIGN_TAG_A || '[A]';
  const tagB = env.CAMPAIGN_TAG_B || '[B]';

  try {
    // --- Spend total + moeda ---
    const totalRow = await env.DB.prepare(`
      SELECT COALESCE(SUM(spend_cents), 0) as cents, MAX(currency) as currency
      FROM ad_spend
      WHERE platform = 'meta' AND date >= ?
    `).bind(sinceDate).first();

    const spendByTag = async (tag) => {
      const r = await env.DB.prepare(`
        SELECT COALESCE(SUM(spend_cents), 0) as cents
        FROM ad_spend
        WHERE platform = 'meta' AND date >= ?
          AND campaign_name LIKE ?
      `).bind(sinceDate, `%${tag}%`).first();
      return Number(r?.cents || 0) / 100;
    };

    const totalSpend = Number(totalRow?.cents || 0) / 100;
    const spendA = await spendByTag(tagA);
    const spendB = await spendByTag(tagB);
    const spendUntagged = Math.max(0, totalSpend - spendA - spendB);

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
          AND e.is_bot = 0
      )
      GROUP BY page
    `).bind(since).all();

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
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function ymd(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
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
