# Barcode Scanning — Workflow and Role-Based SOP

Status: **Draft for execution**
Owner: Operations + Engineering + Warehouse Supervisors
Prerequisite: `01_LOCATION_STRUCTURE.md` is locked

---

## 1. Purpose

Define a practical, scan-first warehouse operating workflow and role-based SOP so every stock action is traceable and consistent.

Core transaction rule:

`WHAT (product/carton) + WHERE (bin) + QTY (+ lot/expiry when required)`

---

## 2. Label Types Used in Operations

All labels are QR-based.

### Visual reference (training)

| Artifact | Purpose |
|----------|---------|
| `label-types-preview.svg` | Quick SVG overview of all label shapes |
| `barcode-label-sheets-sample.pdf` | **Printable A4 PDF**: page 1 = one bay with **5 levels × 3 bins/level**, each **level color-coded**; page 2 = product / carton / shipment samples with accent colors |

Regenerate the PDF after changing sample constants in `scripts/generate-bin-label-sheet-pdf.mjs`:

```bash
npm run docs:bin-label-pdf
```

**Sample layout assumptions (admin-configurable in product):**

- **5 shelf levels** per bay (rows on the sheet).
- **3 bins per level** (`A1`, `A2`, `A3` — columns). Adjust `LEVELS` and `BIN_CODES` in the script to match a warehouse.

### 2.1 Bin Label (Required)
- Purpose: identifies exact location.
- Payload: `binPath` (example: `NJ02-A-1-A-1-A1`).
- Printed by system from location generator.

### 2.2 Product Label (Required, unless vendor barcode exists)
- Purpose: identifies SKU/product.
- Payload: `sku` (preferred) or internal `productId`.
- System prints only when item lacks scannable supplier barcode.

### 2.3 Carton/Receiving Label (Recommended)
- Purpose: fast receiving with lot/expiry.
- Payload example: `SKU=ABC123|LOT=L2405A|EXP=2027-08-31|QTY=24`.
- Used heavily for inbound and traceability.

### 2.4 Shipment/Handling Label (Optional)
- Purpose: internal handling in staging/dispatch.
- Payload: shipment id / carton id.

---

## 3. Data and Policy Rules (Locked)

- Lot requirement: **category-based**
- Expiry requirement: **category-based**
- Picking policy for expiry-managed stock: **FEFO**
- Missing/invalid expiry on required category: **block worker + supervisor override allowed with reason**

Stock identity bucket:

`SKU + Lot + Expiry + Bin`

---

## 4. End-to-End Operational Workflow

## 4.1 Setup (One-time)
1. Admin creates warehouse (`NJ02`, etc.).
2. Admin generates bin tree (`Area -> Row -> Bay -> Level -> Bin`).
3. Admin prints and sticks bin QR labels.
4. Admin sets product category controls:
   - `requiresLot: true/false`
   - `requiresExpiry: true/false`

## 4.2 Receiving at Dock  (recieving)
1. Receiver opens Receiving screen.
2. Scans product/carton QR.
3. Scans destination bin QR.
4. System validates SKU, lot, expiry by category policy.
5. Receiver confirms qty.
6. System posts stock to bin and logs movement.

## 4.3 Putaway (if staging is used) (inbound)
1. Scan source (staging pallet/carton).
2. Scan destination bin.
3. Confirm qty moved.
4. System updates stock location and movement history.

## 4.4 Internal Bin-to-Bin Move 
1. Scan source bin.
2. Scan product/carton.
3. Scan destination bin.
4. Confirm qty.
5. System transfers exact lot/expiry bucket.

## 4.5 Outbound Picking (outbound)
1. Picker opens assigned order wave.
2. System suggests pick sequence (FEFO where expiry applies).
3. Picker scans bin and product/carton.
4. System verifies match.
5. Picker confirms qty picked.
6. Repeat until order is complete.

## 4.6 Packing and Dispatch (pick n pack)
1. Packer scans picked cartons/items.
2. System verifies order completeness.
3. Label attached and shipment confirmed.
4. System deducts inventory from exact bucket.

## 4.7 Cycle Count and Reconciliation
1. Auditor scans bin.
2. System displays expected inventory by SKU/lot/expiry.
3. Auditor enters counted qty.
4. Variance posted with reason and user identity.

---

## 5. Role-Based SOP

## 5.1 Receiver SOP
- Use Receiving screen only.
- Always scan item first, then bin.
- Do not bypass lot/expiry prompts.
- If blocked by validation, call supervisor.
- Confirm qty before final submit.

Success metric:
- Dock-to-stock time, receiving accuracy, zero untagged inventory.

## 5.2 Putaway Operator SOP
- Move only using scan flow (no manual relocation).
- Scan source and destination every move.
- Keep mixed lots separated unless system explicitly allows same-bin mixing.

Success metric:
- Putaway completion time, location accuracy, no orphan stock.

## 5.3 Picker SOP
- Pick from system-suggested bin sequence.
- For expiry categories follow FEFO picks only.
- If scanned item mismatches order suggestion, stop and re-scan.
- Never substitute lot without approval.

Success metric:
- Pick accuracy, mis-pick rate, first-pass order completion.

## 5.4 Packer SOP
- Scan every picked unit/carton before sealing.
- Confirm shipment content equals order requirements.
- Flag shortage/damage immediately.

Success metric:
- Pack accuracy, shipping error rate, return reduction.

## 5.5 Inventory Auditor SOP
- Perform cycle counts by schedule.
- Scan bin before counting.
- Record variance reason category (damage, misscan, theft, found stock, etc.).
- Escalate repeat variances on same SKU/bin.

Success metric:
- Inventory accuracy percent, count completion rate, variance trend.

## 5.6 Supervisor SOP
- Handle override requests (missing/invalid expiry/lot where required).
- Override only with reason note.
- Review daily exception report.
- Coach repeat offenders and update process controls.

Success metric:
- Exception closure time, override quality, reduced repeat exceptions.

---

## 6. Exception Handling Matrix

| Situation | Worker Action | System Action | Supervisor Action |
|---|---|---|---|
| Missing lot (required category) | Stop and request help | Block submit | Override with reason or reject |
| Invalid/missing expiry (required category) | Stop and request help | Block submit | Override with reason or reject |
| Wrong product scan at pick | Re-scan | Hard mismatch warning | Investigate if repeated |
| Wrong bin scan during directed task | Re-scan correct bin | Warning or block | Adjust task if needed |
| Expired stock scanned for ship | Stop shipment | Block/hold | Quarantine decision |

---

## 7. Minimum Audit Fields Per Scan Transaction

- `eventType` (`receive`, `putaway`, `move`, `pick`, `pack`, `count`, `override`)
- `userId`
- `warehouseId`
- `binId` and `binPath`
- `productId` / `sku`
- `lot` (if present/required)
- `expiryDate` (if present/required)
- `quantity`
- `timestamp`
- `deviceId` (optional but recommended)
- `overrideReason` (required for supervisor overrides)

---

## 8. Training Checklist (Go-Live)

- Staff can identify all labels (bin/product/carton/shipment).
- Staff can complete receive -> putaway -> pick -> pack flow by scan.
- Supervisors can process overrides with reason.
- Team can perform cycle count and post variance.
- Daily exception and audit reports are reviewed.

---

## 9. Go-Live Acceptance Criteria

- 100% active bins have readable QR labels.
- Receiving is scan-first for all inbound.
- FEFO enforced for expiry-managed categories.
- All overrides are supervisor-approved and reason-coded.
- Cycle count process active with variance logs.

