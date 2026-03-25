# Google Drive Integration - Complete Setup Guide

**Everything you need to set up Google Drive integration for PrepCorex in one place.**

---

## 🎯 Important: Works with Personal Google Drive!

- ✅ **No Google Workspace needed** - Works with personal Google accounts
- ✅ **Use your personal Google Drive** (even with 2TB storage)
- ✅ **Everything is FREE** (Google Cloud free tier is enough)
- ✅ **Users upload without login** - Simple upload process
- ✅ **Admin has full access** - All files stored in your Google Drive

---

## 📋 Overview

All labels will be uploaded to your Google Drive with this folder structure:

```
Year/
  └── Month/
      └── Client Name/
          └── Date (YYYY-MM-DD)/
              └── FileName.pdf
```

**Example:**
```
2024/
  └── January/
      └── John Doe/
          └── 2024-01-15/
              └── label.pdf
```

---

## 🚀 Step-by-Step Setup

### Step 1: Go to Google Cloud Console

1. Go to: **https://console.cloud.google.com/**
2. Sign in with your **personal Google account** (the one with 2TB Drive storage)
3. Accept the terms if prompted (it's free)

---

### Step 2: Create a Project (FREE)

1. Click the **project dropdown** at the top (next to "Google Cloud")
2. Click **New Project**
3. Enter project name: `PrepCorex` (or any name you like)
4. Click **Create**
5. Wait a few seconds for the project to be created
6. Select the new project from the dropdown

**Note**: Google Cloud free tier is enough - no payment required!

---

### Step 3: Enable Google Drive API (FREE)

1. In the left sidebar, click **APIs & Services** → **Library**
2. In the search box, type: **"Google Drive API"**
3. Click on **Google Drive API** from the results
4. Click the blue **Enable** button
5. Wait for it to enable (takes a few seconds)

---

### Step 4: Create Service Account (FREE)

1. In the left sidebar, go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** at the top
3. Select **Service Account** from the dropdown
4. Fill in the form:
   - **Service account name**: `psf-stockflow-drive` (or any name)
   - **Service account ID**: (auto-filled, you can change it)
   - **Description**: `Service account for PrepCorex Google Drive integration`
5. Click **Create and Continue**
6. On the next screen (Grant this service account access to project), you can **skip** this step
   - Click **Continue** or **Done**
7. On the next screen (Grant users access to this service account), you can **skip** this too
   - Click **Done**

---

### Step 5: Download JSON Key File

1. You should now see your service account in the list
2. Click on the **service account email** (looks like: `psf-stockflow-drive@your-project-id.iam.gserviceaccount.com`)
3. Go to the **Keys** tab (at the top)
4. Click **Add Key** → **Create new key**
5. Select **JSON** format
6. Click **Create**
7. **IMPORTANT**: A JSON file will automatically download to your computer!
   - Save this file in a safe place
   - You'll need it in the next steps

---

### Step 6: Share Your Personal Google Drive Folder

**Important**: This works with your **personal Google Drive** (the one with 2TB storage)! No Google Workspace needed!

1. Open the downloaded JSON file (it's a text file, open with Notepad or any text editor)
2. Find the line that says `"client_email"` (looks like: `"client_email": "psf-stockflow-drive@your-project-id.iam.gserviceaccount.com"`)
3. **Copy the email address** (the part in quotes after `client_email`)
   - Example: `psf-stockflow-drive@your-project-id.iam.gserviceaccount.com`

4. Go to **[Google Drive](https://drive.google.com/)** (your personal account with 2TB storage)
5. **Create a new folder** (or use an existing folder) where you want to store the labels
   - Right-click → **New Folder** → Name it `PrepCorex Labels` (or any name)
6. **Right-click the folder** → **Share**
7. In the "Add people and groups" box, **paste the service account email** you copied
8. Click the **dropdown** next to the email → Select **Editor**
9. **Uncheck** "Notify people" (optional, since it's a service account)
10. Click **Share** or **Send**

**Result**: Files will be uploaded to your **personal Google Drive** (2TB storage) in the folder you shared!

**Important**: Service accounts don't have storage quota, so you MUST share a folder from your personal Google Drive. Files uploaded to the shared folder will count against your personal account's quota (2TB).

---

### Step 6.5: Get the Folder ID

1. After sharing the folder, open the folder in Google Drive
2. Look at the URL in your browser - it will look like:
   ```
   https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
   ```
3. **Copy the folder ID** (the long string after `/folders/`)
   - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`
4. You'll need this for the next step

---

### Step 7: Set Environment Variables

1. Open the downloaded JSON file again
2. **Copy the ENTIRE content** (everything from `{` to `}`)
3. The JSON should look like this:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "psf-stockflow-drive@your-project-id.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

4. Copy **all of it** (Ctrl+A, then Ctrl+C)

#### For Local Development (.env.local)

1. Open your `.env.local` file in the project root
2. Add this line:

```env
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
GOOGLE_DRIVE_FOLDER_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

**Important**: 
- Replace the `...` with the actual JSON content you copied
- Replace `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p` with your actual folder ID from Step 6.5
- Use **single quotes** around the JSON
- Make sure the JSON is all on **one line**

**OR** if you prefer, you can format it like this (but it must be on one line):

```env
GOOGLE_SERVICE_ACCOUNT_KEY="{\"type\":\"service_account\",\"project_id\":\"...\",\"private_key\":\"...\",\"client_email\":\"...\"}"
```

#### For Vercel (Production)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Add two environment variables:
   - **Name**: `GOOGLE_SERVICE_ACCOUNT_KEY`
     - **Value**: Paste the entire JSON content (all of it)
   - **Name**: `GOOGLE_DRIVE_FOLDER_ID`
     - **Value**: Paste your folder ID from Step 6.5
6. Select environments: **Production**, **Preview**, **Development** (all of them)
7. Click **Save** for each variable

---

### Step 8: Deploy and Test

1. Commit and push your changes
2. Deploy to your hosting platform (Vercel)
3. Go to your application's **Labels** page
4. Click **Upload Labels**
5. Select a PDF file
6. Click **Upload**
7. Check your Google Drive folder - the file should appear in the correct folder structure!

---

## 📁 Where Files Will Be Stored

Files will be stored in your **personal Google Drive** in this structure:

```
Your Google Drive/
  └── PrepCorex Labels/  (the folder you shared)
      └── 2024/
          └── January/
              └── Client Name/
                  └── 2024-01-15/
                      └── label.pdf
```

---

## 💡 How It Works

1. **User uploads label** → No login needed for users
2. **Your app** → Uses service account to upload to Google Drive
3. **Service account** → Has access to the folder you shared
4. **Files appear** → In your personal Google Drive (2TB storage)

---

## 🆓 Cost: FREE!

- ✅ Google Cloud free tier is enough
- ✅ No Google Workspace needed
- ✅ Personal Google Drive works perfectly
- ✅ Service accounts are free
- ✅ Google Drive API is free (within limits)

**Free tier limits**:
- 1 billion API requests per day (more than enough!)
- Your 2TB personal storage is used

---

## 🐛 Troubleshooting

### Error: "Google Drive credentials not configured"

**Solution**: 
- Make sure `GOOGLE_SERVICE_ACCOUNT_KEY` is set in your `.env.local` file
- Restart your development server after adding the variable
- Check that it's also set in Vercel environment variables

### Error: "Invalid GOOGLE_SERVICE_ACCOUNT_KEY format"

**Solution**: 
- Make sure the JSON is valid
- Check that all quotes are properly escaped
- Try copying the JSON again from the downloaded file
- Make sure the entire JSON is on one line

### Error: "Permission denied" or "File not found"

**Solution**: 
- Make sure you shared the Google Drive folder with the service account email
- Check that the service account has **Editor** permissions
- Verify the `client_email` in your JSON matches the email you shared with
- Make sure you shared the correct folder

### Files not appearing in Google Drive

**Solution**:
- Check the API route logs for errors
- Verify the service account has access to the folder
- Make sure Google Drive API is enabled in your Google Cloud project
- Check that the folder was shared correctly

---

## 🔒 Security Best Practices

1. **Never commit the JSON key file to Git**
   - Add `*.json` to `.gitignore` if you haven't already
   - The key is stored only in environment variables

2. **Restrict Service Account Permissions**
   - Only give the service account access to the specific folder you need
   - Don't give it access to your entire Google Drive

3. **Rotate Keys Regularly**
   - Periodically create new keys and update environment variables
   - Delete old keys from Google Cloud Console

4. **Monitor Usage**
   - Check Google Cloud Console for API usage
   - Set up alerts for unusual activity

---

## ✅ Checklist

- [ ] Created Google Cloud project (free)
- [ ] Enabled Google Drive API (free)
- [ ] Created service account (free)
- [ ] Downloaded JSON key file
- [ ] Shared personal Google Drive folder with service account email
- [ ] Got the folder ID from Google Drive URL
- [ ] Set `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env.local`
- [ ] Set `GOOGLE_DRIVE_FOLDER_ID` in `.env.local`
- [ ] Set `GOOGLE_SERVICE_ACCOUNT_KEY` in Vercel
- [ ] Set `GOOGLE_DRIVE_FOLDER_ID` in Vercel
- [ ] Deployed to production
- [ ] Tested upload functionality

---

## 📚 Additional Resources

- [Google Drive API Documentation](https://developers.google.com/drive/api)
- [Service Accounts Guide](https://cloud.google.com/iam/docs/service-accounts)
- [Google Cloud Console](https://console.cloud.google.com/)

---

## 🎉 You're Done!

Your personal Google Drive (2TB) is now connected! Users can upload labels without any login, and all files will be stored in your personal Google Drive with the organized folder structure.

**No Google Workspace needed - everything works with your free personal account!** 🚀

