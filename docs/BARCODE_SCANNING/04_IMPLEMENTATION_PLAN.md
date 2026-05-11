# Barcode Scanning — Implementation Plan v1

Status: **Draft, ready to lock**
Owner: Engineering + Operations + Admin
Prerequisites:

- `01_LOCATION_STRUCTURE.md` — locked
- `02_WORKFLOW_AND_ROLE_BASED_SOP.md` — drafted
- `03_WAREHOUSE_WORKFLOW_V2.md` — drafted

This plan converts the workflow into an executable build plan with phases, sprints, deliverables, acceptance criteria, migration, and rollback.

---

## 1. Goals

1. Replace manual data entry in inbound, putaway, picks, packs, returns, and cycle counts with **scan-first** flows.
2. Move from item-quantity inventory to **carton-level** stock identity (`SKU + Lot + Expiry + Bin + Status`).
3. Support multi-warehouse, multi-client, and 3PL operations.
4. Deliver value in **3 small releases**, not one big bang.
5. Keep existing app functioning at every step (back-compat first).

---

## 2. Success Criteria (definition of "done" for v1)

- All active bins have unique scannable QR labels.
- All received cartons carry an internal PrepCorex carton label.
- Receiving, putaway, picking, packing, dispatch, returns, cycle counts, adjustments, and transfers are scan-driven.
- All overrides require supervisor + reason and are audit-logged.
- FEFO is enforced for expiry-managed categories.
- Reports list listed in `03` are available in admin dashboard.
- Old inventory data still loads via back-compat read.
- No data loss during migration.

---

## 3. Release Roadmap

### Release 1 — Foundation (Bin model + label print)
**Goal:** Physical labels on racks; admin can manage warehouses, areas, and bins.

### Release 2 — Scan-first Inbound + Outbound
**Goal:** Real warehouse staff doing real work via scans (receive → putaway → pick → pack → dispatch).

### Release 3 — Operations Layer
**Goal:** Returns, cycle counts, adjustments, transfers, reports, full dashboard.

Each release ships independently and is usable on its own.

---

## 4. Phases (mapped to releases)

| # | Phase | Release | Coding effort | Wall-clock (with UAT) |
|---|-------|---------|---------------|-----------------------|
| 1 | Data model: warehouse, areas, bins, generator, bin label PDF | R1 | 1–2 days | 3–4 days |
| 2 | Carton + pallet entities, stock states, UoM, internal carton label | R2 | 2–3 days | ~5 days |
| 3 | Receiving (4 scenarios), photo evidence, supervisor override | R2 | 3–4 days | ~1 week |
| 4 | Putaway + bin-to-bin moves + pallet moves | R2 | 1–2 days | ~3 days |
| 5 | Picking (FEFO) + packing + dispatch | R2 | 3–4 days | ~1 week |
| 6 | Returns / RMA (quarantine + QC decisions) | R3 | 1–2 days | ~3 days |
| 7 | Cycle counts (ABC, random, full) + stock adjustments | R3 | 2 days | ~4 days |
| 8 | Cross-warehouse transfers | R3 | 1–2 days | ~3 days |
| 9 | Reports + admin dashboard widgets + movement history | R3 | 2 days | ~4 days |
| 10 | Migration + back-compat + Firebase rules | R1–R3 | 1–2 days each | ongoing |
| 11 | UAT and bug fixes per release | each | ongoing | ~1 week / release |
| 12 | Training material + soft launch + monitoring | end of R3 | 1–2 days | depends on ops |

Indicative total: **~25–30 active coding days**, **~5–7 weeks wall-clock** with full UAT loops.

---

## 5. Per-phase plan

### Phase 1 — Foundation (Release 1)
**Scope:**
- Schema: `warehouses`, `areas` (with `type`), `bins` (per warehouse).
- Admin UI: create/edit warehouse, areas, area types.
- Bin generator UI (cartesian: row × bay × level × bin).
- Bin label PDF (sample script already prototyped under `scripts/generate-bin-label-sheet-pdf.mjs`).
- Migration: existing `locationQuantities` keyed by warehouseId → keep readable; migration tool optional in this phase.

**Acceptance criteria:**
- Admin can create at least 2 warehouses with multiple area types.
- Bin generator produces unique paths per warehouse.
- PDF labels print correctly with QR + path text + level color.
- Existing inventory module still loads with no regressions.

**Tests:**
- Unit: bin uniqueness, path format, area type validation.
- Integration: read old inventory, see correct totals.
- Manual: print PDF, scan with phone, payload matches path.

---

