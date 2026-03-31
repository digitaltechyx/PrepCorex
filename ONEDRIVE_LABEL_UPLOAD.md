# OneDrive Label Upload – What’s Missing and How to Add It

---

## “SharePoint access” / “SharePoint permission” – why it appears and how to fix it

When you set up OneDrive upload, you often see something like **“SharePoint access”**, **“Access your SharePoint”**, or **“Your admin needs to approve SharePoint”**. That’s usually one of these:

### 1. **Azure shows “SharePoint” for file permissions**

In Azure App registration → **API permissions** → **Microsoft Graph**, many file permissions are listed under or named with **SharePoint**, because OneDrive for Business is built on SharePoint. So even if you only want **personal OneDrive**:

- **Files.ReadWrite**  
- **Files.ReadWrite.All**  
- **Sites.ReadWrite.All**

can show up with labels like “Access files in SharePoint” or “SharePoint” on the consent screen. **That doesn’t mean you must use SharePoint** – it’s just how Microsoft names the scopes.

### 2. **What to use so you don’t need “SharePoint” (admin) approval**

For **personal OneDrive only** (one account’s drive, like your current Google Drive setup):

- **Request only these delegated permissions:**
  - **Files.ReadWrite** – read/write files in the signed-in user’s OneDrive
  - **offline_access** – so you get a refresh token
- **Do not add** (if you want to avoid admin consent and broad “SharePoint” access):
  - **Files.ReadWrite.All**
  - **Sites.ReadWrite.All**
  - **Sites.ReadWrite.All** (SharePoint)

With **only** `Files.ReadWrite` + `offline_access`:

- **Personal Microsoft account** (outlook.com, live.com, etc.): consent is user-only; no “SharePoint admin approval” needed.
- **Work/school account**: some tenants still show “SharePoint” in the consent text, but for **only** `Files.ReadWrite` it’s still just that user’s OneDrive; admin consent is only required if your org policy demands it.

So the thing that often “stops” people is adding **Sites.ReadWrite.All** or **Files.ReadWrite.All** thinking they need it for OneDrive – that’s when Microsoft asks for **SharePoint / admin consent**. For uploading to **that user’s OneDrive**, **Files.ReadWrite** is enough.

### 3. **If you already requested SharePoint / admin-only permissions**

- In Azure: **API permissions** → remove **Sites.ReadWrite.All**, **Files.ReadWrite.All** (if you don’t need them).
- Keep only **Files.ReadWrite** and **offline_access**.
- Re-run the OAuth flow (new consent) so the app no longer asks for “SharePoint access”.
- If the app was previously granted admin consent, an admin may need to revoke the app’s consent and you sign in again with the reduced scopes.

### 4. **Summary**

| Goal                         | Use these permissions     | Avoid                          |
|-----------------------------|---------------------------|--------------------------------|
| Upload to personal OneDrive | `Files.ReadWrite`, `offline_access` | `Sites.ReadWrite.All`, `Files.ReadWrite.All` |
| No “SharePoint” consent     | Same as above             | Any **Sites.*** or **.All** file scope |

So: **the “SharePoint access” requirement usually appears because the app is asking for Sites or .All permissions. Stick to `Files.ReadWrite` + `offline_access` for OneDrive-only upload and you avoid that.**

---

## Current state

- **Label upload in the app uses only Google Drive.**  
  There is no OneDrive implementation or notes in the repo about why OneDrive was dropped.
- **Google Drive flow:** OAuth2 → refresh token → `/api/drive/token` → `/api/drive/upload` (googleapis) → create folders + upload file → return `webViewLink` / `webContentLink`.

So anything that “stopped” OneDrive was likely during an experiment that never made it into this codebase. Below is what’s required for OneDrive and what usually goes wrong.

---

## What’s required for OneDrive (and what often fails)

### 1. Microsoft identity and API

- **Azure AD app** (Microsoft Entra): create an app registration, get **Application (client) ID** and **Client secret**.
- **Microsoft Graph API** for OneDrive (not the old “Live SDK”):
  - Scopes: `Files.ReadWrite`, `offline_access` (so you get a refresh token).
  - For “app-only” (no user login): `https://graph.microsoft.com/.default` and client credentials flow (no refresh token per user; different use case).
- **Redirect URI** in the Azure app must match exactly (e.g. `https://yourdomain.com/api/onedrive/callback`).

