# eBay Integration – Next Steps (Account Verified)

Your eBay developer account is verified. Here’s what to do step by step (including first login) and what we need for the integration.

---

## Step-by-step: What you do (eBay’s current flow, 2024–2025)

Do these in order. Use **Sandbox** first so we can test safely.

**Reference:** [Create the eBay API keysets](https://developer.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html) | [Getting your redirect_uri (RuName)](https://developer.ebay.com/api-docs/static/oauth-redirect-uri.html)

---

### Step 1: Log in and go to Application Keys

1. Go to **https://developer.ebay.com** and sign in (you’re already here as “digitaltechyx”).
2. Go to **Application Keys** (you’re on this page when you see “Enter Application Title”).

---

### Step 2: Create your first keyset (Sandbox)

1. In the **“Enter Application Title”** field, type a name for your app (e.g. **PrepCorex**). Max 50 characters.
2. Below that you should see **Sandbox** and **Production**.
3. Under **Sandbox**, click **Create a keyset**.
4. After it’s created, the page will show your **keyset** with:
   - **App ID** (Client ID)
   - **Cert ID** (Client Secret)  
   Copy both and keep the Cert ID private.

**Note:** If you already have an application/keyset, you’ll see it when you log in. You can use that, or use “Request another keyset” for a different app.

---

### Step 3: Create the OAuth RuName (redirect for “Connect with eBay”)

eBay uses a **RuName** instead of a plain redirect URL. You create it from the same Application Keys area:

1. Find the **User Tokens** link next to your **Client ID** (App ID) and click it.
2. Open the **“Get a Token from eBay via Your Application”** dropdown.
3. If you see **“You have no Redirect URLs. Click here to add one”**, click it.
4. Complete the **Confirm the Legal Address for the Primary Contact or Business** form, then click **Continue to create RuName**.
5. On the RuName form, fill in:
   - **Display Title** – e.g. “PrepCorex” (what users see on the grant page).
   - **Privacy Policy URL** – URL of your app’s privacy policy (e.g. your site’s /privacy or homepage).
   - **Auth Accepted URL** – where to send the user after they approve. Use a path that does **not** contain the word "ebay" (eBay may reject it). Use **exactly** one of:
     - Production: `https://psf-stock-flow.vercel.app/dashboard/integrations/connect/callback`
     - Dev: `https://dev-psfstockflow.vercel.app/dashboard/integrations/connect/callback`
     - Prep FBA dev: `https://dev.prepservicesfba.com/dashboard/integrations/connect/callback`
   - **Auth Declined URL** – where to send the user if they deny (e.g. back to integrations):  
     `https://dev.prepservicesfba.com/dashboard/integrations` (or your production URL).
6. Save. eBay will show a **RuName value** (a string eBay generates). Copy that – we use it in OAuth requests (not the URL itself).

---

### Step 4: Send us what we need (no secret in chat)

- **App ID (Sandbox):** You can paste it here or we’ll use it as `NEXT_PUBLIC_EBAY_APP_ID`.
- **Client Secret / Cert ID (Sandbox):** Do **not** paste here. Add it in **Vercel** → project → **Settings** → **Environment Variables** → e.g. `EBAY_CLIENT_SECRET`. Tell us: “I added EBAY_CLIENT_SECRET in Vercel.”
- **RuName value:** After Step 3, eBay shows a RuName string. Send us that value (or the env var name you used, e.g. `EBAY_RUNAME`).

Once you have App ID, Client Secret in Vercel, and the RuName value, add the env vars below and use “Connect eBay” on the Integrations page.

---

## Environment variables (for Vercel / host)

| Variable | Where | Example |
|----------|--------|--------|
| `NEXT_PUBLIC_EBAY_APP_ID` | Vercel (public) | Your Sandbox App ID (e.g. `ARSHADIQ-PrepEngi-SBX-...`) |
| `EBAY_CLIENT_SECRET` | Vercel (secret) | Your Sandbox Cert ID |
| `EBAY_RUNAME` | Vercel (secret) | The RuName string from the eBay portal (e.g. `PrepEn-zenocyp&SessID=...` or similar) |
| `EBAY_SANDBOX` | Optional | `true` for Sandbox (default if App ID contains `SBX`), `false` for Production |

After setting these, the **Connect eBay** flow on Dashboard → Integrations will redirect users to eBay to grant access, then back to `/dashboard/integrations/connect/callback` to complete the connection.

---

## 1. Credentials to Provide (summary)

From **eBay Developer Portal** → [Application Keys](https://developer.ebay.com/my/keys) (and **User tokens** for RuName):

| Item | Where to get it | Used for |
|------|-----------------|----------|
| **App ID (Client ID)** | Application Keys | OAuth – public, can go in frontend |
| **Client Secret (Cert ID)** | Application Keys | OAuth – **secret**, server-only (env var) |
| **OAuth RuName** | User tokens → create OAuth Redirect URI | Redirect after user authorizes (e.g. `https://yourdomain.com/dashboard/integrations/ebay/callback`) |

- Use **Sandbox** keys first for testing; switch to **Production** when ready.
- Add your app’s **redirect URL** in the portal (RuName) exactly as in production (e.g. `https://psf-stock-flow.vercel.app/dashboard/integrations/ebay/callback`).

---

## 2. How We’ll Build It (Same Idea as Shopify)

- **Connect account**: OAuth 2.0 “authorization code” flow → user signs in with eBay, we get a token and store it per user in Firestore (e.g. `users/{uid}/ebayConnections`).
- **Select products**: Like Shopify “Manage products” – user picks which eBay **listings** (items) we fulfill; we store selected listing IDs. Only those will sync.
- **Orders**: Event-based only (no time-based polling):
  - Use eBay **Notification API** (REST) for order events (e.g. `ORDER_CONFIRMATION`).
  - When we receive an order notification, we’ll fetch the order via API and **filter by selected listing IDs** – only orders that contain at least one selected product get synced into PrepCorex.

---

## 3. What You Do Next

1. **Get credentials**
   - App ID, Client Secret (Cert ID), and create a RuName for:  
     `https://<your-production-domain>/dashboard/integrations/ebay/callback`
2. **Share them securely**
   - App ID can be shared (or we put it in `NEXT_PUBLIC_EBAY_APP_ID`).
   - Client Secret and RuName: add to **Vercel (or your host) env** and tell us the env var names you used (e.g. `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`), or share once in a secure channel and we’ll document the names.
3. **Confirm environment**
   - Sandbox vs Production – we’ll implement for the one you prefer first (Sandbox recommended for first integration).

Once we have the credentials and RuName, we can add:
- eBay OAuth connect + callback
- “Select eBay listings” UI and storage
- Notification API subscription + order webhook handler that only syncs orders for selected products.

---

## References

- [eBay OAuth credentials](https://developer.ebay.com/api-docs/static/oauth-credentials.html)
- [eBay Notification API (order events)](https://developer.ebay.com/api-docs/sell/notification/overview.html)
- [Platform notifications (order flow)](https://developer.ebay.com/support/kb-article?KBid=2093)