### Phase 2 — Carton + Pallet (Release 2)
**Scope:**
- Schema: `cartons` (sku, lot, expiry, qty, status, binId, palletId?, clientId).
- Schema: `pallets` (palletId, status, current binId).
- Stock states (`available`, `quarantine`, `damaged`, `expired`, `on_hold`, `reserved`).
- UoM definition per product (each / pack / case / pallet).
- Internal carton label PDF generator.
- Background job: auto-set `expired` when `expiry < today`.

**Acceptance criteria:**
- A carton can move between states only via approved transitions.
- Carton label prints with QR (`SKU+LOT+EXP+QTY+CARTON_ID`).
- Reading inventory correctly aggregates carton-level data into per-SKU totals.

**Tests:**
- State transition rules.
- Carton-to-bin associations.
- Aggregation correctness (cartons → SKU summary).

---

### Phase 3 — Receiving (Release 2)
**Scope:**
- Receiving screens: ASN-based, walk-in, mixed pallet, damaged.
- Photo evidence upload to Firebase Storage.
- Supervisor override modal with reason categories.
- Internal carton label print at end of each receive.

**Acceptance criteria:**
- All 4 receiving scenarios complete end-to-end.
- Override path captures reason, user, photo.
- Mixed pallet groups cartons under one pallet ID.
- No carton can leave receiving area without printed internal label.

**Tests:**
- Each scenario has its own UAT script.
- Failure paths: missing lot/expiry, invalid format, network drop mid-receive.

---

### Phase 4 — Putaway + Moves (Release 2)
**Scope:**
- Putaway screen: scan carton, scan bin, validate, commit.
- Bin-to-bin move: scan source bin, scan carton, scan destination bin.
- Pallet move: scan pallet, scan destination bin (moves all cartons).

**Acceptance criteria:**
- Cannot putaway into non-storage areas.
- Cannot putaway non-`available` cartons into normal storage.
- Movement log captures source/destination/user/time.

**Tests:**
- Validation errors render correctly.
- Move log appears in dashboard live.

---

### Phase 5 — Picking + Packing + Dispatch (Release 2)
**Scope:**
- Pick list generator with FEFO sort.
- Picker screen: optimal walk order, scan bin, scan carton, confirm qty.
- Pack screen: verify completeness, generate carrier label (existing module).
- Dispatch finalization: stock decrement from exact carton record.
- Substitution flow with supervisor approval if lot short.

**Acceptance criteria:**
- FEFO order respected for expiry-managed categories.
- Mispicks blocked with descriptive error.
- Order completion triggers correct deduction in `cartons` and `inventory` aggregate.

**Tests:**
- Order with multiple lines + multiple lots.
- Lot-short scenario (substitution + partial ship + backorder).
- Pack short / damage at packing.

---

### Phase 6 — Returns / RMA (Release 3)
**Scope:**
- Returns screen: scan/link return.
- Quarantine state assignment.
- QC decision flow (restock / damaged / dispose).
- Photo evidence + audit trail.

**Acceptance criteria:**
- Return cannot be restocked until QC decision is made.
- Restock returns carton to `available` and a chosen bin.
- Dispose ties into existing dispose flow.

**Tests:**
- Each QC outcome path.
- RMA without original order match (orphan returns).

---

### Phase 7 — Cycle counts + Adjustments (Release 3)
**Scope:**
- ABC + random + full count generators.
- Count task UI (mobile-friendly).
- Variance calculation + reason categories.
- Supervisor adjustment UI.

**Acceptance criteria:**
- Count tasks generate per schedule.
- Variances logged with reason.
- Adjustments require supervisor + reason + optional photo.

**Tests:**
- Empty bin count.
- Bin with multi-SKU multi-lot.
- High variance escalation.

---

### Phase 8 — Cross-warehouse transfers (Release 3)
**Scope:**
- Transfer order entity.
- Special outbound at source warehouse.
- Special inbound at destination warehouse.
- In-transit dashboard view.

**Acceptance criteria:**
- Cartons keep identity across warehouses.
- Status visible at all stages.
- Stock not double-counted during in-transit.

**Tests:**
- Transfer with mixed cartons.
- Cancel mid-transfer.

---

### Phase 9 — Reports + dashboard (Release 3)
**Scope:**
- Inbound throughput, pick accuracy, inventory aging, bin occupancy, variance log, override log, movement history per carton, stock by client.
- Admin dashboard widgets (live counts, exception count, inventory health).

**Acceptance criteria:**
- All listed reports load with date filters.
- Movement history per carton shows chronological events.

**Tests:**
- Performance with realistic dataset.
- Permission boundaries (admin vs sub_admin vs supervisor).

---

### Phase 10 — Migration + Firebase rules (cross-cutting)
**Scope:**
- Read-back-compat for old `locationQuantities`.
- Migration tool to map old quantities into specific bins (admin-driven or auto).
- Firestore rules for warehouse + carton scoping.
- Carton-level rules: clients only see their cartons; supervisors get override actions.

