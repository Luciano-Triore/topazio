# KROB WhatsApp Tracker

A downloadable tracking stack that captures every WhatsApp message from
[uazapi](https://uazapi.com), extracts **Click-to-WhatsApp (CTWA)** ad-referral data,
and fires a Meta Conversions API `LeadSubmitted` event — so WhatsApp conversations
attribute back to the ad that started them. Runs entirely in **your own** Cloudflare
account (Pages + D1). No shared backend, no monthly SaaS, no build step.

## The easy way (Claude Code)

Open this folder in **Claude Code** and just talk to it:

1. **"set up my whatsapp tracking"** → bootstraps Cloudflare D1, your GitHub repo, and
   the Pages project. (skill: `deploy-stack`)
2. **"connect uazapi"** → links your WhatsApp number and points the webhook here.
   (skill: `connect-uazapi`)
3. *(optional, for Meta attribution)* set up Meta CAPI — see
   [docs/meta-capi-setup.md](docs/meta-capi-setup.md).
4. **"check my tracking is working"** → verifies capture, CTWA extraction, and the
   Lead fire end to end. (skill: `verify-tracking`)

That's it. The skills explain each step as they go.

## What you get

- `POST /webhook/uazapi` — the receiver. Stores the full payload first, returns `200`
  fast, fires the Meta CAPI Lead **after** the response (uazapi never waits on Meta).
- An **inspector UI** at `/` — browse events and CTWA conversions, view raw payloads,
  flush stuck leads.
- CTWA attribution: extracts `ctwa_clid` from the WhatsApp payload and sends a
  `LeadSubmitted` (`action_source: business_messaging`) to Meta, with inline retries.
- **Manual Purchase**: from the Conversions tab, select a contact, enter a value, and
  fire a Meta CAPI `Purchase` tied to that CTWA click (one per contact; re-fires guarded).
- Ad-name enrichment: resolves `ad_id` → campaign/adset/ad names via the Marketing API.
- **Capture-only mode**: without Meta credentials it still captures everything; leads
  just record `skipped_no_creds`. Wire Meta up whenever you're ready.

## Stack

- Cloudflare Pages + Pages Functions (ESM, no build step)
- Cloudflare D1 (binding `DB`)
- Vanilla HTML/JS inspector
- `wrangler` is the only dev dependency

## Manual setup (without Claude Code)

```bash
# 1. Install the one dev dep
npm install

# 2. Log in and create your D1 database
npx wrangler@latest login
npx wrangler@latest d1 create krob-wa-tracer-db
#   -> copy wrangler.toml.example to wrangler.toml and paste the database_id

# 3. Apply both migrations (remote; add the :local variants for local dev)
npm run d1:init:remote     # 0001_init.sql
npm run d1:capi:remote     # 0002_capi.sql

# 4. Local secret for `npm run dev`
cp .dev.vars.example .dev.vars
#   -> set WEBHOOK_SECRET (generate: openssl rand -hex 32)

# 5. Push to GitHub, then create the Pages project in the Cloudflare dashboard:
#      - Connect to Git, production branch: main
#      - Build command: (none)   Output directory: public
#      - Settings → Bindings: add D1 database, variable name DB -> krob-wa-tracer-db
#      - Settings → Environment variables: add WEBHOOK_SECRET (+ Meta vars if using CAPI)
#      - Redeploy (env/binding changes only apply to new deployments)
```

Then point uazapi at `https://<project>.pages.dev/webhook/uazapi` with the
`x-webhook-token: <WEBHOOK_SECRET>` header — see [docs/uazapi-setup.md](docs/uazapi-setup.md).

## Local dev

```bash
npm run dev
# -> http://localhost:8788/                (inspector)
# -> http://localhost:8788/webhook/uazapi  (receiver)
```

### Smoke test the webhook

```bash
TOKEN=$(grep WEBHOOK_SECRET .dev.vars | cut -d= -f2)
curl -X POST http://localhost:8788/webhook/uazapi \
  -H "Content-Type: application/json" \
  -H "x-webhook-token: $TOKEN" \
  -d '{
    "EventType": "messages",
    "instanceName": "teste",
    "owner": "5500000000000",
    "message": {
      "id": "5500000000000:EXAMPLEMESSAGEID0001",
      "messageid": "EXAMPLEMESSAGEID0001",
      "chatid": "5511000000000@s.whatsapp.net",
      "sender_pn": "5511000000000@s.whatsapp.net",
      "senderName": "Test User",
      "fromMe": false, "isGroup": false,
      "messageType": "Conversation",
      "content": "test message from curl", "text": "test message from curl",
      "messageTimestamp": 1778609940000
    },
    "chat": { "wa_chatid": "5511000000000@s.whatsapp.net", "wa_name": "Test User" }
  }'
```

Expect `200` with `{ "ok": true, "id": 1 }`, then verify in the inspector.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/webhook/uazapi` | uazapi receiver. Auth via `x-webhook-token` (or `?token=`). Stores raw first; returns `200 { ok, id, conversion_id?, new_conversion? }`. |
| `GET` | `/api/events` | List events. Filters: `limit`, `offset`, `has_track`, `sender_pn`, `since`. Excludes `raw_payload`. |
| `GET` | `/api/events/:id` | Single event including full `raw_payload`. |
| `GET` | `/api/conversions` | CTWA conversions joined with ad metadata. Filters: `lead_status`, `campaign_id`, `ad_id`, `since`. |
| `GET` | `/api/conversions/:id` | Single conversion + its full CAPI log. |
| `POST` | `/api/retry-pending` | Manual flush: re-fire stuck leads, re-enrich stale ads. |
| `POST` | `/api/fire-purchase` | Manually fire a Meta CAPI `Purchase` for a CTWA conversion. Body `{ conversion_id, value, currency?, order_id?, force? }`. |
| `GET` | `/` | Inspector UI. |

All endpoints require the `x-webhook-token` (the inspector prompts for it once).

## Docs

- [docs/architecture.md](docs/architecture.md) — how the pieces fit and why
- [docs/uazapi-setup.md](docs/uazapi-setup.md) — connect your WhatsApp number
- [docs/meta-capi-setup.md](docs/meta-capi-setup.md) — Meta Conversions API playbook
- [docs/ctwa-findings.md](docs/ctwa-findings.md) — where CTWA data hides in the payload
- [docs/schema.md](docs/schema.md) — the D1 tables
- [docs/env-vars.md](docs/env-vars.md) — every env var, required vs optional

## Not built (dormant)

**Automatic** Purchase detection. Manual purchase (fire from the UI) works today;
auto-firing from a purchase signal — a phrase in an outbound message or an external
sale webhook — is not wired up. The `firePurchase()` plumbing is ready; only the
trigger is missing. See [docs/ctwa-findings.md](docs/ctwa-findings.md).

Running alongside a web pixel without crossing data is covered in
[docs/ctwa-findings.md](docs/ctwa-findings.md) too.
