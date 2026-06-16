# CTWA findings — where the tracking gold actually lives

These are the hard-won, real-data facts about Click-to-WhatsApp (CTWA) referral data
in uazapi payloads. They were learned by capturing live traffic and inspecting raw
payloads, and they drive how `functions/lib/capi.js` extracts and sends events. If
uazapi or Meta changes shape, this is the doc to re-verify against `raw_payload`.

## 1. CTWA data is nested, not top-level

It is **not** in the `track_id` / `track_source` fields (those stay empty for CTWA).
The referral data lives deep inside the message content:

```
message.content.contextInfo.externalAdReply.ctwaClid      ← the click ID (the key value)
message.content.contextInfo.externalAdReply.sourceID      ← the ad id
message.content.contextInfo.externalAdReply.sourceURL     ← the ad's destination URL
message.content.contextInfo.externalAdReply.title / body  ← ad creative text
message.content.contextInfo.entryPointConversionSource    ← e.g. the surface
message.content.contextInfo.entryPointConversionApp       ← e.g. the app
```

`ctwaClid` lives **inside** `externalAdReply`, not at the `contextInfo` top level. The
extractor falls back to `contextInfo.ctwaClid` just in case Meta ever surfaces it
there. See `extractCtwaContext()` in `functions/lib/capi.js`.

## 2. CTWA messages are `ExtendedTextMessage`, not `Conversation`

A normal text message arrives as `messageType: "Conversation"` with a flat string in
`message.text` / `message.content`. A CTWA message arrives as
`messageType: "ExtendedTextMessage"`, where `message.content` is an **object** and the
real text is at `message.content.text`. `extractMessageText()` handles both shapes —
flat string first, then the nested object form.

Practical consequence: the presence of a structured `content` object (vs a string) is
the signal that there *might* be `contextInfo` worth checking.

## 3. `business_messaging` accepts only `LeadSubmitted` and `Purchase`

When sending to Meta with `action_source: business_messaging`, the only valid
`event_name` values are `LeadSubmitted` and `Purchase`. Sending `Lead` is rejected
(`OAuthException 2804066`). This is *useful*: WhatsApp conversions never collide with
website events (which use the standard `Lead`/`Purchase`). The stack defaults the
conversation event to `LeadSubmitted`.

## 4. The dataset id goes in the URL, never the body

CAPI is posted to `https://graph.facebook.com/v25.0/{DATASET_ID}/events`. The dataset
id is a path segment, not a body field.

## 5. Meta dedups on `(event_name, event_id)` for 48h, per dataset

The stack sets `event_id = ctwa_clid`. So the same click producing two webhook
deliveries (or a retry) won't double-count at Meta within 48h. The `conversions` table
independently enforces one row per `ctwa_clid` (UNIQUE), so it won't fire twice anyway.

## 6. CTWA attribution window is 7 days from the click

A conversion can attribute back to the ad for up to 7 days after the click. And the
dataset must have existed when the ad was served — if you create the dataset *after* a
campaign starts, only clicks from that point forward attribute. (This is why
`meta_ads_cache` uses a 7-day TTL for ad-name enrichment too.)

## 7. Lead trigger timing (a known design choice)

The Lead currently fires on the **first** inbound CTWA message. Meta intends
`LeadSubmitted` for a *qualified* lead (form filled, contact shared, a chatbot
milestone). Firing on first contact is a reasonable v1 and gives Meta a signal to
optimize on, but if you want stricter quality you can move the trigger to a
qualification point later. Noted here so it's a deliberate decision, not an accident.

## Purchase events: manual now, auto-detection still dormant

You can fire a **Purchase** manually from the inspector: open a conversion in the
Conversions tab, enter a value, click **Fire purchase**. That POSTs
`/api/fire-purchase`, which calls `firePurchase()` in `functions/lib/capi.js` — the
Purchase twin of `fireLead` (same build → send → log → retry → update shape, writing
the `purchase_*` columns). The event uses `action_source: business_messaging`,
`event_name: Purchase`, and `event_id = ctwa_clid:purchase` (stable per contact, so a
re-fire dedups at Meta within 48h instead of double-counting). Requires Meta creds;
without them the purchase records `skipped_no_creds`, exactly like leads.

What's still **not** built: **automatic** purchase detection. Auto-firing would mean
detecting a purchase-confirmation signal (a phrase in an outbound message, or an
external sale webhook) and deciding the value source (fixed per ad vs extracted). The
`buildPurchaseEvent()` / `firePurchase()` plumbing is ready; only the trigger is
missing, and it can be added without a migration.

## Running alongside a web pixel (no data crossing)

You'll often run this WhatsApp stack at the same time as a web/sales-page tracking
stack. They do **not** cross-contaminate, because they use different identifiers and
channels:

| | Web / sales-page stack | WhatsApp / CTWA stack (this one) |
|---|---|---|
| click id | `fbclid` → `_fbc`/`_fbp` | `ctwa_clid` |
| `action_source` | `website` | `business_messaging` |
| Meta target | a web **Pixel** | a **messaging dataset** |
| Purchase `event_id` | order/transaction id | `ctwa_clid:purchase` |

Meta attributes each event back to its ad through its own identifier, so a CTWA
purchase only maps to the CTWA ad and a web purchase only to the web ad. Recommended:
**keep a separate dataset for WhatsApp** (the messaging dataset in
`META_DATASET_ID`) from your web Pixel — it's the documented setup and keeps reporting
and permissions clean. (Meta now allows one dataset to hold both channels; even then
they don't cross-attribute, but a dedicated messaging dataset is cleaner.) The only
real double-count is a single person buying through *both* funnels — a genuine
multi-touch case, not a leak; dedupe downstream on the person/phone if you need one
revenue source of truth.

## How to re-verify if shapes change

1. Inspector → Events tab → open a CTWA message → read the full `raw_payload`.
2. Confirm `message.content.contextInfo.externalAdReply.ctwaClid` is still present.
3. If it moved, update `extractCtwaContext()` in `functions/lib/capi.js`, then backfill
   historical rows with `scripts/backfill_ctwa.sql` (it re-extracts from `raw_payload`).
