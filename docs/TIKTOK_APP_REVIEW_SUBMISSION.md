# PrepCorex TikTok Shop App Review Submission

Prepared: 31 August 2026

## Submission warning

PrepCorex uses **two roles** for TikTok Shop:

| Role | What they can test |
|------|-------------------|
| **Seller client** | OAuth connect, SKU selection, inventory linking, order viewing |
| **Warehouse admin** | Mark shipped + tracking, inventory push (`/admin/dashboard/tiktok-orders`) |

A **client-only** review account can pass connect, products, inventory, and order pull — but **not**
fulfilment write scopes. Because the app requests `seller.fulfillment.*` and
`seller.delivery.status.write`, the lowest-rejection submission should supply **two isolated review
accounts** (client + admin) on a sandbox tenant with sample data only.

Do not submit a normal production administrator account. Either:

1. create isolated client + admin review accounts with sample products/orders and full workflow
   access; or
2. remove permissions and feature claims that cannot be demonstrated during review.

**Do not claim in the form or video:**

- Real-time webhook order sync (webhook URL acknowledges delivery only; events are not processed
  yet).
- Automatic background order sync (orders are pulled on demand when the user clicks Refresh; last
  30 days, up to 50 orders per shop per refresh).
- Creating or editing TikTok product listings (read catalog + inventory update + fulfil only).

## Product testing

### Product website URL

`https://prepcorex.com/dashboard/integrations`

Use the direct feature URL above rather than only the marketing home page. Confirm it redirects an
unauthenticated reviewer to login and returns them to the application after login.

### Product testing account(s)

**Recommended: two accounts** (paste both into Partner Center if the form allows a note, or put
admin credentials in the PRD / video description):

| Account | Example email | Required features |
|---------|---------------|-------------------|
| Seller client | `tiktok-review-client@prepcorex.com` | `integration_tiktok`, `view_tiktok_orders` |
| Warehouse admin | `tiktok-review-admin@prepcorex.com` | `manage_tiktok_orders` (+ admin role) |

Enter passwords directly in Partner Center; do not store them in this document or source control.

Before submission, verify:

- no MFA, CAPTCHA, email verification, invitation acceptance, or password reset blocks login;
- the client account is linked to an isolated review TikTok Shop with sample SKUs;
- at least one sample order exists within the **last 30 days** (prefer `AWAITING_SHIPMENT`);
- OAuth authorization on the review shop stays valid throughout moderation;
- neither account can see real production clients, PII, or unrelated shops;
- webhook URL `https://prepcorex.com/api/tiktok/webhooks` returns `{ ok: true }` on GET (Partner
  Center verification only).

### Step-by-step instructions (paste into the 500-character field)

**Version A — client account only** (457 chars; pair with video showing admin fulfilment):

> 1. Sign in with the supplied client review account at prepcorex.com. 2. Open Dashboard → Integrations → TikTok Shop. 3. Click Connect and authorize the review shop. 4. Click Manage products, search a SKU, select it, Save selection. 5. Open Dashboard → TikTok Shop Orders, click Refresh. 6. Confirm order ID, status, line items, address, and totals. Video shows admin fulfilment and inventory sync.

**Version B — full two-account flow** (use if Partner Center accepts longer notes or attach as PDF
appendix):

> Client: steps 1–6 above. Admin: 7. Sign in with the supplied admin review account. 8. Open Admin → TikTok Shop Orders, select the review client user. 9. Find an AWAITING_SHIPMENT order, enter test tracking TEST123456789, click Mark shipped. 10. Refresh and confirm tracking in PrepCorex and TikTok Seller Center.

## Brief list of product features

Paste this into the 500-character field (485 chars):

> 1. OAuth connect/disconnect for seller-owned TikTok Shop. 2. Read product catalog and SKUs; seller selects SKUs to link PrepCorex inventory. 3. Read SKU stock; push approved warehouse quantity to TikTok warehouse. 4. On-demand order pull (30 days): status, buyer, address, items, totals, tracking. 5. Admin marks shipped with carrier/tracking to TikTok. Scope: TikTok Shop sellers using external PrepCorex fulfilment. No listing creation; webhook URL for verification only.

## Screenshot plan

Upload clear PNG or JPEG files in the same order as the feature list. Crop unrelated browser UI,
but retain the PrepCorex page title and enough context to prove the feature is part of the product.
Never show real customer personal data, access tokens, app secrets, or production credentials.

