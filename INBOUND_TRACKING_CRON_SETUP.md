# Inbound tracking refresh (page load only)

Client **Inventory** refreshes stale carrier statuses **when the page loads**. There is no scheduled refresh cron.

```
Inventory page load
  → POST /api/inbound-tracking/refresh-stale
    → refresh this user's stale inbound trackings
```

Admin **Inbound Tracker** uses the same pattern:

```
Inbound Tracker page load
  → POST /api/inbound-tracker/refresh-stale
```

## Removed (cost)

`inboundTrackingRefreshCron` and `inboundTrackerRefreshCron` were deleted. They had been left on `every 1 minutes` during testing and drove large Firestore read + egress bills. Scheduled routes `/api/inbound-tracking/cron` and `/api/inbound-tracker/cron` now return `410` disabled.

Do not re-add a Cloud Scheduler refresh for these paths.

## Required env (page-load refresh)

| Variable | Required |
|----------|----------|
| `SHIPPO_API_KEY` | Yes (carrier poll) |
