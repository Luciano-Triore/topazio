# uazapi setup — connecting your WhatsApp number

Nothing reaches the tracker until **uazapi** is forwarding WhatsApp events to it.
uazapi is a third-party WhatsApp API gateway: you link your WhatsApp number to a
uazapi *instance*, and configure that instance to POST every message event to this
stack's webhook. The `connect-uazapi` skill walks you through this interactively;
this doc is the reference behind it.

## What you need

- A live deployment from `deploy-stack`: `https://<project>.pages.dev` and your
  `WEBHOOK_SECRET`.
- A WhatsApp number to connect. **For CTWA attribution this must be the same number
  your Meta ads send people to** (the "Send message" destination on the ad).
- A uazapi account/instance — [uazapi.com](https://uazapi.com).

## 1. Create a uazapi instance

Sign up at [uazapi.com](https://uazapi.com) and provision an instance. uazapi offers
a hosted option (the sample payloads in this repo came from `free.uazapi.com`) and
self-host options — either works; the tracker only cares that messages get POSTed to
its webhook. You'll end up with:

- an **instance** (it has a name, e.g. `teste` in our samples — surfaced as
  `instanceName` in the payload), and
- a **uazapi instance/admin token** — this authenticates *you* to uazapi's own API
  and dashboard. It is **not** the same as this stack's `WEBHOOK_SECRET`; don't mix
  them up.

## 2. Link your WhatsApp number

In the uazapi dashboard for the instance, start the connection flow — it shows a **QR
code**. On the phone that owns the number: WhatsApp → **Settings → Linked devices →
Link a device** → scan the QR. The instance status should switch to **connected**.

Tip: a number can only be CTWA-attributed if it's a WhatsApp number reachable from
your Meta ads. Linking your personal number is fine for testing capture.

## 3. Point the webhook at the tracker

In the instance's **webhook** settings:

| Setting | Value |
|---|---|
| URL | `https://<project>.pages.dev/webhook/uazapi` |
| Events | message events (inbound received messages at minimum; enabling all message events is fine) |
| Custom header | `x-webhook-token: <WEBHOOK_SECRET>` |

**Auth.** The stack checks the `x-webhook-token` header against `WEBHOOK_SECRET`. If
your uazapi plan can't send custom headers, the webhook also accepts the secret as a
query parameter:

```
https://<project>.pages.dev/webhook/uazapi?token=<WEBHOOK_SECRET>
```

Prefer the header. A wrong/missing token returns `401`, which uazapi reports as a
failed delivery — a quick way to confirm the token is right.

## 4. Confirm it's flowing

Send a WhatsApp message to the connected number from another phone. Within a second
or two, open the inspector at `https://<project>.pages.dev/` (Events tab; enter
`WEBHOOK_SECRET` when prompted) and you should see the row.

Or test without a real message using the curl smoke test in the `connect-uazapi`
skill / the README.

## Payload shape (for reference)

uazapi POSTs a JSON body roughly like this (trimmed). The tracker reads these fields
defensively — missing fields never crash it:

```json
{
  "EventType": "messages",
  "instanceName": "teste",
  "owner": "5500000000000",
  "message": {
    "id": "5500000000000:EXAMPLE...",
    "messageid": "EXAMPLE...",
    "chatid": "5511000000000@s.whatsapp.net",
    "sender_pn": "5511000000000@s.whatsapp.net",
    "senderName": "Test User",
    "fromMe": false,
    "isGroup": false,
    "messageType": "Conversation",
    "content": "...", "text": "...",
    "messageTimestamp": 1778609940000
  },
  "chat": { "wa_chatid": "...", "wa_name": "..." }
}
```

For a **CTWA** message the shape differs — `messageType` is `ExtendedTextMessage`,
`content` is an object, and the ad-referral data is nested deep inside
`message.content.contextInfo.externalAdReply`. See `docs/ctwa-findings.md`.

## Troubleshooting

- **uazapi shows the delivery as 401/failed** — the `x-webhook-token` in uazapi
  doesn't match `WEBHOOK_SECRET` on Pages (often a trailing space). Re-copy both.
- **Delivery is 200 but nothing in the inspector** — the `DB` binding isn't set on
  the Pages project (deploy-stack Step 9), or you entered the wrong secret in the
  inspector prompt.
- **No custom-header option in uazapi** — use the `?token=...` query-param URL.
- **`is_ctwa` always 0** — expected for normal messages; CTWA data only appears on
  the first message from someone who clicked a Click-to-WhatsApp ad.
