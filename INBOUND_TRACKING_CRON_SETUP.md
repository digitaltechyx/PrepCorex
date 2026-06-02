# Inbound tracking cron (Option A — Firebase)

Refreshes Shippo carrier status **every 6 hours** for trackings older than 6 hours.

## Architecture

```
Cloud Scheduler (every 6h)
  → Firebase Function: inboundTrackingRefreshCron
    → POST https://YOUR-APP/api/inbound-tracking/cron?secret=CRON_SECRET
      → Firestore inboundTrackingIndex + inventoryRequests
```

## 1. Hosting (Next.js / Vercel / etc.)

Add the **same** secret you use locally:

| Variable | Required |
|----------|----------|
| `CRON_SECRET` | Yes (must match Firebase `cron.secret`) |
| `SHIPPO_API_KEY` | Yes (tracking lookups) |

Redeploy the web app after saving env vars.

## 2. Firebase function config

From the project root (replace URL and secret with your values):

```bash
firebase login
firebase use YOUR_PROJECT_ID

firebase functions:config:set ^
  app.url="https://dev.prepservicesfba.com" ^
  cron.secret="YOUR_CRON_SECRET_SAME_AS_HOSTING"
```

PowerShell (one line):

```powershell
firebase functions:config:set app.url="https://dev.prepservicesfba.com" cron.secret="YOUR_CRON_SECRET_SAME_AS_HOSTING"
```

Verify:

```bash
firebase functions:config:get
```

You should see `app.url` and `cron.secret`.

## 3. Deploy

Deploy the scheduled function (and Firestore index if not deployed yet):

```bash
firebase deploy --only functions:inboundTrackingRefreshCron,firestore:indexes
```

Or deploy all functions:

```bash
firebase deploy --only functions
```

## 4. Test

**API directly** (proves hosting + secret):

```bash
curl -X POST "https://dev.prepservicesfba.com/api/inbound-tracking/cron?secret=YOUR_CRON_SECRET"
```

Expected: `{"success":true,"refreshed":0,"intervalHours":6}` (or `refreshed` > 0 if stale trackings exist).

**Firebase logs** (after deploy, wait for next run or trigger manually in GCP Console → Cloud Scheduler):

- Firebase Console → Functions → `inboundTrackingRefreshCron` → Logs  
- Look for: `[inboundTrackingRefreshCron] ok`

## 5. Production URL

When you move off dev, update config and redeploy:

```bash
firebase functions:config:set app.url="https://ims.prepservicesfba.com"
firebase deploy --only functions:inboundTrackingRefreshCron
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` on cron URL | `CRON_SECRET` on hosting ≠ `cron.secret` in Firebase |
| Function log: `Missing secret` | Run `functions:config:set cron.secret=...` and redeploy |
| Function log: `failed 404` | Wrong `app.url` — must be the public app origin (no trailing path) |
| `refreshed: 0` always | Normal if no trackings or all checked within 6 hours |
| Index error in logs | Run `firebase deploy --only firestore:indexes` |

## Optional: env vars instead of `functions:config`

In Google Cloud Console → Cloud Functions → `inboundTrackingRefreshCron` → Edit → Runtime environment variables:

- `APP_URL` = your app URL  
- `CRON_SECRET` = same as hosting  

Redeploy not required for console-only env changes on some setups; prefer `config:set` + deploy for reproducibility.
