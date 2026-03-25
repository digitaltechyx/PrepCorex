# Shopify → PrepCorex webhook checklist

When you change quantity on Shopify, PrepCorex should update automatically. If it doesn’t, check these in order.

## 1. Webhook URL is reachable

- Open in browser: **https://dev.prepservicesfba.com/api/shopify/webhooks**
- You should see: `{"ok":true,"message":"Shopify webhook endpoint..."}`
- If you get **404**, **403**, or **login page** → fix routing or turn off **Vercel Deployment Protection** for production so Shopify can POST to this URL.

## 2. Env vars on Vercel

In Vercel → Project → Settings → Environment Variables, set:

- **NEXT_PUBLIC_APP_URL** = `https://dev.prepservicesfba.com` (you have this)
- **SHOPIFY_CLIENT_SECRET** = your Shopify app’s **Client secret** (from Shopify Partners → Your app → Client credentials).  
  This is used to verify webhook signatures. If it’s wrong or missing, Shopify’s POST will get **401** and PrepCorex won’t update.

Redeploy after changing env vars.

## 3. Firestore index (required)

The webhook looks up inventory by `source`, `shop`, and `shopifyInventoryItemId`. That query needs a composite index.

- Run once (from your project root):  
  **`firebase deploy --only firestore:indexes`**
- Wait until the index is **Enabled** in Firebase Console → Firestore → Indexes (can take a few minutes).
- If you skip this, the webhook will return **500** and your server logs will show an index error.

## 4. Webhook in Shopify

- Shopify Admin → **Settings** → **Notifications** → **Webhooks** → **Create webhook**
- **Event:** Inventory levels update
- **Format:** JSON
- **URL:** `https://dev.prepservicesfba.com/api/shopify/webhooks` (no trailing slash)

## 5. Products linked in PrepCorex

The webhook only updates inventory docs that have:

- `source` = `"shopify"`
- `shop` = your store (e.g. `psf-testing.myshopify.com`)
- `shopifyInventoryItemId` = the Shopify inventory item ID

If you added products before this field existed, **re-save the selection**: go to **Integrations** → **Manage products** for the store → click **Save selection**. That rewrites inventory docs with `shopifyInventoryItemId` and populates the product lookup used for **products/update** and **products/delete** sync.

**Full sync (Shopify → PrepCorex):** The app subscribes to `inventory_levels/update` (quantity), `products/update` (title/name), and `products/delete` (remove from PrepCorex when product is deleted on Shopify). Re-connect the store once to register all three webhooks; re-save product selection once so product lookups exist for update/delete.

## 6. Check server logs

After changing quantity on Shopify, open **Vercel** → your deployment → **Logs**. Look for:

- **`[Shopify webhooks] inventory_levels/update OK`** → PrepCorex was updated.
- **`[Shopify webhooks] inventory_levels/update no lookup doc`** → URL and HMAC are fine; no inventory doc matched (re-save selection or check shop domain).
- **`Invalid signature`** (401) → fix **SHOPIFY_CLIENT_SECRET**.
- **`Update failed`** (500) or index error → deploy Firestore index (step 3).
