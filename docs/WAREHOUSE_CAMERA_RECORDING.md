# Warehouse Camera Recording — Purpose, Requirements & Implementation Guide

Status: **Mobile-camera pilot implementation**  
Owner: Operations + Engineering  
Product: PrepCorex / PSF StockFlow  
Last updated: 2026-08-18

---

## 1. Executive summary

PrepCorex will integrate **event-based warehouse video recording** with warehouse operations. Cameras provide **live view** when no job is active. When an operator starts a defined workflow (starting with **inbound receiving**), the camera in that zone **starts recording**, and when the job ends the clip is **uploaded to cloud storage** and **linked to the client and job** (e.g. inbound request ID).

This document defines **purpose**, **functional requirements**, and everything needed to implement the system: **hardware**, **software**, **APIs**, **cloud**, **network**, **data model**, and **phased rollout**.

### 1.1 Current v1 decision — mobile recording

This section supersedes older pilot statements below that assume an RTSP camera, NVR, or mini PC.

- The warehouse operator records from the PrepCorex receiving page on a phone/tablet.
- Entering a matched inbound receive shows a **Start recording** prompt.
- Before each clip, the operator can choose the phone's **front or back camera**.
- Recording supports **pause, resume, stop, and multiple clips** for one inbound request.
- The same phone video track publishes to a private **LiveKit Cloud** room while recording.
- The client sees **Receiving live now** with the product, SKU, and request ID, and can watch only
  sessions linked to their account.
- When live stops, Inventory shows **Live session ended for {product/SKU}** until dismissed.
- After Drive upload, the client can **Watch receiving video** from the inbound request, the stock
  row, and **History → Inbound & damage**. Playback is streamed through PrepCorex; Drive stays private.
- Active recorders send an eight-second heartbeat. Client views refresh every five seconds and hide
  a live notice after stop or after 30 seconds without a heartbeat.
- On stop, the complete clip is stored in **IndexedDB on that phone/browser**.
- PrepCorex asks whether to upload immediately; **Later** leaves the phone copy available on the receive.
- Confirmed upload uses a resumable browser-to-**admin Google Drive** transfer, avoiding Vercel body/disk limits.
- Firestore stores session metadata and the private Drive file ID/link; it does not store MP4/WebM bytes.
- The Drive hierarchy is:
  `PrepCorex Warehouse Recordings/{warehouse}/{client} ({uid})/Receiving/{product name qty-N YYYY-MM-DD}/{product name qty-N date session-N.webm}`.
- Google Drive is not the live relay. LiveKit handles live video; Drive stores completed clips.
- Drive files remain private in v1. Warehouse/admin can open the Drive link; clients see live state and
  recording/upload status in PrepCorex.
- **Retention:** v1 has no automatic expiry. A phone copy remains in that browser's IndexedDB until
  the operator removes it, clears browser/site data, or the browser evicts storage under device
  pressure. An uploaded Drive copy remains until an admin deletes it from Drive.

