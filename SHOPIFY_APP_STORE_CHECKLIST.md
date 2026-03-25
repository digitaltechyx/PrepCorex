# Shopify App Store – pass “Provides mandatory compliance webhooks” and “Verifies webhooks with HMAC”

If automated checks fail with:
- **Provides mandatory compliance webhooks**
- **Verifies webhooks with HMAC signatures**

do the following.

---

## Review requirements – does PrepCorex meet them?

| Requirement | Status | Notes |
|-------------|--------|--------|
| **Authenticate immediately after install** | Met | OAuth in callback; code exchanged for token in `exchange-token`; user redirected to app UI. |
| **Redirect to the app UI after installation** | Met | Callback redirects to `/dashboard/integrations` after success. |
| **Use Shopify APIs** | Met | Orders, products, inventory, fulfillments, webhooks; compliance + HMAC in `webhooks/route.ts`. |
| **Use a valid TLS/SSL certificate** | Verify | Ensure `https://dev.prepservicesfba.com` has valid cert in production. |
| **Build apps without even minor errors** | Addressed | Compliance + HMAC fixed; fix any remaining errors before submit. |
| **Synchronize data accurately** | Verify | Confirm order/inventory sync behavior in production. |
| **Duplicate only authorized product information** | Met | Scopes limited to read/write products, inventory, orders, etc. |
| **Request read_all_orders only if necessary** | Met | App uses `read_orders`, not `read_all_orders`. |
| **Use session tokens for authentication** | N/A | Firebase + Bearer; `embedded = false`, so session tokens not required. |
| **Include functional test credentials** | **Action** | Provide test store/login in Partner Dashboard for reviewers. |
| **Connector: End recipient acknowledgement form** | **Action** | Complete and upload if Partners requires it. |
| **Connector: Must not connect to third party marketplace** | Met | Connects to PrepCorex backend only. |
| **Connector: Indicate integrations and data transfers** | **Action** | In listing: what you connect to, what data is synced, where it goes. |
| **App Store listing: Test credentials, demo screencast, pricing, icon, tags** | **Action** | Add in Dashboard: test credentials, demo video, pricing, icon, tags. |
| **Use Shopify Managed Pricing or Billing API** | N/A | No in-app Shopify billing; N/A if free or you charge outside Shopify. |

---

## 1. Mandatory compliance webhooks

Shopify must know your app’s webhook URL for the three **mandatory** topics:

- `customers/data_request`
- `customers/redact`
- `shop/redact`

### Option A: App config (recommended)

1. In the project root, open **`shopify.app.toml`**.
2. Set **`uri`** under `[[webhooks.subscriptions]]` to your **live** app URL (HTTPS, no trailing slash), e.g.:
   - `https://dev.prepservicesfba.com/api/shopify/webhooks`
   - or your production domain.
3. Deploy the app config so Shopify sees it:
   - If you use Shopify CLI: run **`shopify app deploy`** from the project root.
   - Otherwise use Option B below.

### Option B: Partner Dashboard

1. Go to [Shopify Partners](https://partners.shopify.com) → **Apps** → your app.
2. Open **Configuration** (or **App setup**) → **Event subscriptions** (or **Webhooks**).
3. Add an **HTTPS** subscription for:
   - **URL:** `https://YOUR_DOMAIN/api/shopify/webhooks` (same as in your app).
   - **Topics:** ensure the three compliance topics are subscribed:
     - `customers/data_request`
     - `customers/redact`
     - `shop/redact`

Save so Shopify’s systems register these endpoints.

---

## 2. Verifies webhooks with HMAC

The app **must**:

- Use the **raw request body** (before any JSON parsing) for verification.
- Compute **HMAC-SHA256** of that raw body with your app’s **Client secret**.
- Compare the result to the **`X-Shopify-Hmac-Sha256`** header (e.g. with a timing-safe compare).
- Return **401** if the signature is missing or invalid, and **200** only when valid.

This is already implemented in **`src/app/api/shopify/webhooks/route.ts`**:

- Raw body: `request.arrayBuffer()`.
- HMAC: `createHmac("sha256", SHOPIFY_CLIENT_SECRET).update(rawBytes).digest("base64")`.
- Comparison: `timingSafeEqual` with the header value.
- Invalid/missing HMAC → **401**; valid and compliance webhooks → **200**.

Ensure in production:

- **`SHOPIFY_CLIENT_SECRET`** is set (e.g. in Vercel env) to your app’s **Client secret** from Partners → your app → **Client credentials**.
- The webhook URL is **HTTPS** and **publicly reachable** (no login in front of `/api/shopify/webhooks`).
- **Vercel Deployment Protection** (or similar) is **off** for this path so Shopify can POST to it.

---

## 3. Quick verification

1. **GET**  
   Open in a browser:  
   `https://YOUR_DOMAIN/api/shopify/webhooks`  
   You should get a JSON response (e.g. `ok: true` and a message). No 404/403/login.

2. **POST (compliance)**  
   Shopify will send POSTs for compliance topics. After fixing the above, run the automated checks again; they should pass if:
   - The compliance webhook URL is registered (via toml or dashboard), and
   - The endpoint returns 200 for valid HMAC and 401 for invalid.

---

## 4. If checks still fail

- Confirm the **exact** URL in `shopify.app.toml` or in Event subscriptions matches the app URL Shopify uses (no trailing slash, correct domain).
- Confirm **SHOPIFY_CLIENT_SECRET** in production matches the app’s **Client secret** in Partners (no extra spaces, correct app).
- Re-run the automated check after any change; allow a few minutes for config to propagate.