**Common issue:** Using wrong scope (e.g. only `Files.Read`) or missing `offline_access`, so you never get a refresh token and uploads fail after the first token expires.

### 2. OAuth2 flow (like Google)

- **Authorize URL:**  
  `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=...&response_type=code&redirect_uri=...&scope=...`
- **Token URL:**  
  `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- You must:
  - Exchange `code` for `access_token` and **refresh_token** (only if you requested `offline_access`).
  - Store the **refresh_token** (env or Firestore, same idea as `GOOGLE_DRIVE_REFRESH_TOKEN`).
  - Before each upload, get a fresh `access_token` using the refresh token (same pattern as `/api/drive/token`).

**Common issue:** Not storing or not using the refresh token, so after ~1 hour uploads start failing with 401.

### 3. Upload API (Microsoft Graph)

- **Create folder structure:**  
  `POST https://graph.microsoft.com/v1.0/me/drive/root/children` with `{ "name": "FolderName", "folder": {} }` and use the returned `id` as parent for the next level. Repeat for each segment of `Year/Month/Client Name/Date`.
- **Upload file:**  
  - Small files (&lt; 4 MB):  
    `PUT https://graph.microsoft.com/v1.0/me/drive/root:/Path/To/Folder/FileName.pdf:/content`  
    with body = file bytes and `Content-Type` set to the file MIME type.
  - Larger files: use upload session (create upload session, upload chunks). Same as Google’s resumable upload pattern.

**Common issues:**

- **Path format:** Graph uses path like `root:/Year/Month/Client Name/Date/FileName.pdf`; special characters in “Client Name” or “Date” must be encoded (e.g. `/` in names is not allowed as literal path separator).
- **Wrong base:** Using `me/drive/root` is “My Drive” (personal OneDrive). For a shared/organization drive you’d use a different endpoint (e.g. drive by ID).
- **Permissions:** If the app only has `Files.Read`, uploads will fail with 403; you need `Files.ReadWrite` (and `offline_access` for refresh token).

### 4. Download / view URL for stored labels

- After upload, Graph returns item metadata; you use something like:
  - `@microsoft.graph.downloadUrl` for a short-lived download link, or
  - `webUrl` for opening in browser.
- Your app would store one of these (or the item ID and build links) the same way you store `downloadURL` / `webViewLink` for Google Drive.

---

## Why OneDrive might have “stopped” you before

Typical blockers when people try OneDrive the first time:

1. **No refresh token** – Only did one-time OAuth and didn’t request/store `offline_access` + refresh token → uploads work once, then 401.
2. **Wrong or insufficient scopes** – e.g. `User.Read` only; need `Files.ReadWrite` (and `offline_access`) for upload.
3. **Incorrect redirect URI** – Redirect URI in code doesn’t match Azure app → auth fails.
4. **Path/encoding** – Building paths with unencoded names or wrong format for Graph (e.g. `root:/path/to/file`) → 400 or 404.
5. **Using old API** – Using deprecated Live SDK or wrong base URL instead of `https://graph.microsoft.com/v1.0/me/drive/...`.

---

## How to add OneDrive upload to this project

1. **Azure:** Create app registration, add redirect URI, create client secret, add API permissions for Microsoft Graph: `Files.ReadWrite`, `offline_access`.
2. **Env (or Firestore):** Store `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, `ONEDRIVE_REDIRECT_URI`, and after first OAuth `ONEDRIVE_REFRESH_TOKEN` (or store in Firestore like `system/googleDrive`).
3. **Routes:** Add routes similar to drive:
   - `/api/onedrive/auth` – redirect to Microsoft authorize URL.
   - `/api/onedrive/callback` – exchange `code` for tokens, save refresh token.
   - `/api/onedrive/token` – GET, use refresh token to return current access token.
   - `/api/onedrive/upload` – POST, accept same form fields (`file`, `clientName`, `folderPath`), create folder structure via Graph, upload file, return download/view URL.
4. **Frontend:** Either switch label upload to OneDrive (change fetch from `/api/drive/upload` to `/api/onedrive/upload`) or add a setting (e.g. “Store labels in: Google Drive | OneDrive”) and call the chosen API.

If you want, the next step can be adding a minimal `/api/onedrive/upload` (and token + auth routes) in this repo reusing the same `folderPath` and form contract as the Google Drive upload.