Required server environment variables:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_DRIVE_VIDEO_FOLDER_ID (optional dedicated parent folder)
```

The LiveKit API secret and Google OAuth credentials must never use a `NEXT_PUBLIC_` prefix.
After deployment, an admin connects Google Drive from **Admin dashboard → Integrations & Storage**.
The OAuth callback automatically stores the refresh token server-side in
`system/googleDrive`; `GOOGLE_DRIVE_REFRESH_TOKEN` remains only a legacy fallback.

---

## 2. Purpose (why we need this)

### 2.1 Primary goal

Record warehouse work **only when operators perform a real job**, and save video in the cloud **named and linked to the correct client and task**.

### 2.2 Business benefits

| Purpose | Benefit |
| --- | --- |
| Proof of work | Evidence of what was received, prepped, or shipped |
| Dispute resolution | Resolve quantity/damage disagreements with clients |
| Quality control | Review operator handling and process compliance |
| Accountability | Tie video to operator, client, and job ID |
| Training | Use real sessions to onboard warehouse staff |
| Security | Live monitoring when idle; targeted recording during work |

### 2.3 Expected behavior

| State | Camera behavior |
| --- | --- |
| Idle (no active job) | Live view only — no cloud recording |
| Job started in PrepCorex | Zone camera starts recording |
| Job completed or cancelled | Recording stops, clip exported and uploaded |
| After upload | File named by client + job; link visible in PrepCorex admin |

### 2.4 Example (receiving)

1. Receiver opens inbound receive for **Client PSF StockFlow** in PrepCorex.
2. **Receiving area** camera starts recording.
3. Receiver completes receive.
4. Recording stops and uploads as e.g. `10001_PSF-StockFlow_inb_abc123_2026-07-06_14-32-00.mp4`.
5. Admin opens that inbound request → **View recording**.

---

## 3. Scope

### 3.1 In scope (v1)

- Event-triggered recording for **inbound receiving** at one warehouse (pilot).
- One or more cameras in the **receiving zone**.
- Cloud upload with **client + inbound request** naming.
- Firestore session metadata and admin playback link.
- Live view via NVR (on-site monitor or NVR app).

### 3.2 In scope (later phases)

- Additional zones: staging, prep/pack, outbound, returns.
- Multiple warehouses.
- Optional client-visible recordings for disputes.
- Retention automation (auto-delete after N days).

### 3.3 Out of scope (v1)

- 24/7 continuous cloud recording for all cameras.
- AI person detection / auto-start without app trigger.
- Audio recording (review local law before enabling).
- Cameras in private areas (restrooms, break rooms).

---

## 4. Functional requirements

### 4.1 Camera coverage

| Zone | Trigger (phase) |
| --- | --- |
| Receiving / dock | Receiver starts inbound receive (Phase 1) |
| Staging | Putaway started (Phase 2) |
| Prep / pack tables | Prep job started (Phase 2) |
| Outbound / shipping | Shipment prep started (Phase 2) |
| Returns | Return processing started (Phase 2) |

Each zone requires at least one camera with a clear view of the work surface, cartons, and operator hands.

### 4.2 Live view

- Authorized roles (admin, warehouse manager, warehouse ops) can view live feeds when not recording.
- Phase 1: live view via NVR vendor app or warehouse monitor.
- Phase 2+: optional embedded live view in PrepCorex admin.

### 4.3 Event-based recording

- Recording **must start** when operator starts a defined PrepCorex action.
- Recording **must stop** when that action completes, is cancelled, or times out (idle timeout TBD, e.g. 10 minutes).
- First trigger: **Start receiving** for an inbound request.

### 4.4 Business data linkage

Every recording session must store:

| Field | Description |
| --- | --- |
| `clientId` | Client display ID (e.g. 10001) |
| `clientName` | Client company name |
| `jobType` | `receive`, `prep`, `ship`, `return`, etc. |
| `jobId` | e.g. inbound request ID |
| `warehouseId` | Warehouse / location |
| `zoneId` | e.g. `receiving` |
| `operatorId` | User who started the session |
| `startedAt` / `endedAt` | Session timestamps |
| `storageUrl` | Cloud file URL or path |
| `status` | `recording` \| `exporting` \| `uploading` \| `completed` \| `failed` |

### 4.5 Cloud storage and naming

**Folder structure (recommended):**

```text
warehouse-recordings/
  {warehouseCode}/
    {zone}/
      {clientId}_{clientName}/
        {jobType}_{jobId}_{YYYY-MM-DD_HH-mm-ss}.mp4
