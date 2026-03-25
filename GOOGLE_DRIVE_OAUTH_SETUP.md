# Google Drive OAuth Setup Guide

**Using OAuth 2.0 to upload files to your personal Google Drive (2TB quota)**

---

## 🎯 Why OAuth Instead of Service Account?

- ✅ **Uses your personal Google Drive quota** (2TB)
- ✅ **No storage quota errors**
- ✅ **Files uploaded to your personal account**
- ✅ **One-time authentication** (then automatic)

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Go to **APIs & Services** → **Credentials**
4. Click **+ Create Credentials** → **OAuth client ID**
5. If prompted, configure OAuth consent screen:
   - **User Type**: External
   - **App name**: `PrepCorex`
   - **Support email**: Your email
   - Click **Save and Continue**
   - **Scopes**: Add `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/drive.file`
   - Click **Save and Continue**
   - **Test users**: Add your email (optional for testing)
   - Click **Save and Continue**
6. Back to **Credentials** → **Create OAuth client ID**
7. **Application type**: Web application
8. **Name**: `PrepCorex Drive`
9. **Authorized redirect URIs**: 
   - Add: `https://yourdomain.com/api/drive/callback`
   - For local: `http://localhost:3000/api/drive/callback`
10. Click **Create**
11. **Copy the Client ID and Client Secret** (save them!)

---

### Step 2: Set Environment Variables

#### For Local Development (.env.local)

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/drive/callback
```

#### For Vercel (Production)

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - `GOOGLE_CLIENT_ID` = Your Client ID
   - `GOOGLE_CLIENT_SECRET` = Your Client Secret
   - `GOOGLE_REDIRECT_URI` = `https://yourdomain.com/api/drive/callback`

---

### Step 3: Authenticate with Google Drive

1. Go to: `https://yourdomain.com/api/drive/auth` (or `http://localhost:3000/api/drive/auth` for local)
2. You'll get an authorization URL
3. Click the URL or copy it to your browser
4. Sign in with your **personal Google account** (the one with 2TB Drive)
5. Grant permissions
6. You'll be redirected back with a success message
7. **Copy the refresh token** from the success page
8. Add it to your environment variables:

```env
GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token_here
```

**OR** it will be automatically saved to Firestore (if you have Firebase configured)

---

### Step 4: Test Upload

1. Go to your Labels page
2. Upload a PDF file
3. Check your Google Drive - the file should appear!

---

## ✅ That's It!

Now files will be uploaded to your personal Google Drive using your 2TB quota!

---

## 🔄 How It Works

1. **First time**: Admin authenticates with Google (one-time)
2. **Refresh token stored**: In environment variable or Firestore
3. **Automatic token refresh**: App gets new access tokens automatically
4. **Files uploaded**: To your personal Google Drive (uses your quota)

---

## 🐛 Troubleshooting

### "No refresh token found"

**Solution**: 
- Go to `/api/drive/auth` to authenticate
- Make sure you grant permissions
- Copy the refresh token and set `GOOGLE_DRIVE_REFRESH_TOKEN`

### "Failed to refresh access token"

**Solution**:
- Your refresh token may be expired
- Re-authenticate by going to `/api/drive/auth` again
- Get a new refresh token

### "Invalid redirect URI"

**Solution**:
- Make sure the redirect URI in Google Cloud Console matches exactly
- Check `GOOGLE_REDIRECT_URI` environment variable

---

## 📝 Checklist

- [ ] Created OAuth 2.0 credentials in Google Cloud Console
- [ ] Set `GOOGLE_CLIENT_ID` in environment variables
- [ ] Set `GOOGLE_CLIENT_SECRET` in environment variables
- [ ] Set `GOOGLE_REDIRECT_URI` in environment variables
- [ ] Authenticated with Google Drive (visited `/api/drive/auth`)
- [ ] Got refresh token and set `GOOGLE_DRIVE_REFRESH_TOKEN`
- [ ] Tested upload functionality

---

## 🎉 Done!

Your Google Drive OAuth integration is ready! Files will be uploaded to your personal Google Drive using your 2TB quota.

