# PrepCorex - Setup Instructions

## 🚀 Quick Start Guide

### 1. Environment Variables Setup

Create a `.env.local` file in your project root with these values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD8eQWXMG-qE1BYmQbDXT3JhR_yI3wxZZM
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=psf-stockflow.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=psf-stockflow
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=psf-stockflow.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=478462798107
NEXT_PUBLIC_FIREBASE_APP_ID=1:478462798107:web:ea5fbbf3927c58373e8bbe
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-8HVVERGNK8
```

### 2. Firebase Console Setup

**IMPORTANT:** You need to enable these services in your Firebase Console:

1. **Authentication:**
   - Go to Firebase Console → Authentication → Sign-in method
   - Enable "Email/Password" provider

2. **Firestore Database:**
   - Go to Firebase Console → Firestore Database
   - Create database → Start in test mode (for now)

### 3. Install Dependencies & Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### 4. Create Your First Admin User

1. Go to `http://localhost:9002/register`
2. Create a regular user account
3. Go to Firebase Console → Firestore Database
4. Find your user document in the "users" collection
5. Edit the document and change `role: "user"` to `role: "admin"`
6. Save the changes

### 5. Test the Application

1. **User Flow:**
   - Register → Login → Dashboard (view inventory)

2. **Admin Flow:**
   - Login as admin → Admin Dashboard → Select user → Manage inventory

## 🔧 What's Fixed

✅ Firebase configuration updated with your credentials
✅ Missing placeholder images file created
✅ Admin dashboard layout structure fixed
✅ Environment variables configured

## 🎯 Next Steps

1. **Test basic functionality** (register, login, dashboard)
2. **Create admin user** (as described above)
3. **Test admin features** (add inventory, ship items)
4. **Set up Firebase security rules** (recommended for production)

## 🚨 Important Notes

- The app will work immediately with the current setup
- Firebase security rules are set to "test mode" - change for production
- All user data is stored in Firestore under `/users/{userId}/`
- Admin users can manage any user's inventory

## 📞 Need Help?

If you encounter any issues:
1. Check browser console for errors
2. Verify Firebase services are enabled
3. Ensure environment variables are set correctly
4. Check Firestore database permissions

Your PrepCorex app is now ready to use! 🎉