```

**Example:**

```text
warehouse-recordings/NJ02/receiving/10001_PSF-StockFlow/receive_inb_abc123_2026-07-06_14-32-00.mp4
```

**Storage provider (recommended order):**

1. **Firebase Storage** or **Google Cloud Storage** — best fit with existing stack.
2. **Google Drive** — acceptable for pilot; not ideal at scale (API limits, large files).

### 4.6 PrepCorex UI

- Admin (and warehouse manager) sees **View recording** on the linked inbound request.
- Show session status: Recording → Uploading → Saved / Failed.
- Failed uploads must be retryable and visible in admin.

### 4.7 User roles

| Role | Access |
| --- | --- |
| Receiver / operator | Starts job → recording starts automatically (no extra steps if possible) |
| Warehouse manager | Live view; recordings for their warehouse |
| Admin | Full access; all warehouses; audit trail |
| Client | Optional later — own inbound/shipment recordings only |

---

## 5. Non-functional requirements

### 5.1 Reliability

- If internet fails, NVR buffers locally; upload resumes when connection returns.
- Recording session persisted in Firestore — survives app refresh.
- Idempotent start/stop API (duplicate calls do not create orphan files).

### 5.2 Security

- Camera network on isolated VLAN.
- No cameras directly exposed to public internet.
- Playback via signed URLs, not public permanent links.
- NVR and cloud credentials in secrets manager only.

### 5.3 Privacy & compliance

- Post signage where recording occurs.
- Written policy for staff.
- Define retention period and deletion process.
- Confirm state/local labor and privacy rules before rollout.

### 5.4 Performance & storage

- Minimum **1080p** for receiving and prep zones.
- Retention policy required before go-live (suggested: **90 days** default).
- Plan upload bandwidth: ~1–2 GB/hour per 1080p camera.

### 5.5 Scalability

- Support multiple warehouses and zones via configuration (not hard-coded).
- Same event pattern for receive, prep, pack, ship, returns.

---

## 6. What we need — hardware

### 6.1 Cameras

| Item | Requirement |
| --- | --- |
| IP cameras (PoE) | One or more per zone |
| Resolution | 1080p minimum; 4MP if detail/zoom needed |
| Low light | IR or strong low-light for dock areas |
| Mounting | Ceiling/wall mounts, junction boxes, cable runs |

**Vendor examples:** Hikvision, Dahua, Axis, Ubiquiti UniFi Protect, Reolink (business tier).

### 6.2 Network & power

| Item | Requirement |
| --- | --- |
| PoE switch | 8/16/24 port depending on camera count |
| Cat6 cabling | From switch/NVR to each camera |
| VLAN router/firewall | Separate camera network from office LAN |

### 6.3 Recording appliance (choose one)

**Option A — NVR appliance (recommended for pilot)**

| Item | Requirement |
| --- | --- |
| NVR | Must support API or webhook for clip export |
| Local HDD | 4 TB+ for buffer during upload outages |

**Option B — Server + VMS**

| Item | Requirement |
| --- | --- |
| On-site mini PC / server | 24/7 operation |
| VMS software | Frigate, Shinobi, ZoneMinder, Synology Surveillance Station |

### 6.4 Optional

| Item | Purpose |
| --- | --- |
| Warehouse monitor/TV | Supervisor live view |
| UPS | Power backup for NVR |
| Dedicated upload internet | Avoid saturating office bandwidth |

### 6.5 NVR selection criteria (mandatory)

Before purchase, confirm the NVR supports:

- [ ] REST API or webhooks
- [ ] Export clip by start/end timestamp
- [ ] Per-camera or per-event recording control
- [ ] RTSP URLs for live stream (optional for Phase 2)

**API-friendly options:** UniFi Protect, Frigate, Synology Surveillance Station, some Hikvision (ISAPI).

---

## 7. What we need — software

### 7.1 On-site software

| Component | Purpose |
| --- | --- |
| VMS / NVR application | Live view, local buffer, clip export |
| **Recording bridge** (build) | Receives PrepCorex start/stop → calls NVR API |
| **Upload agent** (build) | Renames clip, uploads to cloud, updates Firestore |

### 7.2 PrepCorex / cloud software (build)

| Component | Purpose |
| --- | --- |
| Recording session API | `start` / `stop` / `status` |
| Firestore collections | Sessions + zone config |
| Warehouse ops hooks | Trigger on receive start/complete |
| Admin UI | View recording on inbound request |
| Background worker | Upload, retry, retention delete |
| Secrets config | NVR creds, storage service account |

### 7.3 Recommended storage stack

| Service | Use |
| --- | --- |
| Firebase Storage or GCS | Video files |
| Firestore | Session metadata |
| Cloud Functions or Cloud Run | Upload worker, webhooks |
| Signed URLs | Secure playback in admin UI |

---

## 8. What we need — APIs & integrations

### 8.1 PrepCorex APIs (to build)

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/warehouse/recording/start` | POST | Start session: zone, clientId, jobId, operatorId |
| `/api/warehouse/recording/stop` | POST | End session; trigger export + upload |
| `/api/warehouse/recording/[sessionId]` | GET | Status + signed playback URL |
| `/api/warehouse/cameras/zones` | GET | List zones per warehouse (admin config) |

