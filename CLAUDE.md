# KROB WhatsApp Tracker — Claude Code anchor

This repo is a **distributable template**. A recipient downloads it, opens it in
Claude Code, and is guided through deploying their **own** copy into their **own**
Cloudflare account. There is no shared backend and no multi-tenancy — each recipient
owns their data end to end.

## What this stack does

Captures every uazapi WhatsApp webhook into Cloudflare D1, extracts Click-to-WhatsApp
(CTWA) ad-referral data, and fires a Meta Conversions API `LeadSubmitted` event so
WhatsApp conversations attribute back to the ad that started them. A vanilla-JS
inspector at `/` browses captured events and conversions. Stack: Cloudflare Pages +
Pages Functions + D1, no build step, no runtime dependencies.

Read `docs/architecture.md` first for the full picture.

## Which skill to use when

| The recipient says… | Invoke skill |
|---|---|
| "set up my whatsapp tracking", "deploy this", "I just downloaded this" | **deploy-stack** |
| "connect uazapi", "connect my whatsapp", "set up the webhook" | **connect-uazapi** |
| "check my tracking is working", "is it working", "did the lead fire" | **verify-tracking** |

Normal order: `deploy-stack` → `connect-uazapi` → (optional `docs/meta-capi-setup.md`)
→ `verify-tracking`.

## Hard rules

- **Never commit secrets.** `wrangler.toml`, `.dev.vars`, and `.env*` are gitignored;
  only `wrangler.toml.example` and `.dev.vars.example` are tracked. The D1
  `database_id` lives only in the local `wrangler.toml`.
- **Capture first.** The webhook stores `raw_payload` and returns `200` before any
  attribution work. Meta calls run after the response via `context.waitUntil()`.
  Never make uazapi wait on Meta.
- **`raw_payload` is the source of truth.** Extracted columns are derived; backfill
  from `raw_payload` rather than re-capturing.
- **Defensive reads.** Every payload field via optional chaining + `?? null`. uazapi's
  shape changes without warning; a missing field must never crash the handler.
- **Vanilla only.** ESM Pages Functions, plain HTML/JS inspector. No frameworks, no
  build step, no runtime npm deps (`wrangler` is the only dev dep).
- **One handler per file.** Keep files small.

## Scope

In scope: webhook capture, inspector, CTWA extraction, Meta CAPI `LeadSubmitted`,
ad-name enrichment, inline retry + manual flush, **manual Purchase** (fire from
the Conversions tab → `POST /api/fire-purchase` → `firePurchase()` in `lib/capi.js`),
and **manual Qualified Lead** — a value-less sibling: from a contact's drawer →
`POST /api/fire-qualified-lead` → `fireQualifiedLead()`, sending a `QualifiedLead`
event, with a confirmation prompt before every fire.

**Dormant (do not build unless asked):** *automatic* Purchase detection — auto-firing
a `Purchase` from a purchase signal (an outbound-message phrase or a sale webhook).
The `firePurchase()` plumbing and `conversions.purchase_*` columns exist; only the
trigger is missing. See `docs/ctwa-findings.md`.

## Repo map

```
.claude/skills/        deploy-stack · connect-uazapi · verify-tracking
docs/                  architecture · uazapi-setup · meta-capi-setup · ctwa-findings · schema · env-vars
functions/
  webhook/uazapi.js    the receiver
  lib/capi.js          CTWA extraction + Meta CAPI + enrichment + retry
  api/                 events, events/[id], conversions, conversions/[id], retry-pending, fire-purchase, fire-qualified-lead
migrations/            0001_init.sql · 0002_capi.sql · 0003_qualified_lead.sql
scripts/               backfill_ctwa.sql
public/index.html      the inspector
wrangler.toml.example  templated config (database_id placeholder)
.dev.vars.example      templated local secrets
```

## Connecting wrangler to Cloudflare

You deploy into **your own** Cloudflare account. Log in once with
`npx wrangler@latest login` (opens a browser) before any D1/`wrangler` command — the
deploy-stack skill walks you through this.
