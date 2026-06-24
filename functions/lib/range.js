// Shared date-window resolver for the dashboard API endpoints.
//
// Two modes, decided per request:
//   - Absolute range: ?from=YYYY-MM-DD&to=YYYY-MM-DD
//       sinceTs = 00:00:00 (UTC) of `from`, untilTs = 23:59:59 (UTC) of `to`.
//   - Trailing window: ?days=N  (default 30, clamp 1..365)
//       sinceTs = now - N*86400, untilTs = now.
//
// Returns unix-second bounds (sinceTs/untilTs) for columns stored as epoch
// (event_log.timestamp, conversions.first_seen_at, purchase_log.created_at)
// AND YYYY-MM-DD string bounds (sinceDate/untilDate) for the ad_spend.date
// TEXT column. `days` is echoed back for the UI label.
//
// Vanilla, no deps — imported by ESM Pages Functions.

const DAY = 86400;

export function resolveWindow(url) {
  const from = (url.searchParams.get('from') || '').trim();
  const to = (url.searchParams.get('to') || '').trim();

  if (isYmd(from) && isYmd(to)) {
    // Normalize swapped inputs so from <= to.
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const sinceTs = ymdToEpoch(lo, 0);            // 00:00:00 UTC of the start day
    const untilTs = ymdToEpoch(hi, 0) + DAY - 1;  // 23:59:59 UTC of the end day
    const days = Math.max(1, Math.round((untilTs - sinceTs) / DAY));
    return { sinceTs, untilTs, sinceDate: lo, untilDate: hi, days, custom: true };
  }

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const now = Math.floor(Date.now() / 1000);
  const sinceTs = now - days * DAY;
  return {
    sinceTs,
    untilTs: now,
    sinceDate: ymd(new Date(sinceTs * 1000)),
    untilDate: ymd(new Date(now * 1000)),
    days,
    custom: false,
  };
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function ymdToEpoch(s, offsetSeconds) {
  // Treat the date as UTC midnight; matches how ad_spend.date / SQLite
  // date(ts,'unixepoch') compare (both UTC-based).
  return Math.floor(Date.parse(s + 'T00:00:00Z') / 1000) + (offsetSeconds || 0);
}

function ymd(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