**Start request body (example):**

```json
{
  "warehouseId": "NJ02",
  "zoneId": "receiving",
  "jobType": "receive",
  "jobId": "inb_abc123",
  "clientId": "10001",
  "clientName": "PSF StockFlow",
  "operatorId": "uid_xyz"
}
```

### 8.2 PrepCorex app events (triggers)

| App event | Recording action |
| --- | --- |
| Receiver starts inbound receive | `START` receiving zone |
| Receive completed | `STOP` |
| Receive cancelled | `STOP` (mark cancelled) |
| Session idle > N minutes | `STOP` (auto) |

*Phase 2: prep start, pack start, return start — same pattern.*

### 8.3 NVR / camera APIs (third-party)

| API | Use |
| --- | --- |
| NVR REST API | Start event, export clip by time range |
| RTSP | Live stream (Phase 2) |
| Webhooks | NVR notifies when export is ready |
| ONVIF | Optional discovery/control |

### 8.4 Cloud storage APIs

| API | Use |
| --- | --- |
| Firebase Storage / GCS SDK | Upload `.mp4` |
| Google Drive API v3 | Alternative for pilot (`files.create`) |
| Signed URL API | Time-limited playback links |

### 8.5 Integration architecture

```text
┌─────────────────┐     start/stop      ┌──────────────────┐
│  PrepCorex App  │ ──────────────────► │  Recording API   │
│  (warehouse ops)│                     │  (Next.js / CF)  │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    ▼                            ▼                            ▼
            ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
            │  Firestore   │            │ NVR Bridge   │            │ Upload Worker│
            │  sessions    │            │ (LAN/VPN)    │            │ (GCS/Drive)  │
            └──────────────┘            └──────┬───────┘            └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  NVR + IP    │
                                        │  Cameras     │
                                        └──────────────┘
```

**Recommended:** **Push model** — NVR/bridge uploads outbound to cloud; PrepCorex never needs inbound access to warehouse LAN.

---

## 9. Data model (Firestore)

### 9.1 `warehouseCameraZones/{zoneId}`

```typescript
{
  warehouseId: string;       // e.g. linked location / warehouse doc id
  warehouseCode: string;     // e.g. NJ02
  zoneKey: string;           // receiving | staging | prep | outbound | returns
  displayName: string;       // "Receiving Dock"
  nvrCameraId: string;       // ID in NVR system
  rtspUrl?: string;          // optional, Phase 2
  active: boolean;
}
```

### 9.2 `warehouseRecordingSessions/{sessionId}`

```typescript
{
  warehouseId: string;
  zoneId: string;
  jobType: "receive" | "prep" | "ship" | "return";
  jobId: string;             // inboundRequestId, etc.
  clientId: string;
  clientName: string;
  operatorId: string;
  operatorName?: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  status: "recording" | "exporting" | "uploading" | "completed" | "failed" | "cancelled";
  storageProvider: "gcs" | "firebase" | "drive";
  storagePath?: string;
  playbackUrl?: string;      // signed URL, refreshed on read
  fileSizeBytes?: number;
  durationSeconds?: number;
  errorMessage?: string;
  nvrExportId?: string;
}
```

### 9.3 Link from inbound request

Add optional field on inbound/shipment docs:

```typescript
recordingSessionId?: string;
recordingStatus?: string;
recordingPlaybackUrl?: string;  // or resolve via sessionId
```

---

## 10. Network & infrastructure

| Requirement | Detail |
| --- | --- |
| Camera VLAN | Isolate cameras from office and client Wi‑Fi |
| Upload bandwidth | Size for peak concurrent receives × cameras |
| Internet failover | Local NVR buffer if upload fails |
| Remote access | VPN or outbound-only push (preferred) |
| Secrets | NVR password, GCS service account — not in repo |

---

## 11. Accounts & credentials checklist

