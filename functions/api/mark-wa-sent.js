// POST /api/mark-wa-sent?key=...
//
// Marca (ou desmarca) manualmente que o operador enviou mensagem de WhatsApp
// para um lead. Status interno apenas — NÃO dispara nada para o Meta/GA4.
//
// Auth:  ?key= ou body.key === env.DASH_KEY (mesmo padrão de /api/leads).
// Body:  { id: <event_log.id>, sent?: boolean }  (sent=false desmarca)
// Efeito: UPDATE event_log SET wa_sent_at = (sent ? now : 0) WHERE id = ?

export async function onRequestPost(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  let body = {};
  try { body = await request.json(); } catch (_) { body = {}; }

  const key = url.searchParams.get('key') || body.key;
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const id = parseInt(body.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'invalid_id' }, 400);
  }

  const sent = body.sent !== false; // default: marcar como enviado
  const waSentAt = sent ? Math.floor(Date.now() / 1000) : 0;

  try {
    const res = await env.DB.prepare(
      'UPDATE event_log SET wa_sent_at = ? WHERE id = ?'
    ).bind(waSentAt, id).run();

    if (!res.meta || res.meta.changes === 0) {
      return json({ error: 'not_found' }, 404);
    }
    return json({ ok: true, id, wa_sent_at: waSentAt });
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
