# Barcode Scanning — Warehouse Workflow v2 (Plain English)

Status: **Draft for review**
Owner: Operations + Engineering
Replaces: workflow section of `02_WORKFLOW_AND_ROLE_BASED_SOP.md`
Prerequisites: `01_LOCATION_STRUCTURE.md` (locked)

This is the full real-life workflow in plain language, covering every scenario discussed: areas with types, walk-in pallets without labels, mixed pallets, damage at arrival, returns, quarantine, cycle counts, adjustments, cross-warehouse transfers, exceptions and reports.

Read it like a story; verify each scenario against your real operation before locking.

---

## Part 0 — One-time setup (admin)

1. Admin creates a warehouse (e.g. `NJ02`).
2. Admin creates **areas** and picks a **type** for each:
   - **Storage** areas (will get racks).
   - **Receiving** area (dock).
   - **Quarantine**, **Damaged**, **Returns**, **Packing**, **Dispatch**.
3. For storage areas only, admin runs the bin generator: `Row → Bay → Level → Bin`.
4. Admin prints **bin labels** (color-coded by level) and sticks them on the racks.
5. Admin sets product categories:
   - Which require **lot**?
   - Which require **expiry**?
6. Admin defines users and devices.
7. Done. Warehouse is **live**.

---

## Part 1 — A truck arrives at the dock

There are 4 possible truck scenarios. Worker picks one at the start.

### Scenario A — Supplier sent us an ASN (advance shipping notice)

1. Worker opens **Receiving** screen.
2. Picks the matching ASN from a list.
3. App shows expected lines: `SKU + qty + lot + expiry`.
4. Truck is unloaded; pallets/cartons placed in receiving area.
5. Worker scans each carton:
   - If supplier label is scannable → scan it.
   - If not → search SKU manually.
6. App auto-fills lot/expiry from ASN, worker confirms.
7. App prints our **internal carton label** with QR (`SKU + LOT + EXP + QTY + CARTON_ID`).
8. Worker sticks our label on the carton.
9. Carton is now ready for putaway.

### Scenario B — Walk-in pallet, no ASN, no scannable label

1. Worker opens **Receiving (Walk-in)** screen.
2. Worker searches the SKU (or asks supervisor to add it if new).
3. Worker takes a **photo of the supplier paperwork** (required when no label).
4. Worker enters **lot** and **expiry** from paperwork.
5. App validates format. If lot/expiry needed and missing → **blocked → supervisor override** with reason.
6. Worker enters quantity.
7. App prints our **internal carton label**.
8. Worker sticks our label on the carton.

### Scenario C — Mixed pallet (one pallet has 10 different SKUs)

1. Worker creates a temporary **pallet record** (e.g. `PAL-2026-00077`).
2. App enters carton-by-carton receiving loop.
3. For each carton:
   - Identify SKU (scan or search).
   - Confirm lot/expiry (from label, ASN, or paperwork).
   - Print our internal carton label.
4. Once all cartons are received, the pallet is "linked" to those cartons.
5. Pallet can be moved as one unit **or** split later. Both supported.

### Scenario D — Damaged or "looks wrong" on arrival

1. Worker still receives normally, but marks the carton as **`damaged`**.
2. Photo evidence is mandatory.
3. Carton goes into the **damaged area**, not normal storage.
4. Notification goes to supervisor for decision.

> **Golden rule:** No carton leaves the dock without a PrepCorex internal carton label.

---

## Part 2 — Putaway (moving from dock into storage)

1. Worker opens **Putaway** screen.
2. Worker scans the **carton QR** (our internal one).
3. Worker walks to a storage bin.
4. Worker scans the **bin QR**.
5. App validates:
   - Bin is in `storage` area type.
   - Bin not full (if capacity is set).
   - Carton state is `available` (won’t putaway damaged into normal storage).
6. Worker confirms.
7. App moves the carton from receiving area → storage bin.
8. Movement log is recorded.

For pallets: scan **pallet QR** + bin QR; all cartons on that pallet go to that bin together.

---

## Part 3 — Internal moves (bin to bin)

Used when stock is reorganized inside the warehouse.

1. Worker scans **source bin QR**.
2. Worker scans **carton QR** (or pallet QR).
3. Worker scans **destination bin QR**.
4. Worker confirms.
5. App moves the carton; logs who/when/where.

---

## Part 4 — Picking for an outbound order

1. Order arrives in app (manual entry or pulled from Shopify/eBay).
2. App generates a **pick list** using **FEFO** (earliest expiry first) for expiry-managed SKUs.
3. Picker opens the order.
4. App shows pick steps in optimal walk order.
5. For each pick step:
   - Picker scans the **bin QR**.
   - Picker scans the **carton QR**.
   - App validates: matches order? right SKU? right lot? state = `available`? not expired?
   - Picker confirms quantity picked.
6. Repeat until order is fully picked.
7. Order moves to "ready to pack".

If a wrong scan happens → app blocks and tells the picker what was expected.

If a needed lot is short → supervisor decides: substitute lot, partial ship, or backorder.

---

## Part 5 — Packing & dispatch

1. Packer opens the order at the packing bench.
2. App shows expected items.
3. Packer scans each carton/unit (PKG/CTN) or confirms loose units on screen.
4. App verifies completeness.
5. Packer attaches the carrier label (existing labels module).
6. **Packer scans the courier label barcode** — app shows ship-from / ship-to and binds tracking to the order.
7. Packer taps **Ready to dispatch** — warehouse carton stock decrements; order enters the dispatch queue.
8. At dispatch staging, worker **scans the courier label again**.
9. App confirms **correct parcel** (or rejects wrong label).
10. Worker confirms **Dispatched** — order leaves the queue (carrier handoff logged).