| Item | Storage |
| --- | --- |
| NVR admin user/password | Google Secret Manager / `.env` (server only) |
| GCS or Firebase Storage bucket | Firebase project config |
| Service account JSON (upload) | Secrets manager |
| Google Drive Shared Drive ID (if used) | Config + service account delegate |
| Per-zone `nvrCameraId` mapping | Firestore `warehouseCameraZones` |

---

## 12. Phased implementation plan

### Phase 1 — Pilot (receiving, one warehouse)

**Duration estimate:** 3–6 weeks (hardware lead time + integration)

| Step | Deliverable |
| --- | --- |
| 1 | Install 1–2 cameras + NVR at receiving (NJ02 pilot) |
| 2 | Configure `warehouseCameraZones` in Firestore |
| 3 | Build `recording/start` and `recording/stop` APIs |
| 4 | Hook warehouse receive start/complete in PrepCorex |
| 5 | NVR bridge: export clip on stop |
| 6 | Upload worker → Firebase Storage / GCS |
| 7 | Admin UI: "View recording" on inbound request |
| 8 | UAT with real receive session |

**Phase 1 success criteria:**

- [ ] Receive start → receiving camera records
- [ ] Receive complete → file uploaded with client + inbound ID in path/name
- [ ] Admin plays video from inbound request within 5 minutes of complete
- [ ] No cloud recording when no receive is active
- [ ] Failed upload visible and retryable

### Phase 2 — Multi-zone + multi-warehouse

- Add staging, prep, outbound zones
- Triggers for putaway, prep, ship
- Retention job (delete after N days)
- Warehouse manager live view page

### Phase 3 — Client & operations maturity

- Optional client portal link for disputes
- Recording index report in admin
- AI-assisted suggestions (optional, later)

---

## 13. Cost considerations (rough)

| Item | Type | Notes |
| --- | --- | --- |
| Cameras + NVR + cabling | One-time | $500–$5,000+ per site depending on scale |
| Cloud storage | Monthly | ~$0.02/GB/month (GCS); video accumulates quickly |
| Upload bandwidth | Monthly | ISP plan |
| Engineering | One-time | APIs, bridge, UI, hooks |

**Example:** 1 camera, 2 hours recording/day, ~2 GB/hour → ~120 GB/month → ~$2–5/month storage per camera (excluding upload).

---

## 14. Pre-purchase decision checklist

Answer before ordering hardware:

| # | Question |
| --- | --- |
| 1 | How many warehouses? |
| 2 | How many cameras per warehouse (by zone)? |
| 3 | Which zone first? (receiving only for pilot) |
| 4 | NVR vendor — API documented and tested? |
| 5 | Cloud: Firebase/GCS or Google Drive? |
| 6 | Who can view recordings — admin only or clients too? |
| 7 | Retention — how many days? (suggest 90) |
| 8 | Who installs network and cameras? |
| 9 | Signage and staff policy ready? |

---

## 15. Open questions

| ID | Question | Owner | Status |
| --- | --- | --- | --- |
| OQ-1 | Exact camera count and placement per NJ02 | Operations | Open |
| OQ-2 | NVR vendor selection | IT / Operations | Open |
| OQ-3 | GCS vs Google Drive for pilot | Engineering | Open |
| OQ-4 | Client access to recordings — yes/no/later | Management | Open |
| OQ-5 | Retention period (days) | Management | Open |
| OQ-6 | Idle auto-stop timeout (minutes) | Operations | Open |
| OQ-7 | Legal review for NJ warehouse recording | Management | Open |

---

## 16. Related PrepCorex modules

| Module | Integration point |
| --- | --- |
| Warehouse ops / receiving | Start/stop trigger on receive |
| Inbound requests | Link `recordingSessionId`; admin playback |
| `users/{id}` client profiles | `clientId`, `companyName` for naming |
| `warehouses` / `locations` | Zone and warehouse config |
| Admin notifications | Optional alert on upload failure |
| OneDrive integration (existing) | Reference pattern for cloud upload auth |

---

## 17. Document history

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-06 | 0.1 | Initial draft — purpose, requirements, hardware/software/API checklist, phased plan |

---

## 18. Approval

| Role | Name | Date | Sign-off |
| --- | --- | --- | --- |
| Operations | | | |
| Engineering | | | |
| Management | | | |
