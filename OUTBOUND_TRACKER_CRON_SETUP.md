# Outbound Tracker setup

Admin **Outbound Tracker** refreshes Shippo statuses **on page load only** (no scheduled refresh cron). A combined daily digest email still runs at **7:00 AM America/New_York** to `info@prepservicesfba.com`.

## Architecture

```
Outbound Tracker page load
  → POST /api/outbound-tracking/refresh-stale
    → refresh open rows older than the stale interval

Cloud Scheduler (daily 7am America/New_York)
  → outboundTrackingDigestCron
    → POST https://YOUR-APP/api/outbound-tracking/digest?secret=CRON_SECRET
```

**Removed (cost):** `outboundTrackingRefreshCron`, `inboundTrackingRefreshCron`, and `inboundTrackerRefreshCron` (were left on `every 1 minutes` in testing and caused large Firestore read/egress bills). Do not re-add them.

## 1. Hosting (Vercel)

| Variable | Required |
|----------|----------|
| `CRON_SECRET` | Yes (digest email only) |
| `SHIPPO_API_KEY` | Yes |
| SMTP vars | Yes (daily email) |

## 2. Deploy digest function only

Digest lives in **`functions-inbound-cron`**:

```powershell
cd "C:\Users\zains\Desktop\Sir Arhsad Iqbal\PSF StockFlow\PSF-StockFlow-main"

firebase use psf-stockflow
$env:FUNCTIONS_DISCOVERY_TIMEOUT=60000
firebase deploy --only "functions:inbound-cron:outboundTrackingDigestCron"
```

Delete old refresh crons if they still exist:

```powershell
firebase functions:delete inboundTrackingRefreshCron --project psf-stockflow --force
firebase functions:delete outboundTrackingRefreshCron --project psf-stockflow --force
firebase functions:delete inboundTrackerRefreshCron --project psf-stockflow --force
```

## 3. Test digest (manual)

```powershell
curl.exe -X POST "https://prepcorex.com/api/outbound-tracking/digest?secret=YOUR_CRON_SECRET"
```

## 4. Logs

Firebase Console → Functions → `outboundTrackingDigestCron` → Logs
