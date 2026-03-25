# Orders not showing: Enable Protected Customer Data (PCD) for orders webhooks

If you see in logs:

```text
Webhook registration: orders/create 403 {"errors":"You do not have permission to create or update webhooks with orders/create topic. This topic contains protected customer data."}
Webhook registration: orders/updated 403 ...
```

then **orders webhooks are not registered** because Shopify treats order data as **protected customer data**. The app must request access in the Partner Dashboard.

## Fix: Request Protected Customer Data access

1. **Open Shopify Partner Dashboard**  
   [partners.shopify.com](https://partners.shopify.com) → **Apps** → select your app (the one used for PrepCorex Shopify integration).

2. **Go to API access requests**  
   In the app’s sidebar, click **API access requests**.

3. **Request Protected Customer Data access**  
   - Find **Protected customer data access** and click **Request access**.  
   - Select **Protected customer data** and give a short reason (e.g. “Show orders in PrepCorex admin and sync fulfillment status”).  
   - Click **Save**.

4. **Request access to protected fields (for order details)**  
   To show customer name, email, address on orders in PrepCorex, request the relevant fields:  
   - **Name** (first/last)  
   - **Email**  
   - **Address** (shipping/billing)  
   - **Phone** (optional)  
   Add a reason (e.g. “Display order and shipping details in PrepCorex admin”).  
   Click **Save**.

5. **Complete Data protection details**  
   Fill in the data protection details as required by the dashboard (e.g. how you store and protect data). This is required even for development.

6. **Development stores only**  
   If the app is only installed on **development stores**, you do **not** need to submit for full app review. After saving the PCD request and data protection details, the app can use orders webhooks on dev stores.

7. **Reconnect the store in PrepCorex**  
   After PCD access is granted (or saved for dev):  
   - In PrepCorex go to **Dashboard → Integrations → Shopify**.  
   - Disconnect the store, then connect it again.  
   This re-runs webhook registration; **orders/create** and **orders/updated** should register successfully and orders will start appearing under **Admin → Shopify Orders**.

## 422 "address has already been taken"

If you see 422 for `inventory_levels/update`, `products/update`, or `products/delete`, those webhooks are **already registered** (e.g. from a previous connect). Shopify is rejecting duplicate registration. You can ignore those 422s; the webhooks are active.

## References

- [Shopify: Work with protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)  
- Partner Dashboard path: **Apps** → [Your app] → **API access requests** → **Protected customer data access**