Stock is decremented at step 7 from the exact carton (which knows its `sku`, `lot`, `expiry`, `bin`).

---

## Part 6 — Customer returns (RMA)

1. Returned package arrives.
2. Worker opens **Returns** screen.
3. Worker scans returned carton (or links to original order).
4. Photo evidence taken.
5. Carton enters **returns area** with state `quarantine`.
6. Supervisor or QC inspects and chooses:
   - **Restock** → carton becomes `available`, back to a storage bin.
   - **Damaged** → goes to damaged area.
   - **Dispose** → existing dispose request flow.
7. Movement log records every step with user/time/photo.

---

## Part 7 — Stock states and what they mean

Every carton has a status:

| State | Pickable? | Notes |
|---|---|---|
| `available` | Yes | Normal stock |
| `quarantine` | No | Pending inspection (returns, suspect lots) |
| `damaged` | No | Cannot ship; awaiting decision |
| `expired` | No | Auto-set when expiry passes |
| `on_hold` | No | Admin froze it |
| `reserved` | Conditional | Allocated to a specific order |

These states ensure the picker app never shows non-pickable stock.

---

## Part 8 — Cycle counts (regular checks)

Three styles, all run from the same scan flow:

1. **ABC count** — high-value SKUs counted weekly, mid monthly, low quarterly.
2. **Random spot count** — system suggests a few bins per day to count.
3. **Full physical** — periodic full warehouse count.

Worker flow for each count:

1. Open count task.
2. Scan bin QR.
3. App shows expected cartons in that bin.
4. Worker scans cartons present.
5. Enters quantity.
6. Variance is calculated automatically with reason category.

---

## Part 9 — Stock adjustments (variance / write-off / found)

Only supervisors can do this.

1. Open adjustment screen.
2. Choose carton or bin.
3. Enter +/- quantity.
4. Choose reason (damage, theft, miscount, found stock).
5. Required note + optional photo.
6. App logs and updates stock.

---

## Part 10 — Cross-warehouse transfer

1. Admin or supervisor creates a **transfer order**.
2. From warehouse `NJ02`, system runs a **special outbound**:
   - Pick → pack → dispatch as usual.
   - Cartons keep their identity (`sku/lot/expiry/cartonId`).
3. At destination warehouse `NJ03`:
   - Run a **special inbound** linked to the transfer order.
   - Cartons are scanned in (no need to relabel) and putaway.
4. App shows real-time status: "in-transit", "received".

---

## Part 11 — Supervisor responsibilities (cross-cutting)

Supervisors handle exceptions throughout:

- Override missing lot/expiry at receive (with reason).
- Approve over-receipt.
- Approve return outcomes (restock / dispose / damage).
- Approve stock adjustments.
- Approve substitutions during picking.
- Approve cross-warehouse transfers.
- Resolve cycle count variances.

Every override is logged and shows up in a **daily exception report**.

---

## Part 12 — Reports the system provides

- **Inbound throughput** per receiver / day.
- **Pick accuracy** + mispick rate.
- **Inventory aging** by SKU / lot / expiry.
- **Bin occupancy** map.
- **Variance log** from cycle counts.
- **Override log** (supervisor actions).
- **Movement history** per carton (full life cycle).
- **Stock by client** (3PL view).

---

## Part 13 — Worker’s mental model in one line

For *every* warehouse action, the app needs three answers:

> **WHAT** (carton/sku/lot) + **WHERE** (bin) + **HOW MUCH** (qty)

Receiving, putaway, moves, picking, packing, returns, transfers — all collapse into that pattern. Different screens, same logic.

---

## Part 14 — Hard rules the system enforces no matter what

1. No carton leaves the dock without our internal label.
2. No stock at non-leaf locations (only bins or virtual bins).
3. No mixing of states in same record (status is per carton).
4. No picking from `quarantine`, `damaged`, `expired`, `on_hold`.
5. No bin can be deleted while it holds cartons.
6. Every action is logged with user + device + timestamp.
7. All exceptions need a supervisor override + reason.

---

## Part 15 — What admin sees on dashboard

- Live counts: pending receives, pending putaway, pending picks, pending dispatch.
- Live exception count (overrides + variances).
- Inventory health (expired, near-expiry, damaged, on-hold totals).
- Daily / weekly trends.

---

## Coverage summary

Scenarios covered:

- Areas with types ✅
- Walk-in pallets without labels ✅
- Mixed pallets (multiple SKUs on one pallet) ✅
- Damage at arrival ✅
- Returns ✅
- Quarantine and other states ✅
- Cycle counts ✅
- Stock adjustments ✅
- Cross-warehouse transfers ✅
- Reports + audit + exceptions ✅
- Internal carton label as the ground truth ✅

Out of scope for v1 (planned for later):

- Replenishment zones (bulk → pick face)
- Kits / bundles (BOMs)
- Serial numbers (per-unit tracking)
- Offline scanning
- Hazmat compliance details

---

## How to use this document

1. Read each part as if you’re standing on the warehouse floor.
2. Mark any scenario that does **not match** your operation.
3. Mark any step you want **shorter** (less friction) or **stricter** (more control).
4. Once locked, this becomes the master reference for Step 3 — designing the actual app screens that implement these flows.
