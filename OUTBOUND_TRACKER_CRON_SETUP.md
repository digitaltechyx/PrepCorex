# Outbound Tracker cron setup

Admin **Outbound Tracker** polls Shippo for scanned outbound labels and sends one combined daily email at **7:00 AM America/New_York** to `info@prepservicesfba.com`.

## Architecture

```
Cloud Scheduler (every 6h)
  → outboundTrackingRefreshCron
    → POST https://YOUR-APP/api/outbound-tracking/cron?secret=CRON_SECRET

Cloud Scheduler (daily 7am America/New_York)
  → outboundTrackingDigestCron
    → POST https://YOUR-APP/api/outbound-tracking/digest?secret=CRON_SECRET
```

## 1. Hosting (Vercel)

Same as inbound cron — must already be set:

| Variable | Required |
|----------|----------|
| `CRON_SECRET` | Yes (same value as Firebase `cron.secret`) |
| `SHIPPO_API_KEY` | Yes |
| SMTP vars | Yes (daily email) |

Redeploy the web app if you changed env vars.

## 2. Firebase function config

If **inbound cron already works**, you do **not** need to change config — outbound uses the same `app.url` and `cron.secret`.

Verify:

```powershell
firebase functions:config:get
```

If missing, set (replace URL and secret):

```powershell
firebase functions:config:set app.url="https://prepcorex.com" cron.secret="YOUR_CRON_SECRET"
```

## 3. Deploy outbound cron functions

Outbound crons live in the same **`functions-inbound-cron`** codebase as inbound (avoids a separate deploy timeout).

From project root in PowerShell:

```powershell
cd "C:\Users\zains\Desktop\Sir Arhsad Iqbal\PSF StockFlow\PSF-StockFlow-main"

firebase login
firebase use psf-stockflow

# If deploy times out analyzing codebases, set a longer discovery timeout:
$env:FUNCTIONS_DISCOVERY_TIMEOUT=60000
firebase deploy --only "functions:inbound-cron:inboundTrackingRefreshCron,functions:inbound-cron:outboundTrackingRefreshCron,functions:inbound-cron:outboundTrackingDigestCron"
```

This deploys/updates:
- `inboundTrackingRefreshCron` (every 6 hours)
- `outboundTrackingRefreshCron` (every 6 hours)
- `outboundTrackingDigestCron` (daily 7am America/New_York)

## 4. Test

**Refresh cron:**

```powershell
curl.exe -X POST "https://prepcorex.com/api/outbound-tracking/cron?secret=YOUR_CRON_SECRET"
```

Expected: `{"success":true,"refreshed":0}` (or higher if open trackings exist).

**Digest cron (manual test — sends email if there are items to report):**

```powershell
curl.exe -X POST "https://prepcorex.com/api/outbound-tracking/digest?secret=YOUR_CRON_SECRET"
```

Expected: `{"success":true,"refreshed":0,"firstChanges":0,"stale":0,"emailSent":false}`

## 5. Logs

Firebase Console → Functions → `outboundTrackingRefreshCron` / `outboundTrackingDigestCron` → Logs

Look for: `[outboundTracker] /api/outbound-tracking/... ok`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | `CRON_SECRET` on Vercel ≠ `cron.secret` in Firebase |
| `404` on cron URL | Deploy PrepCorex app first; wrong `app.url` |
| No daily email | Normal if no status changes / no 48h stale trackings that day |
| Email fails | Check SMTP env vars on Vercel |

## Optional env

```env
OUTBOUND_TRACKER_DIGEST_EMAIL=info@prepservicesfba.com
```

## Admin page

`/admin/dashboard/outbound-tracker` — admin only. Scan or manual entry works even before cron deploy; cron adds auto-refresh + daily email.
