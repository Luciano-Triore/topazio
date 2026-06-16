# Meta CAPI setup — Conversions API for Business Messaging

Follow these steps in order. The order matters — doing them out of order is the most
common cause of having to redo the whole flow.

This is **optional**. Without it, the stack still captures every CTWA click to D1
(`lead_status='skipped_no_creds'`); it just doesn't send anything to Meta. Do this
when you want WhatsApp conversations to attribute back to your ads in Ads Manager.

## What you'll end up with

Values to paste into the Cloudflare Pages env vars (deploy-stack Step 10):

| var | example shape | source | required |
|---|---|---|---|
| `META_DATASET_ID` | `987654321098765` | Events Manager → the messaging dataset you create in step 4 | yes |
| `META_CAPI_TOKEN` | `EAAB…` (long-lived System User token) | Business Settings → System Users → Generate New Token | yes |
| `META_PAGE_ID` | `123456789012345` | Facebook Page → About → Page ID | recommended |
| `META_TEST_EVENT_CODE` | `TESTXXXX` | Events Manager → your dataset → Test Events tab | optional (drop after validation) |
| `META_CURRENCY` | `BRL` | your ad account currency | optional (default `BRL`) |

There is no cron/scheduler. CAPI Lead events fire from the webhook handler itself
(`context.waitUntil`) with up to 5 inline retries; `POST /api/retry-pending` (gated by
`WEBHOOK_SECRET`) is the manual flush for anything that didn't send.

### Event names — fixed by Meta, no overlap with web events

`action_source: business_messaging` accepts **only two** `event_name` values:
`LeadSubmitted` and `Purchase`. Arbitrary names are rejected. WhatsApp conversions are
therefore automatically separated from website events (which use the standard
`Lead`/`Purchase`) — no naming collision. The code defaults to `LeadSubmitted`; the
optional `META_LEAD_EVENT_NAME` must stay one of the two valid values.

## Pre-flight

Before clicking anything in Meta, confirm:
- [ ] The Facebook Page used for your CTWA ads, the WhatsApp Business Account (WABA),
  and the Ad Account are **all in the same Business Portfolio** (Business Settings →
  Business Info → Linked Assets). If they're in different Business Managers you won't
  be able to link the messaging dataset to the Page in step 4.
- [ ] You have **Admin** access on the Business Portfolio.
- [ ] You know the WhatsApp number that runs CTWA (the one connected in uazapi).

## 1. Grab the Facebook Page ID

Facebook → switch to the Page used for CTWA ads → **About** → scroll to **Page ID** →
copy the numeric value. Save as `META_PAGE_ID`.

## 2. Create a System User (if you don't have one)

Business Settings → **Users → System Users → Add**. Name it (e.g. `krob-wa-tracer`),
role **Admin**. Then **Add Assets**:
- **Ad accounts**: the one running CTWA — at least **View Performance**.
- **Pages**: the CTWA Page — **Page Public Content Access** or higher.
- **WhatsApp Accounts**: your WABA — **Manage WhatsApp Business Account**.

You'll add the Dataset to this user in step 5, after creating it in step 4.

## 3. Get `whatsapp_business_manage_events` Advanced Access

This catches most projects mid-launch.

Meta App Dashboard → your app → **Permissions and Features**. Find
`whatsapp_business_manage_events`; if it's only **Standard Access**, request
**Advanced Access** (App Review can take 5–10 business days — start now). While there,
confirm Advanced Access for `business_management` and `ads_read` (usually easy).

## 4. Create the messaging dataset

The dataset that receives WhatsApp messaging events is **not auto-created**, and a web
Pixel dataset is **not** the same thing.

Events Manager → **Connect data sources → Conversions API → Messaging**. Create a new
dataset (or attach a messaging stream to an existing one), name it recognizably, and
when prompted **link it to the Facebook Page** connected to your WABA, selecting
**WhatsApp** as the channel. Finish the flow.

If you don't see a "Messaging" option, the WABA isn't connected to a Page in this
Business Portfolio — fix that (pre-flight) and retry.

## 5. Get the Dataset ID and assign it to the System User

Events Manager → open the dataset → **Settings/Overview** shows the **Dataset ID**
(also in the URL). Copy it → save as `META_DATASET_ID`.

Then Business Settings → System Users → your user → **Add Assets → Datasets** → pick
this dataset → grant **Manage Dataset**. (Asset assignment is separate from token
scopes — you need both.)

## 6. Generate the long-lived System User token

Business Settings → System Users → your user → **Generate New Token**:
- **App**: your Meta App from step 3.
- **Token expiration**: **Never** (this is what makes it long-lived/permanent).
- **Scopes** — check exactly these three:
  - `whatsapp_business_manage_events` — to POST CTWA Lead/Purchase events.
  - `ads_read` — for the Marketing API call that resolves `ad_id` → campaign/adset/ad names.
  - `business_management` — to operate against the Business and its assets.
- **Generate Token**, then **copy it immediately** — Meta shows it once. Save as
  `META_CAPI_TOKEN`.

Two things must both be true: (a) the token carries the three scopes, and (b) the
System User is assigned the assets (dataset, ad account, WABA, Page). Right scopes but
a missing asset assignment returns `(#200)` permission errors.

## 7. (Optional) Get a test-event code

Events Manager → your dataset → **Test Events** → copy the code (e.g. `TEST12345`).
Save as `META_TEST_EVENT_CODE`. Events with this code land in the Test Events tab
(separate from production attribution). Drop it once validated.

## 8. Set the Pages env vars and redeploy

Add `META_DATASET_ID`, `META_CAPI_TOKEN`, `META_PAGE_ID` (and optionally
`META_TEST_EVENT_CODE`, `META_CURRENCY`) to the Pages project — deploy-stack Step 10,
or `Settings → Environment variables`. **Pages secrets only apply to new deployments**,
so trigger a redeploy (push a commit, or "Retry deployment" in the dashboard).

## 9. End-to-end validation

1. Click your own CTWA ad → send a message in WhatsApp.
2. Within ~30s: inspector → **Conversions** tab → new row with `lead_status = sent`.
3. Click the row → CAPI log shows HTTP 200 + Meta's `{events_received: 1, fbtrace_id: …}`.
4. Events Manager → dataset → **Test Events** → confirm the Lead arrived with the
   matching `ctwa_clid` (only if you set a test-event code).
5. The same webhook also enriches the ad inline — reload Conversions and the
   campaign/adset/ad **names** should appear. If not (or for older rows), click
   **Flush pending**, or `curl -X POST -H "x-webhook-token: <WEBHOOK_SECRET>" https://<project>.pages.dev/api/retry-pending`.
6. **24–48h later**: Ads Manager → your CTWA campaign → the Lead column populates.
   Loop closed.

## Troubleshooting

- **Test Events shows nothing within a minute** → check you're hitting the right
  `META_DATASET_ID` and the System User has the dataset's **Manage Dataset** permission.
- **CAPI log shows HTTP 200 but Test Events still empty** → almost always a wrong
  `META_TEST_EVENT_CODE`. Generate a fresh one and update the env var + redeploy.
- **`page_id` rejection / `(#100) Invalid parameter`** → try a WABA-id approach; some
  WABAs accept `whatsapp_business_account_id` instead of `page_id`.
- **`ads_read` 403 on the Marketing API call** → System User missing ad-account
  assignment, or Advanced Access for `ads_read` not approved yet.
- **Lead column stays empty in Ads Manager after 48h** → CTWA attribution needs both
  the `event_id = ctwa_clid` match AND the ad to have been served via Meta's dataset.
  If the dataset was created *after* the ad started running, only future clicks attribute.
