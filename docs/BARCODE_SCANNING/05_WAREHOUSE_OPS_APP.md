# Warehouse Ops App (Path B)

Status: **Locked decisions (implementation started)**

| Decision | Choice |
|----------|--------|
| Ops URL | **`/warehouse-ops`** |
| Warehouse assignment | **Admin assigns / changes** `assignedWarehouseIds` per ops user |
| Floor supervisor | Role **`warehouse_operator`** + feature **`ops_supervisor`** |
| Office control | **Super admin** full access; **sub_admin** features chosen by super admin (unchanged) |
Owner: Operations + Engineering
Prerequisites: Phase 1 (bins), Phase 2 (cartons/pallets/labels)

---

## 1. Why a separate app

Floor staff should not use the client dashboard or the full admin dashboard. They need:

- A **dedicated URL** (bookmark on scanners / tablets)
- **Large, scan-first UI** (Receiving, Putaway, Pick, …)
- **Accounts created by admin** with granular permissions
- **No access** to billing, client management, Shopify, etc. unless explicitly granted

Admin keeps **full control** via Roles & Permissions (same pattern as sub-admin features today).

---

## 2. URL and routing

| App | Base URL | Who |
|-----|----------|-----|
| Client | `/dashboard` | `user` (clients) |
| Admin | `/admin/dashboard` | `admin`, `sub_admin` (office) |
| **Warehouse Ops** | **`/warehouse-ops`** | `warehouse_operator` (+ supervisors) |

After login, redirect by role:

- `warehouse_operator` (no admin/sub_admin) → `/warehouse-ops`
- `admin` / `sub_admin` → `/admin/dashboard` (unless they also have ops features → optional link to `/ops`)
- `user` → `/dashboard`

Ops layout: minimal sidebar or bottom nav — **Receiving** (default), **Putaway**, **Move** (later), **Pick** (later), **Profile/Sign out**.

**Not in Ops app:** Warehouses setup, bin generator, invoice, users list (unless `ops_manage_team` for lead).

---

## 3. New role: `warehouse_operator`

Add to `UserRole`:

```ts
"warehouse_operator"
```

- Created by admin (same flow as Create User / Roles & Permissions).
- Status: `approved` on create (no client MSA).
- **No** client dashboard features by default.
- Scoped by **`assignedWarehouseIds`** (and/or `managedLocationIds` linked to warehouse `linkedLocationId`).

Optional second ops role later: `warehouse_supervisor` (same app, more features). For v1, use **features** on `warehouse_operator` instead of a second role.

---

## 4. Ops features (admin-granted)

New `UserFeature` values — toggled in **Admin → Roles & Permissions** and **Create User** (Ops section):

| Feature | Ops menu | Description |
|---------|----------|-------------|
| `ops_dashboard` | Home | Land on ops home; required for any ops access |
| `ops_receive` | Receiving | ASN / request / walk-in / mixed / damaged (Phase 3) |
| `ops_putaway` | Putaway | Scan carton → bin (Phase 4) |
| `ops_move` | Internal move | Bin-to-bin (Phase 4+) |
| `ops_pick` | Pick | Order picking (Release 2 outbound) |
| `ops_pack` | Pack | Pack & verify (later) |
| `ops_count` | Cycle count | Spot / ABC count (Release 3) |
| `ops_supervisor` | Overrides | Approve lot/expiry blocks, damaged, quarantine |
| `ops_view_expected_inbound` | Receiving queue | See client inventory requests as expected lines |
| `manage_warehouses` | — | **Admin only** — bin/area setup (stays `/admin/.../warehouses`) |

**Bundles (presets for admin UI):**

- **Receiver:** `ops_dashboard`, `ops_receive`, `ops_view_expected_inbound`
- **Putaway:** `ops_dashboard`, `ops_putaway`, `ops_move`
- **Picker:** `ops_dashboard`, `ops_pick`
- **Floor lead:** all `ops_*` except `manage_warehouses`
- **Supervisor:** floor lead + `ops_supervisor`

Admin **super admin** always has all features (existing `hasFeature` behavior).

---

## 5. Admin: creating and controlling ops accounts

### 5.1 Create User form

- Add role option: **Warehouse Operator**.
- When selected:
  - Show **Ops features** checklist (table above).
  - Show **Assigned warehouse(s)** multi-select (from `warehouses` collection).
  - Hide client features and admin features unless also sub_admin (rare).

### 5.2 Roles & Permissions page

- New section: **Warehouse Ops features** (same toggles as create user).
- Display role `warehouse_operator` in role definitions table.

### 5.3 Office workflow (unchanged + link)

- **Inventory Requests** stays under admin (`manage_inventory_admin` / notifications).
- Approving a request = **expected inbound**; does not post final stock.
- Ops **Receiving** lists pending expected lines per client/SKU (feature `ops_view_expected_inbound`).

---

## 6. Ops screens (build order)

### Phase 3 — Receiving (`/warehouse-ops/receiving`)

1. Select warehouse (from `assignedWarehouseIds`).
2. Choose scenario: **From client request** | Walk-in | Mixed pallet | Damaged.
3. Per carton loop: SKU, lot, expiry, qty → create carton → **print label** → status `receiving`.
4. Link to `users/{clientId}/inventoryRequests/{id}` when from request.

### Phase 4 — Putaway (`/warehouse-ops/putaway`)

1. Scan carton QR → scan bin QR → validate storage area → commit `binId`, status `available`.

### Later

- `/ops/pick`, `/ops/pack`, `/ops/count`, `/ops/transfer`

---

## 7. Auth and security

- Middleware / layout guard: `/ops/*` requires `hasRole(warehouse_operator)` OR admin OR (`sub_admin` + any `ops_*` feature).
- Firestore rules: ops users `signedIn()` + role/feature check for `warehouses/{id}/cartons` write (or keep admin write + ops via same rules with custom claims later).
- Audit: every scan writes `warehouseMovements` or `cartonEvents` with `userId`, `warehouseId`, `eventType`.

---

## 8. What stays where

| Function | Location |
|----------|----------|
| Warehouse layout, bin labels | Admin → Warehouses |
| Test carton print (UAT) | Admin → Warehouses → Cartons (optional remove later) |
| Client inventory requests | Admin → per client / notifications |
| **Receiving / putaway / pick** | **Ops → `/ops`** |
| Reports & exceptions | Admin (later); supervisor overrides in Ops |

---

## 9. Implementation checklist (engineering)

- [ ] `UserRole`: add `warehouse_operator`
- [ ] `UserFeature`: add `ops_*` list
- [ ] `roles-permissions-config.ts`, create-user-form, role-feature-management
- [ ] `permissions.ts` defaults for `warehouse_operator`
- [ ] App route group `src/app/ops/` + layout + sidebar
- [ ] Login redirect in auth provider
- [ ] `assignedWarehouseIds` on user profile + admin UI
- [ ] Phase 3 Receiving page under `/ops/receiving`

---

## 10. Locked (no longer open)

1. URL: `/warehouse-ops`
2. Warehouses: admin assigns via `assignedWarehouseIds` (create user + roles & permissions)
3. Supervisors: `warehouse_operator` + `ops_supervisor` feature
4. Super admin: all access; sub_admin: office modules only as granted by super admin
