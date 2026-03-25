# Use same connect flow as listings (any user can connect)

## Current flow in PrepCorex (already the same as listings)

The app **already uses the standard OAuth flow** that listed/unlisted apps use:

1. User goes to **Dashboard → Integrations** and clicks **Connect Shopify**.
2. User enters their store name (e.g. `mystore`).
3. App redirects to:  
   `https://mystore.myshopify.com/admin/oauth/authorize?client_id=...&scope=...&redirect_uri=...`
4. User approves the app on Shopify.
5. Shopify redirects to:  
   `https://your-psf.com/dashboard/integrations/shopify/callback?code=...&shop=...`
6. Callback calls **POST /api/shopify/exchange-token** with `code` and `shop`.
7. Connection is saved; orders and inventory sync via webhooks.

No code change is required for “same flow as listings.” The only difference is **Shopify Partner Dashboard** settings.

---

## Why “any user” can’t connect today (Custom distribution)

With **Custom distribution**, Shopify only allows installs for stores that you have **added** in the dashboard and for which you **generated an install link**. If a new user enters their store and goes through the flow, Shopify may reject the install because that store is not in your Custom app’s allowed list.

---

## How to enable “same flow as listings” (any user can connect)

You need **Public** distribution so the same OAuth URL works for **any** store.

### Steps (all in Shopify Partner Dashboard)

1. **Register for the App Store (one-time $19)**  
   - In Partners, go to the place where it asks for the App Store registration fee.  
   - Pay the **$19** one-time fee and add a payment method.

2. **Switch to Public distribution**  
   - Open your app → **Distribution**.  
   - Choose **Public distribution** (not Custom).  
   - Choose **Unlisted** (so the app is not searchable in the store but any store can connect via your Connect button).

3. **App setup**  
   - In your app’s **App setup** (or **URLs**), set **Allowed redirection URL(s)** to include:  
     `https://your-psf-domain.com/dashboard/integrations/shopify/callback`  
     (and the same for any other environments, e.g. `https://dev.prepservicesfba.com/...`).

4. **No code changes**  
   - Keep using the same **Connect Shopify** flow in PrepCorex.  
   - After the app is Public (Unlisted), **any** store can connect by entering their store name and approving — no per-store link generation.

---

## Summary

| Item                         | Status |
|-----------------------------|--------|
| PrepCorex connect flow (OAuth)    | Already same as listings |
| Code changes needed         | None   |
| Enable for any user         | Pay $19 + set app to Public (Unlisted) in Partner Dashboard |

Once the app is **Public (Unlisted)** and the redirect URL is allowed, users “simply connect their store” with the existing flow — same as listings.
