# How to create an order on a Shopify dev store (so it shows in PrepCorex)

Orders in PrepCorex come from Shopify **orders/create** and **orders/updated** webhooks. The order must be a **real order** (not a draft), and the store must be connected from the same app URL that receives webhooks.

## 1. Create an order in Shopify (dev store)

Use one of these; both trigger **orders/create**:

### Option A: Create order from Admin (easiest)

1. In Shopify Admin go to **Orders**.
2. Click **Create order**.
3. Add a customer (or “Guest”) and add at least one product.
4. Set shipping address.
5. Under **Payment**, choose **Mark as paid** (or use a test payment if configured).
6. Click **Create order**.

### Option B: Checkout on the storefront

1. Open your dev store’s storefront (e.g. `https://your-store.myshopify.com`).
2. Add a product to the cart and go through checkout.
3. Use a **Bogus Gateway** or **Shopify Payments – Test mode** so the order is created.

**Avoid:** **Draft orders** do **not** trigger **orders/create** until they are **completed**. So either complete the draft (customer pays or you mark it paid) or use “Create order” / storefront checkout above.

## 2. Make sure the store is connected from the same app URL

- The app receiving webhooks must be **dev.prepservicesfba.com** (your live app).
- In **PrepCorex**: **Dashboard → Integrations → Shopify** – connect (or reconnect) the store using that same app.
- If the store was connected **before** the “Shopify orders” feature (shop→user mapping), **disconnect and reconnect** the store once so the mapping is created and order webhooks can be saved to the correct user.

## 3. Where to see orders in PrepCorex

- **Admin → Shopify Orders** (sidebar).
- Use the **user selector** and choose the **user who connected that Shopify store**. Orders are stored per user.

## 4. If orders still don’t appear

- In your server logs (e.g. Vercel/host logs for dev.prepservicesfba.com), look for:
  - `[Shopify webhooks] received order webhook` → webhook is reaching the app.
  - `[Shopify webhooks] orders no shopToUser` → reconnect the store in PrepCorex (see step 2).
  - `[Shopify webhooks] orders saved` → order was written to Firestore; then confirm you’re viewing the correct user in Admin → Shopify Orders.
