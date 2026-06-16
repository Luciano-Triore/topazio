# Environment variables

The stack reads everything from environment variables / secrets — nothing
account-specific is hardcoded. Set these as **Pages project environment variables**
(Cloudflare dashboard → your Pages project → Settings → Environment variables) for
production, and in a local **`.dev.vars`** file (copy from `.dev.vars.example`) for
`npm run dev`. `.dev.vars` is gitignored — never commit real values.

The D1 binding `DB` is configured separately as a **Pages binding**, not an env var
(deploy-stack Step 9).

## Required

| var | what it is | where to get it | encrypt on Pages? |
|---|---|---|---|
| `WEBHOOK_SECRET` | shared secret. Gates the webhook (`x-webhook-token` header or `?token=`), the read-only `/api/*` endpoints, the inspector UI, and `/api/retry-pending`. | generate locally: `openssl rand -hex 32` | 🔒 yes |

`WEBHOOK_SECRET` must match in three places: the Pages env var, the
`x-webhook-token` header you configure on uazapi, and the value you type into the
inspector prompt.

## Optional — Meta CAPI (enables sending; without them, capture-only)

With these unset, CTWA clicks are still captured to D1; the Lead records
`lead_status='skipped_no_creds'` instead of being sent. See `docs/meta-capi-setup.md`
for the full acquisition walkthrough.

| var | what it is | where to get it | encrypt? |
|---|---|---|---|
| `META_DATASET_ID` | messaging dataset id (goes in the CAPI URL) | Events Manager → your messaging dataset → Settings | no |
| `META_CAPI_TOKEN` | long-lived System User token (scopes: `whatsapp_business_manage_events`, `ads_read`, `business_management`) | Business Settings → System Users → Generate New Token | 🔒 yes |
| `META_PAGE_ID` | Facebook Page id; sent in `user_data.page_id` | Facebook Page → About → Page ID | no |
| `META_TEST_EVENT_CODE` | routes events to Events Manager → Test Events instead of production attribution | Events Manager → your dataset → Test Events | no |
| `META_CURRENCY` | currency on `custom_data` (default `BRL`); must match your ad account | your ad account settings | no |
| `META_LEAD_EVENT_NAME` | lead event name (default `LeadSubmitted`); **must** be `LeadSubmitted` or `Purchase` | — | no |
| `META_PURCHASE_EVENT_NAME` | purchase event name (default `Purchase`); used by manual Purchase fires (`POST /api/fire-purchase`) | — | no |
| `META_QUALIFIED_LEAD_EVENT_NAME` | qualified-lead event name (default `QualifiedLead`); used by manual Qualified Lead fires (`POST /api/fire-qualified-lead`) | — | no |

Notes:
- `META_CAPI_TOKEN` is also used for **Marketing API** ad-name enrichment (`ads_read`).
  If it's set but lacks `ads_read` / asset assignment, conversions still send but
  campaign/adset/ad names won't resolve in the inspector.
- `META_TEST_EVENT_CODE` should be **removed** for production — while set, events
  count as test events (`was_test=1` in `capi_events_log`) and don't drive attribution.
- The `META_*_EVENT_NAME` vars exist for flexibility. Meta's Conversions API for
  Business Messaging now supports a broad event set for `action_source: business_messaging`
  — `Purchase`, `LeadSubmitted`, `QualifiedLead`, `InitiateCheckout`, `AddToCart`,
  `ViewContent`, `OrderCreated`, and more (see
  [Meta's docs](https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging)).
  Stick to a name from that list; events must represent interactions inside the messaging
  thread, not conversions on other channels. The full Meta response is logged to
  `capi_events_log`, so a rejected name surfaces there.

## Binding (not an env var)

| binding | value |
|---|---|
| `DB` | your D1 database (`krob-wa-tracer-db` by default). Bound via Pages → Settings → Bindings → D1 database, variable name `DB`. |

## Quick reference: capture-only vs full attribution

- **Capture-only** (just `WEBHOOK_SECRET`): every message stored, CTWA extracted,
  inspector works. Leads show `skipped_no_creds`. Good for collecting real data first.
- **Full attribution** (`WEBHOOK_SECRET` + `META_DATASET_ID` + `META_CAPI_TOKEN`,
  plus `META_PAGE_ID` recommended): CTWA clicks fire `LeadSubmitted` to Meta and
  attribute back to ads. Add `META_TEST_EVENT_CODE` only while validating.
