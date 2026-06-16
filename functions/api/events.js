// GET /api/events
//
// Lists captured webhook events, newest first. Auth via x-webhook-token (same
// secret as the receiver). Never returns raw_payload — too heavy for a list.
//
// Query params:
//   limit       (default 50, max 200)
//   offset      (default 0)
//   has_track   ("1" to only show events with track_id or track_source)
//   sender_pn   (exact match)
//   since       (unix ms; returns events with received_at >= since)

export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (auth) return auth;

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const hasTrack = url.searchParams.get('has_track') === '1';
  const senderPn = url.searchParams.get('sender_pn');
  const since = url.searchParams.get('since');

  const where = [];
  const params = [];

  if (hasTrack) where.push('has_track_data = 1');
  if (senderPn) {
    where.push('sender_pn = ?');
    params.push(senderPn);
  }
  if (since) {
    const n = Number(since);
    if (Number.isFinite(n)) {
      where.push('received_at >= ?');
      params.push(n);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const listSql = `
    SELECT
      id, received_at, event_type, instance_name, owner, chat_source,
      message_id, message_wa_id, chat_id, chat_lid,
      sender_pn, sender_lid, sender_name, from_me,
      is_group, group_name,
      message_type, message_media, message_content, message_ts,
      track_id, track_source, has_track_data
    FROM webhook_events
    ${whereSql}
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `;
  const countSql = `SELECT COUNT(*) AS n FROM webhook_events ${whereSql}`;

  const [listResult, countResult] = await Promise.all([
    env.DB.prepare(listSql).bind(...params, limit, offset).all(),
    env.DB.prepare(countSql).bind(...params).first(),
  ]);

  return json({
    events: listResult.results ?? [],
    count: countResult?.n ?? 0,
    limit,
    offset,
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
