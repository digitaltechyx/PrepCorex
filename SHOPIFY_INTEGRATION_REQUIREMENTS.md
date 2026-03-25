# PrepCorex – Shopify Integration

## Document purpose
This document describes the **requirements** and **planned build** for connecting user Shopify stores to PrepCorex: sync orders and store data, and let admins process Shopify orders with the **same options as Shopify** (Create label / Mark as fulfilled), while manual shipment requests keep working as today.

---

## 1. Requirements

### 1.1 Business goal
- **Users (clients)** can connect **one or more** Shopify stores (and in future, other accounts) to PrepCorex.
- Once connected, **PrepCorex automatically receives** orders (and optionally products) from **each of that user's connected stores**.
- **Admins** process **Shopify-synced orders** the same way they would on Shopify: **Create label** or **Mark as fulfilled**, with updates pushed back to the **correct** user's Shopify store.
- **Manual shipment requests** (non-Shopify) continue to work **exactly as they do today** — separate workflow, no change.

### 1.2 Two separate order workflows

| Order source | Workflow | Behavior |
|--------------|----------|----------|
| **Shopify (synced)** | Shopify-style | Admin gets two options: **Create label** (label purchased from that user's account, works like Shopify) and **Mark as fulfilled**. Both actions **update the order/fulfillment on the user's Shopify store**. |
| **Manual (current)** | Existing PrepCorex flow | Works as it works today. No change to current shipment request flow. |

### 1.3 Functional requirements – Shopify orders

| # | Requirement | Description |
|---|-------------|-------------|
| FR1 | Connect multiple stores | Every user can connect **multiple** Shopify stores (and later other platforms). Each connection is stored separately; user can add more or disconnect any one. |
| FR2 | Sync orders | Orders from **each** of the user's connected Shopify stores sync into PrepCorex and are clearly identifiable as "from Shopify" and which store (shop domain/name). |
| FR3 | Admin: Create label (Shopify orders only) | For orders synced from Shopify, admin can click **Create label**. A shipping label is **purchased** (using that user's Shopify/carrier setup, same as Shopify). Label purchase and fulfillment are sent back to Shopify so the store shows the order as fulfilled with tracking. |
| FR4 | Admin: Mark as fulfilled (Shopify orders only) | For orders synced from Shopify, admin can click **Mark as fulfilled**. The order is marked fulfilled in PrepCorex and the fulfillment status is **updated on the correct user's Shopify store** (the store that order came from) so it matches Shopify's "Mark as fulfilled" behavior. |
| FR5 | Manual orders unchanged | Manual shipment requests and their processing stay exactly as they are today. Separate workflow from Shopify orders. |
| FR6 | Data from store | PrepCorex gets orders (and optionally products) from **each** connected store; each order is tagged with **which store** it came from so we can push fulfillment back to the right store. |

### 1.4 Non-functional requirements

| # | Requirement |
|---|-------------|
| NFR1 | Store **each** Shopify connection per user securely (multiple stores = multiple tokens/records, e.g. one per connected store). |
| NFR2 | Sync runs without the user being logged in. |
| NFR3 | Only use and request Shopify data/permissions (scopes) that we need; request write scope for fulfillments where we update Shopify. |

---

## 2. What we will build

### 2.1 User-facing (dashboard)
- **Integrations / Connected accounts** – Page where user sees **all** connected accounts and can add more or disconnect.
- **Multiple connections** – User can connect **more than one** Shopify store. UI shows a **list** of connected Shopify stores (store name/domain, "Disconnect" per row) plus a button **"Connect another Shopify store"** (or "Add Shopify store").
- **Connect Shopify** – Button starts OAuth; callback saves **new** connection (new store) for that user without removing existing ones.
- **Connection status** – For each connected store: show store name/domain, optional last synced, **Disconnect** button. Same pattern can be used later for other platforms (e.g. Amazon).

### 2.2 Backend / data
- **Token storage** – Per user, **multiple** Shopify connections: e.g. subcollection `users/{userId}/shopifyConnections` where each document = one connected store (fields: shop domain, access token, store name, connectedAt, etc.). One user can have many documents (one per store).
- **OAuth flow** – Exchange code for token; create a **new** connection document for that user (append to their list). Do not overwrite existing connections.
- **Sync: Orders** – For **each** connection of **each** user, fetch orders from that store and save in PrepCorex with **source = Shopify**, **shop domain / connection ID**, and **Shopify order ID** so we know which store to update when fulfilling.
- **Sync: Products** (optional) – Fetch catalog per store if needed.

### 2.3 Admin-facing – Shopify orders only

| Feature | Description |
|---------|-------------|
| **Identify Shopify orders** | Orders synced from Shopify are clearly marked (e.g. badge "Shopify", filter by source). |
| **Create label** | Button only for Shopify orders. Calls Shopify (or carrier via Shopify) to **purchase a shipping label** for that order (using the user's store/carrier settings). Creates fulfillment on Shopify with tracking so the store updates like when you "Create label" in Shopify admin. |
| **Mark as fulfilled** | Button only for Shopify orders. Marks the order as fulfilled in PrepCorex and **updates the fulfillment on the user's Shopify store** via API so the store shows it as fulfilled (same as "Mark as fulfilled" in Shopify). |
| **Manual orders** | No change. Current shipment request flow and processing remain separate and unchanged. |

### 2.4 Shopify app configuration
- **Scopes** – Read: `read_orders`, `read_products` (optional: `read_inventory`). **Write**: we need to be able to create fulfillments and (if we purchase labels via Shopify) use carrier/label APIs — typically `write_fulfillments` and possibly merchant/carrier permissions as per Shopify docs.
- **App URL**, **Redirect URL(s)** – As configured in the app.
- **Environment variables** – e.g. `NEXT_PUBLIC_SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`.

---

## 3. High-level flow

1. **User** connects one or more Shopify stores (OAuth each time); we store **each** as a separate connection (shop + token) for that user.
2. **Sync** fetches orders from **each** of the user's connected stores; we save them with source = Shopify, **shop/connection ID**, and Shopify order ID.
3. **Admin** sees orders; **manual** orders use current workflow; **Shopify** orders show **Create label** and **Mark as fulfilled**.
4. **Create label** – We use the **correct** connection (the store that order came from) to call Shopify, purchase label, create fulfillment with tracking, and update that store.
5. **Mark as fulfilled** – We use the **correct** connection to call Shopify API and mark fulfillment on that store.
6. **Manual** shipment requests continue to be processed with the existing flow only.

---

## 4. Data we get from Shopify (per connected store)

- **Orders** – order ID, line items, shipping address, status, etc. (and we push back fulfillments + tracking).
- **Products** (optional) – for catalog.
- **Fulfillments** – we **create/update** via API when admin clicks Create label or Mark as fulfilled.

---

## 5. Scopes to request (Shopify app)

- **read_orders** – sync orders.
- **read_products** – sync products (optional).
- **read_inventory** – read inventory levels (for product selection and sync).
- **read_locations** – required to get store location ID so we can call `inventory_levels/set` (PrepCorex → Shopify sync).
- **write_inventory** – set inventory on Shopify when PrepCorex updates (dispose, edit, restock, ship, delete). Required for two-way inventory sync; users must re-authorize after adding.
- **write_products** – update product title on Shopify when admin edits product name in PrepCorex (optional; re-connect after adding).
- **write_fulfillments** (or equivalent) – create fulfillments and update fulfillment status on Shopify when admin clicks **Mark as fulfilled** or completes **Create label**.

(Exact scope names may vary by Shopify API version; we'll confirm when implementing. Label purchase may require additional carrier/fulfillment permissions.)

### 5.1 Two-way inventory sync (Shopify ↔ PrepCorex)

- **PrepCorex → Shopify:** When admin performs dispose, edit quantity, restock, delete, recycle, or confirm shipment on a Shopify-synced item, the app calls Shopify’s `inventory_levels/set` API so the store’s inventory updates in real time. When admin edits the **product name** in PrepCorex, the product title is updated on Shopify (requires `write_products` scope). When admin **deletes** an item from PrepCorex, the app sets that variant's quantity to 0 on Shopify; the product is **not** removed from the Shopify store.
- **Shopify → PrepCorex:** When a store is connected (OAuth callback), the app automatically registers an `inventory_levels/update` webhook so changes on Shopify update PrepCorex without re-selecting products.
  - **Webhook URL:** `{NEXT_PUBLIC_APP_URL}/api/shopify/webhooks` (or `https://{VERCEL_URL}/...` if only Vercel is set).
  - **Topic:** `inventory_levels/update`
  - **Required:** Set `NEXT_PUBLIC_APP_URL` (e.g. `https://dev.prepservicesfba.com`) or deploy on Vercel so `VERCEL_URL` is set; otherwise the webhook is not registered.
  - Verification uses `X-Shopify-Hmac-Sha256` with `SHOPIFY_CLIENT_SECRET`.
  - On receive, PrepCorex updates the matching inventory doc(s) (by `shopifyInventoryItemId` and shop) with the new `available` quantity.
  - If the store was connected before this feature, disconnect and reconnect the store once (with the env var set) to register the webhook.

**If Shopify → PrepCorex still doesn’t update:**

1. **Production URL** – `NEXT_PUBLIC_APP_URL` must be set in the **deployment** environment (e.g. Vercel → Project → Settings → Environment Variables), not only in `.env.local`. Use your live app URL (e.g. `https://dev.prepservicesfba.com`). The webhook URL must be reachable by Shopify (no localhost, no password-protected preview).
2. **Reconnect on production** – Open your **deployed** app (not localhost), go to Integrations, disconnect the store, then connect again. That registers the webhook with the production URL.
3. **Firestore index** – Deploy the index so the webhook can find inventory docs: run `firebase deploy --only firestore:indexes` (uses `firestore.indexes.json`). If the index is missing, server logs will show an error when the webhook runs.
4. **Check Shopify** – In Shopify admin: Settings → Notifications → Webhooks. Confirm there is an `inventory_levels/update` subscription pointing to `https://your-domain.com/api/shopify/webhooks`. If it’s missing, reconnect the store from the deployed app.
5. **Server logs** – When you change quantity on Shopify, check your app’s server logs (e.g. Vercel → Deployments → Logs). You should see `[Shopify webhooks] inventory_levels/update OK` on success, or `[Shopify webhooks] inventory_levels/update no lookup doc` if the product isn’t linked (re-save product selection).

---

## 6. Out of scope (for this phase)

- Amazon integration.
- Changing the current manual shipment request workflow.

---

*Document version: 1.2*  
*Last updated: 2025*  
*Added: Multiple stores per user – user can connect more than one Shopify store; list of connected accounts; each order tagged with which store; fulfillments pushed to the correct store.*
