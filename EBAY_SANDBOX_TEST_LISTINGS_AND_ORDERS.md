# Testing eBay Listings and Order Fulfillment in Sandbox

Your eBay integration is connected (OAuth). To test **listings** and **order fulfillment** end-to-end in the Sandbox, use the steps below. Right now, PrepCorex only **connects** your eBay account; selecting which listings to sync and syncing orders into PrepCorex will be a later phase.

---

## What you need

1. **Two Sandbox test users** (both created in [User Access Tokens → Register a new Sandbox user](https://developer.ebay.com/my/auth?env=sandbox&index=0)):
   - **Seller:** e.g. `TESTUSER_PSF-seller` (the account you connected in PrepCorex).
   - **Buyer:** e.g. `TESTUSER_buyer-test` (to place test orders).

2. **Sandbox sites:**
   - **Sign in (Sandbox):** https://signin.sandbox.ebay.com  
   - **Sandbox eBay (buy/sell):** https://www.sandbox.ebay.com (or your marketplace, e.g. sandbox.ebay.com)

---

## Step 1: Create a test listing (as seller)

You can create a listing in Sandbox in one of these ways:

### Option A: eBay Sandbox website (if Sell is available)

1. Sign in at **https://signin.sandbox.ebay.com** with your **seller** Sandbox user.
2. Go to **https://www.sandbox.ebay.com** (or your Sandbox home).
3. Look for **Sell** or **List an item** and create a fixed-price listing (e.g. “Test item”, $9.99, quantity 1).
4. Complete the form and publish. Note the **item ID** if shown (you’ll need it for APIs).

*Note: Some Sandbox environments emphasize API testing; if the web “Sell” flow is limited, use Option B.*

### Option B: API Explorer (recommended for API testing)

1. Go to [eBay API Explorer](https://developer.ebay.com/api-docs/static/gs_use-the-api-explorer-to-try.html).
2. Select **Sandbox** and get a **User access token** for your **seller** Sandbox user (same one connected in PrepCorex).
3. Use the **Sell Inventory API**:
   - **createOrReplaceInventoryItem** – create an inventory item (SKU, product details).
   - **createOffer** – create an offer (price, quantity, listing format).
   - **publishOffer** – publish the offer so it becomes a live Sandbox listing.
4. After publishing, you get an **listing ID** (eBay item/offer ID). Use this to find the item when buying.

---

## Step 2: Create a test order (as buyer)

1. **Sign out** of Sandbox (or use an incognito/other browser).
2. Sign in at **https://signin.sandbox.ebay.com** with your **buyer** Sandbox user.
3. Go to **https://www.sandbox.ebay.com** and find the listing you created (search or direct link if you have the item ID).
4. **Buy it now** (or place an offer if it’s Best Offer). Complete checkout with Sandbox test payment (no real money).
5. After purchase, the **seller** will see the order in their Sandbox seller hub.

---

## Step 3: Fulfill the order (as seller)

1. Sign in at **https://signin.sandbox.ebay.com** as the **seller** again.
2. Go to **Seller Hub** or **Orders** / **Sold** in Sandbox (e.g. **My eBay → Selling** or the Sandbox equivalent).
3. Open the test order and:
   - Mark as **Paid** (if needed).
   - **Mark as shipped** (add optional tracking).
   - Optionally leave feedback.

That’s the full Sandbox flow: list → buy → fulfill.

---

## How this relates to PrepCorex

- **Done now:** Your eBay **seller** account is connected to PrepCorex via OAuth (Dashboard → Integrations). The app can call eBay APIs on your behalf with the stored token.
- **Not built yet:**  
  - **Select which eBay listings** PrepCorex should track (like “Manage products” for Shopify).  
  - **Sync eBay orders** into PrepCorex (e.g. via eBay Notification API or polling).  
  - **Fulfill orders from PrepCorex** (mark shipped, update tracking).

Once those features are added, you’ll be able to choose listings in PrepCorex, see orders for those listings in PrepCorex, and fulfill them from the app. Until then, you can fully test **listings and order fulfillment** in the Sandbox using the steps above.

---

## Quick reference

| Step              | Where                         | Who   |
|-------------------|-------------------------------|-------|
| Create listing    | Sandbox site or API Explorer  | Seller |
| Buy item          | www.sandbox.ebay.com          | Buyer  |
| Fulfill order     | Sandbox Seller Hub / Orders   | Seller |
| PrepCorex Connect eBay  | Dashboard → Integrations     | You (seller account) |
