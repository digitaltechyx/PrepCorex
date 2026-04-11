# Release Notes - February & March 2026

## Release Window
- February 2026 to March 2026

## Executive Summary
- This release focused on admin and user dashboard UX improvements, tighter list density, and better workflow routing from KPI cards.
- Key outcomes:
  - Admin sidebar/navigation restructuring
  - Notifications deep-link filtering from dashboard cards
  - Compact list views across high-traffic pages
  - Date range filtering added to user log pages
  - Affiliate commission logic updated from 10% to 5%
  - Affiliate and onboarding copy refinements

## Scope By Month

### February 2026
- User invoices UX improvements:
  - Added clickable invoice stat cards for `Paid` and `Pending`.
  - Improved tab switching behavior and smooth-scroll handoff to invoice sections.
- Admin invoices management updates:
  - Introduced/refined tabbed management flow (`All`, `Unpaid`, `Paid`).
  - Improved invoice loading responsiveness.
  - Improved reliability of `Mark as Paid` actions.
- Restock Summary search enhancement:
  - Search behavior in Restock Summary was updated and released.
  - Previously pushed commit reference: `1dde071` on `main`.

### March 2026

#### 1) Admin Navigation and Access Flow
- Reordered admin sidebar menu to match requested operational sequence.
- Added `Buy Labels` tab on admin side with route:
  - `/admin/dashboard/buy-labels`
- Added `Roles & Permissions` back after `Users` in admin navigation (admin-only visibility).
- Renamed/adjusted menu labels for consistency:
  - `Inventory Management` -> `Inventory`
  - `Dispose Requests` -> `Dispose Inventory`
  - `Pricing` -> `Pricing Tariff`
  - `Buy Label` -> `Buy Labels`
  - Added `Integration` entry

#### 2) KPI Card Routing Fixes (Admin Dashboard)
- Pending invoices card now lands on invoices with unpaid/pending context correctly applied.
- `Today Shipped Orders` now deep-links to Notifications with pre-applied filters:
  - `type=shipment_request`
  - `user=all`
  - `period=today`
- `Today Received Inventory` now deep-links to Notifications with pre-applied filters:
  - `type=inventory_request`
  - `user=all`
  - `period=today`

#### 3) Admin Notifications Enhancements
- Added period presets:
  - `Today`, `This Week`, `This Month`, `This Year`, `All Time`
- Added query-parameter-based filter hydration:
  - `type`, `user` / `userId`, `period`
- Preserved compatibility with existing `tab` behavior.

#### 4) Compact List View Conversions
- Admin side:
  - Current Inventory converted from card grid to compact list rows.
  - Users management converted from card grid to compact list rows (pending/approved/deleted).
- User side:
  - Disposed Inventory request entries converted to compact list rows.
  - Modification Logs converted to compact list rows.
  - Deleted Logs converted to compact list rows.
  - Restock Summary converted to compact list rows.

#### 5) Date Range Filtering Added (User Pages)
- Added `DateRangePicker` (from/to) to:
  - Modification Logs
  - Deleted Logs
  - Restock Summary
- Date range works alongside existing quick date filters and pagination resets on change.

#### 6) Affiliate Commission and Copy Updates
- Commission calculation logic changed from 10% to 5%:
  - `commissionAmount = invoice.grandTotal * 0.05`
- Affiliate onboarding text updated from:
  - `10–15%` -> `5–10%`

#### 7) Login Copy Update
- Updated onboarding prompt to:
  - `New here? Complete onboarding to create your account.`

## Impact Assessment

### User Experience
- Faster scanning and lower visual noise on logs and inventory/member lists.
- Less clicking and manual filtering due to KPI deep-link behavior.

### Operational Efficiency
- Admin workflows are more direct (notifications context and compact rows).
- Improved discoverability of admin features in navigation.
- February invoice and restock updates reduced clicks for daily operations and improved settlement handling speed.

### Business Logic
- Affiliate payout logic now uses 5% in code.
- Existing display labels mentioning commission percentages may require additional harmonization if full consistency is desired.

## Testing / QA Checklist
- [ ] Verify admin sidebar order and labels on desktop/mobile.
- [ ] Verify `Buy Labels` and `Roles & Permissions` visibility rules by role.
- [ ] Validate KPI deep-links from admin dashboard:
  - [ ] Today Shipped Orders
  - [ ] Today Received Inventory
  - [ ] Pending Invoices
- [ ] Validate Notifications filters from URL params (`type`, `user`, `period`).
- [ ] Validate compact list rendering and pagination on:
  - [ ] Admin Inventory
  - [ ] Admin Users
  - [ ] User Disposed Inventory
  - [ ] User Modification Logs
  - [ ] User Deleted Logs
  - [ ] User Restock Summary
- [ ] Validate date range filter behavior on logs pages with empty/non-empty states.
- [ ] Validate affiliate commission creation on paid invoice (5% expected).

## Rollback Notes
- UI/navigation and filtering changes can be rolled back by reverting affected frontend pages/components.
- Commission logic rollback path:
  - Revert `src/lib/commission-utils.ts` from `0.05` back to previous rate if needed.

## File Created
- `RELEASE_NOTES_FEB_MAR_2026.md`

