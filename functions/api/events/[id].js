// GET /api/events/:id
//
// Returns one event row including the full raw_payload (pretty-printed by the
// inspector). Auth via the same x-webhook-token shared secret.

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

  const row = await env.DB.prepare(
    'SELECT * FROM webhook_events WHERE id = ?',
  )
    .bind(id)
    .first();

  if (!row) {
    return json({ ok: false, error: 'not_found' }, 404);
  }

  return json({ event: row });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