1. `01-tiktok-integration-card.png`
   - PrepCorex Integrations page.
   - TikTok Shop card and Connect button visible.
2. `02-tiktok-oauth-consent.png`
   - TikTok authorization page showing PrepCorex and the requested access.
   - Use only the review shop.
3. `03-tiktok-shop-connected.png`
   - Connected shop name and connection status in PrepCorex.
4. `04-tiktok-product-selection.png`
   - Product list with title, SKU, quantity, checkbox, search, and Save selection.
5. `05-tiktok-linked-inventory.png`
   - Selected TikTok SKU visible in PrepCorex inventory with its source identified.
6. `06-tiktok-orders.png`
   - Client page `/dashboard/tiktok-orders` with Refresh and sample order (mask PII if needed).
7. `07-tiktok-order-details.png`
   - Expanded order: line items, qty, amount, delivery, tracking fields.
8. `08-admin-tiktok-fulfil.png`
   - Admin page `/admin/dashboard/tiktok-orders` with review client selected, tracking input,
     Mark shipped button.
9. `09-tiktok-updated-status.png`
   - TikTok Seller Center or refreshed PrepCorex order showing tracking after ship.

## Product video script

Target length: 2–4 minutes. Record at 1080p with readable text. Use one continuous recording where
possible and narrate what each requested permission enables.

### 0:00–0:15 — Identity and purpose

Show the PrepCorex login and Integrations page.

Narration:

> PrepCorex is an order and warehouse management platform for fulfilment providers and their
> seller clients. This demonstration shows how a seller connects TikTok Shop, chooses the SKUs
> handled by PrepCorex, views orders, synchronizes inventory, and sends fulfilment tracking.

### 0:15–0:45 — OAuth authorization

Click Connect TikTok Shop, show the TikTok consent screen, authorize the review shop, and show the
successful return to PrepCorex.

Narration:

> The seller explicitly authorizes their own TikTok Shop. PrepCorex stores the connection for that
> signed-in client and supports disconnection. Authorization information is used to identify the
> connected shop and refresh access when required.

### 0:45–1:20 — Products and SKU selection

Open Manage products, search a SKU, select it, and save.

Narration:

> PrepCorex reads product and SKU information so the seller can choose exactly which listings the
> warehouse will track. Saving the selection links those SKUs to PrepCorex inventory; it does not
> create or take ownership of the seller's listing.

### 1:20–1:45 — Inventory synchronization

Show the linked inventory quantity and perform a test quantity update in the isolated review
environment. Show the matching quantity in TikTok Shop.

Narration:

> Product write and logistics access are used to send an approved available quantity to the
> selected TikTok SKU and TikTok warehouse. The update is initiated from the authorized
> fulfilment workflow.

### 1:45–2:20 — Order retrieval (client)

Open **Dashboard → TikTok Shop Orders** (`/dashboard/tiktok-orders`), click Refresh, open a sample
order.

Narration:

> Order access pulls the last 30 days of orders on demand when the seller refreshes. PrepCorex shows
> status, recipient, line items, totals, delivery, and tracking. Orders are not auto-synced via
> webhook in this release.

### 2:20–3:00 — Fulfilment and tracking (admin)

Sign in as the **admin review account**. Open **Admin → TikTok Shop Orders**
(`/admin/dashboard/tiktok-orders`), select the review client, enter test tracking, click Mark
shipped, refresh, and show TikTok Seller Center.

Narration:

> Fulfilment and delivery write permissions are used only by authorized warehouse admins to send
> carrier and tracking after dispatch. Client users can view orders but cannot mark shipped.

### 3:00–3:15 — Disconnect

Return to Integrations and point out Disconnect. Do not disconnect before moderation unless the
review account can immediately reconnect.

## Product Requirements and Design Document

### 1. Product overview

PrepCorex is a multi-role order management and warehouse management platform for prep centres,
third-party logistics providers, warehouse operators, and seller clients. The TikTok Shop
integration brings seller-authorized product, inventory, order, logistics, and fulfilment data into
the warehouse workflow.

### 2. Problem

TikTok Shop sellers using an external fulfilment warehouse otherwise need to manually copy SKU,
stock, order, and tracking information between systems. This increases fulfilment delays, stock
inconsistency, and tracking errors.

### 3. Users and roles

- **Seller client:** authorizes their TikTok Shop, selects SKUs, views imported orders and inventory.
- **Warehouse administrator/operator:** processes approved warehouse work and sends dispatch
  tracking through the seller's authorized connection.