**Acceptance criteria:**
- No production data loss.
- Old inventory and new carton-based inventory coexist for the migration window.
- Firestore rules tested with test users for each role.

**Tests:**
- Rule emulator suite.
- Data integrity script before/after migration.

---

### Phase 11 — UAT per release
**Scope:**
- Operations team runs end-to-end scenarios.
- Bugs logged, fixed, re-verified.

**Acceptance criteria:**
- Zero blockers, no critical bugs at release sign-off.

---

### Phase 12 — Training + soft launch
**Scope:**
- Quick-reference SOP cards (1-pager per role).
- Short training videos.
- Soft launch: parallel running with manual flow for first week.
- Monitoring dashboard for errors/exceptions during soft launch.

**Acceptance criteria:**
- Team can complete each role’s flow without help by end of week 1.
- Exception count trending down day over day.

---

## 6. Migration & Back-Compat Strategy

1. New entities (`warehouses`, `areas`, `bins`, `cartons`, `pallets`) introduced without removing existing ones.
2. Inventory totals computed by:
   - **Old path:** existing `locationQuantities` keyed by warehouseId.
   - **New path:** sum of carton qty per SKU + bin.
3. Migration tool runs **per warehouse**:
   - Admin selects warehouse.
   - Tool lists items with old `locationQuantities`.
   - Admin maps/auto-assigns to bins; cartons created.
4. After migration is complete for a warehouse, that warehouse is flipped to "carton-mode".
5. Mixed mode supported during transition: app must read both.

---

## 7. Firebase Rules Approach

- **Warehouse scoping:** every doc carries `warehouseId`; rules check membership.
- **Client scoping:** carton/inventory docs carry `clientId`; clients read only theirs.
- **Role gating:** supervisor-only actions (override, adjust, approve transfer).
- **Audit:** writes to `movements` collection are only via secure paths.
- **Tests:** Firebase emulator suite with multi-role test users.

---

## 8. Rollback Strategy

For every release:

1. Feature flag (per phase) to disable new flow without redeploy.
2. Keep old flow code paths intact during transition window.
3. Database changes are additive (no destructive migrations).
4. Daily backups during migration phases.
5. Rollback procedure documented per phase before go-live.

---

## 9. Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Worker resistance to scan flow | High | High | Soft launch with parallel manual; training videos |
| Firebase rule misconfig leaks data | Medium | High | Emulator tests, staged rollout |
| Migration mismatches counts | Medium | High | Pre/post integrity script; dry-run mode |
| Hardware (printer/scanner) issues | Medium | Medium | Phone fallback; tested vendor list |
| Network outages during scan | Medium | Medium | Queue + retry; offline mode planned for later |
| Scope creep mid-build | High | Medium | Phase lock; new ideas go to backlog |
| Data shape divergence between phases | Medium | High | Shared schema doc updated each phase |
| Reporting performance with growth | Low | Medium | Pre-aggregated views; indexes |

---

## 10. Roles and Responsibilities

| Role | Responsibility |
|---|---|
| Admin / Owner | Decisions, scope sign-off, budget |
| Engineering | Implementation, testing, deployment |
| Operations Lead | UAT, training material content |
| Supervisor (warehouse) | Override usage, exception triage |
| Worker | Daily scan flows, feedback to ops |
| QA | Test execution per release |

---

## 11. Communication Cadence

- **Daily standup (15 min):** what shipped, what’s blocked.
- **Per-release demo:** end-to-end run-through with ops team.
- **Weekly status note:** progress vs plan, risks, next milestones.
- **Decision log:** in `docs/BARCODE_SCANNING/DECISION_LOG.md` (created when we begin).

---

## 12. Out of Scope (v1)

These items exist in the long-term vision but are **deferred** to keep v1 deliverable:

- Replenishment zones (bulk → pick face).
- Kits / bundles (BOMs).
- Serial-number-level tracking.
- Offline scan support.
- Hazmat compliance details.
- Native mobile app (web-mobile is the v1 target).

---

## 13. Deliverables Checklist (final v1 sign-off)

- [ ] All phases delivered and accepted.
- [ ] All bins labeled and verified.
- [ ] Cartons fully labeled at receive.
- [ ] Operations team trained for all roles.
- [ ] Reports + dashboard live.
- [ ] Firebase rules tested for all roles.
- [ ] Migration completed for all production warehouses.
- [ ] Decision log + SOP cards published.
- [ ] Soft launch completed; exception trend acceptable.
- [ ] Rollback plan tested and signed off.

---

## 14. Next Action

1. Confirm scope and out-of-scope items.
2. Confirm release ordering.
3. Lock this document.
4. Begin **Phase 1 — Foundation**.

When you say "go", we start implementation.
