# Barcode Scanning — Step 1: Location Structure

Status: **Locked**
Owner: Engineering + Operations
Scope: Defines how physical warehouse storage is modeled in the system so that inbound, putaway, moves, picking, and barcode scanning all reference an unambiguous "address" for stock.

This document is the foundation for every later step (barcode generator, label printing, scan-driven inbound/outbound, cycle counts).

---

## 1. Objective

Standardize **how locations are organized** across all warehouses so that:

- Every unit of stock can be addressed to an **exact bin**.
- Barcodes printed for bins resolve to that bin without ambiguity.
- Multi-warehouse clients are supported cleanly.
- Existing inventory data continues to work (back-compat).

---

## 2. Hierarchy (fixed)

```
Warehouse → Area → Row → Bay → Level → Bin
```

- **Warehouse**: physical building (e.g. `NJ02`)
- **Area**: zone inside the warehouse (`A, B, C`)
- **Row**: aisle / row of racking (`1, 2`)
- **Bay**: a section in the row (`A, B, C`)
- **Level**: shelf level inside a bay (`1, 2, 3, 4`)
- **Bin**: smallest slot where stock physically sits (`B01, B02, B03`)

> Stock **only** lives at the **Bin** level (leaf).
> Higher levels (Area/Row/Bay/Level) are organizational, not stock holders.

---

## 3. Identifiers and Path Format

Each bin has two identifiers:

- **`binId`** — stable, system-generated, never edited (used everywhere internally and by barcodes).
- **`path`** — human-readable display, used for labels and UI.

**Path format:**

```
<Warehouse>-<Area>-<Row>-<Bay>-<Level>-<Bin>
```

**Example:**

```
NJ03-A-R1-BA1-L1-B01
```

**Allowed characters:** `A–Z`, `0–9`. No spaces, no special characters (keeps barcodes clean).

**Segment format (v2 — typed prefixes):**

| Level     | Pattern | Example |
| --------- | ------- | ------- |
| Warehouse | code as-is | `NJ03` |
| Area      | plain code (no prefix) | `A` |
| Row       | `R` + number (no leading zeros) | `R1`, `R2` |
| Bay       | `BA` + number | `BA1`, `BA2` |
| Level     | `L` + number | `L1`, `L2` |
| Bin       | `B` + two-digit number | `B01`, `B02` |

---

## 4. Multi-warehouse Support

- A single client **can have stock in multiple warehouses at the same time**.
- Bin codes are **unique per warehouse**, not globally.
  - `A1` may exist in **NJ02** and **NJ03**.
  - The full **`path`** is what is globally unique.
- During outbound, system must know **which warehouse / which bin** stock leaves from.

---

## 5. Data Model (Firestore)

### 5.1 Warehouses

```
warehouses/{warehouseId}
  - code: "NJ02"
  - name: "New Jersey Warehouse 02"
  - active: true
  - country, stateOrProvince, address fields...
  - createdAt, updatedAt
```

### 5.2 Bins (subcollection per warehouse)

```
warehouses/{warehouseId}/bins/{binId}
  - area: "A"
  - row: "1"
  - bay: "A"
  - level: "1"
  - bin: "B01"
  - path: "NJ03-A-R1-BA1-L1-B01"
  - barcode: "NJ03-A-R1-BA1-L1-B01"   // QR payload = full path
  - active: true
  - capacity?: number
  - createdAt, updatedAt
```

> Why subcollection? Cleaner queries per warehouse, easier permissions, no cross-warehouse collisions, and natural path scoping.

### 5.3 Inventory linkage

`inventoryItem.locationQuantities` becomes a map keyed by **`binId`**:

```
locationQuantities: {
  "<NJ02_binId_for_A1>": 30,
  "<NJ02_binId_for_A2>": 20,
  "<NJ03_binId_for_A1>": 20
}
```

> A back-compat read layer keeps interpreting old `warehouseId → qty` records for items that have not been migrated yet.

---

## 6. Location Generator (admin tool)

Admin opens **Generator UI**, selects a warehouse, and provides:

- Areas (default `A, B, C`)
- Rows per area (default `1, 2`)
- Bays per row (default `A, B, C`)
- Levels per bay (default `1, 2, 3, 4`)
- Bins per level (default `B01, B02, B03`)

System then:

1. Computes the **cartesian product** of all combinations.
2. Creates one **bin document** per combination.
3. Generates `path` and `barcode` for each.
4. Skips combinations that already exist (idempotent).
5. Returns a summary (created / skipped / failed).

Defaults are configurable per warehouse (e.g. one warehouse may have bays A–F, another only A–C).

---

## 7. Bulk Print (PDF)

After generation, admin can:

- Select a warehouse (optionally area/row filter).
- Click **Print Labels (PDF)**.
- System renders one label per bin with:
  - Barcode (encoding decided in Step 2)
  - Human-readable path (e.g. `NJ03-A-R1-BA1-L1-B01`)
  - Optional metadata (warehouse name).

Label sheet layout (size, columns, paper) finalized in Step 2.

**Sample PDF (training / layout preview):** `barcode-label-sheets-sample.pdf` in this folder — one bay grid (**5 levels × 3 bins/level** in the sample), each shelf level color-coded. Regenerate with `npm run docs:bin-label-pdf`.

---

## 8. Validations and Rules

- **Unique tuple per warehouse:** `(area, row, bay, level, bin)` must be unique inside a warehouse.
- **Cross-warehouse duplicates allowed:** same code can exist in multiple warehouses.
- **Soft delete only:** a bin holding stock cannot be deleted; admin can only `active = false`.
- **No special characters** in any segment of the path.
- **No stock at non-leaf nodes:** Area/Row/Bay/Level cannot hold quantity directly.

---

## 9. Migration Plan (high level)

1. Create new `bins` subcollection per warehouse (no impact on existing inventory).
2. Provide a **Migration Tool** that:
   - For each inventory item with old `locationQuantities` keyed by warehouseId,
   - Lets admin map quantities to specific bins (manual or auto to a default bin).
3. Reads in the app fall back to old format until migration completes.

---

## 10. Out of Scope (handled in later steps)

- Barcode encoding choice (Code128, QR, GS1) → **Step 2**
- Inbound + Receiving + Inspection scanning flow → **Step 3, 4**
- Outbound shipment scanning + verification → **Step 6**
- Inventory movement (bin → bin) → **Step 7**
- Status reporting and audit logs → **Step 8**

---

## 11. Acceptance Criteria for Step 1

- Admin can create/edit warehouses with code (e.g. `NJ02`).
- Admin can run the Generator to bulk-create bins under a warehouse.
- Each bin has a unique `(area,row,bay,level,bin)` tuple within its warehouse.
- Each bin has a `path` and `barcode` value computed and stored.
- Inventory module can store and read `locationQuantities` keyed by `binId`.
- Old inventory data still loads (back-compat read).
- Admin can deactivate (not delete) bins that hold stock.

---

## 12. Decisions Log

| # | Decision | Choice |
|---|----------|--------|
| 1 | Hierarchy | `Warehouse → Area → Row → Bay → Level → Bin` |
| 2 | Stock holder | Bin only |
| 3 | Multi-warehouse per client | Yes |
| 4 | Code uniqueness | Per warehouse; full path globally |
| 5 | Bin DB layout | Subcollection under warehouse |
| 6 | Defaults configurable | Yes, per warehouse |
| 7 | Inventory linkage | `locationQuantities` keyed by `binId`, with back-compat read |

---

## 13. Next Step

**Step 2: Barcode Generator Design** — encoding choice (Code128 vs QR), label size, what data the barcode encodes (path vs short id), and the bulk print format.