- **TikTok reviewer:** validates the end-to-end integration in an isolated environment using sample
  data.

### 4. Core use cases

1. Connect a seller-owned TikTok Shop using OAuth.
2. Retrieve shop identity and maintain authorized access.
3. Retrieve products, SKU identifiers, images, status, and available quantity.
4. Let the seller select only SKUs handled by PrepCorex.
5. Link selected SKUs to PrepCorex inventory.
6. Send an approved SKU inventory quantity to the relevant TikTok warehouse.
7. On demand, retrieve orders from the last 30 days and show fulfilment-relevant details.
8. Authorized admin creates/locates a fulfilment package and sends carrier/tracking after dispatch.
9. Disconnect the shop and remove its linked PrepCorex inventory when requested.
10. Webhook endpoint registered for Partner Center delivery verification (event processing planned).

### 5. User flow

1. An authenticated seller opens **Dashboard → Integrations**.
2. The seller clicks **Connect** on TikTok Shop.
3. PrepCorex redirects the seller to TikTok's authorization page.
4. TikTok redirects to PrepCorex's registered callback after consent.
5. PrepCorex exchanges the authorization code and stores the connection under that client.
6. The seller opens **Manage products**, searches/selects SKUs, and saves the selection.
7. PrepCorex links those SKUs to the client's inventory.
8. The seller opens **TikTok Shop Orders** and clicks Refresh to pull live order data.
9. An authorized admin opens **Admin → TikTok Shop Orders**, selects the client, and marks an order
   shipped with tracking (or inventory is pushed after warehouse dispatch).

### 6. Requested access and purpose

- `seller.authorization.info`: identify the authorized shop and connection.
- `seller.product.basic`: retrieve products, SKUs, images, status, and stock information.
- `seller.product.write`: update available inventory for a selected TikTok SKU.
- `seller.order.info`: retrieve orders and fulfilment-relevant order details.
- `seller.logistics`: retrieve TikTok warehouses and shipping providers.
- `seller.fulfillment.basic`: retrieve package and fulfilment information.
- `seller.fulfillment.package.write`: create/update package and tracking information.
- `seller.delivery.status.write`: report shipment/delivery status where required by the fulfilment
  flow.

Every requested permission must be visible in the submitted video. Remove any permission that is
not used in the production workflow or cannot be demonstrated.

### 7. Data handling and security

- PrepCorex requires its own authenticated user session before initiating or using a TikTok
  connection.
- Connections are stored per PrepCorex client rather than globally.
- Server API routes verify the signed-in user's token before accessing connection data.
- Cross-client writes are restricted to authorized administrative workflows.
- App secrets and access tokens are server-side and are not exposed in screenshots or browser UI.
- Data is used only for the seller-authorized warehouse and fulfilment workflow.
- Privacy information: `https://prepcorex.com/api/platform-documents/privacy/pdf`
- Terms: `https://prepcorex.com/api/platform-documents/terms/pdf`

### 8. Acceptance criteria

- OAuth completes and returns the seller to PrepCorex.
- Connected shop identity appears on Integrations.
- Products/SKUs load and a selection can be saved.
- Selected SKUs appear in PrepCorex inventory.
- A test inventory update reaches the correct TikTok SKU and warehouse.
- Orders load with correct line items and status.
- A test dispatch sends valid carrier/tracking and TikTok reflects the update.
- Disconnect removes access without affecting another client's connection.
- Reviewer steps work from a clean browser using the supplied credentials.

## Final pre-submission checklist

- [ ] Redirect URL exactly matches
  `https://prepcorex.com/dashboard/integrations/tiktok/callback`.
- [ ] The product URL and review credentials work in an incognito browser.
- [ ] The reviewer account is isolated from production data.
- [ ] Review shop authorization will not expire during moderation.
- [ ] Sample products include at least one searchable SKU and stock quantity.
- [ ] At least one sample order exists within the last 30 days.
- [ ] Admin review account can reach `/admin/dashboard/tiktok-orders` and fulfil a test order.
- [ ] All requested permissions are demonstrated and narrated in the video.
- [ ] Form does not claim webhook-driven or automatic order sync.
- [ ] Screenshots follow the same order as the feature list.
- [ ] Video text is readable and contains no secrets or real personal data.
- [ ] Privacy and Terms URLs load without login.
- [ ] No feature is described as automatic if it requires a user/admin action.
- [ ] The uploaded PRD matches the form, screenshots, video, and actual application.

