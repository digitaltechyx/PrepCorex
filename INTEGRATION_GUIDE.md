# Stripe & Shippo Integration Guide

Complete step-by-step guide for integrating Stripe payments and Shippo shipping labels into PrepCorex.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Stripe Integration](#stripe-integration)
3. [Shippo Integration](#shippo-integration)
4. [Complete Setup Flow](#complete-setup-flow)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)
7. [Production Deployment](#production-deployment)

---

## 🎯 Overview

This guide covers the integration of:
- **Stripe** - Payment processing for label purchases
- **Shippo** - Shipping label generation and tracking

### Features
- Users can purchase shipping labels through the portal
- Payment processing via Stripe
- Automatic label generation via Shippo after payment
- Parcel tracking functionality
- Label download and management

---

## 💳 Stripe Integration

### Requirements

#### 1. Stripe Account
- **Sign up**: https://dashboard.stripe.com/register
- **Account type**: Standard account (free to create)
- **Verification**: Complete account verification (business details, bank account)

#### 2. API Keys Needed
- **Publishable Key** (starts with `pk_test_...` or `pk_live_...`)
- **Secret Key** (starts with `sk_test_...` or `sk_live_...`)
- **Webhook Secret** (starts with `whsec_...`) - Generated after webhook setup

#### 3. Payment Method
- Add a bank account for payouts (required for live mode)
- Test mode doesn't require bank account

---

### Step-by-Step Stripe Setup

#### Step 1: Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Enter your email and create a password
3. Complete the registration process
4. Verify your email address

#### Step 2: Complete Account Setup

1. **Business Information**
   - Go to **Settings** → **Business settings**
   - Enter business name, type, and address
   - Add business description

2. **Bank Account** (for live mode)
   - Go to **Settings** → **Payouts**
   - Add your bank account details
   - Verify bank account (may take 1-2 business days)

3. **Tax Information** (if required)
   - Complete tax forms if needed for your region

#### Step 3: Get API Keys

1. Go to **Developers** → **API keys**
2. You'll see two modes:
   - **Test mode** (toggle in top right)
   - **Live mode** (toggle to switch)

3. **For Development (Test Mode)**:
   - Copy **Publishable key** (starts with `pk_test_...`)
   - Copy **Secret key** (starts with `sk_test_...`)
   - Click "Reveal test key" if needed

4. **For Production (Live Mode)**:
   - Toggle to **Live mode**
   - Copy **Publishable key** (starts with `pk_live_...`)
   - Copy **Secret key** (starts with `sk_live_...`)

⚠️ **Important**: 
- Never share your Secret key
- Never commit Secret keys to git
- Use test keys for development
- Switch to live keys only after thorough testing

#### Step 4: Set Up Webhook

**⚠️ Important**: You must deploy your application first before setting up webhooks!

1. **Deploy Your Application**
   - Deploy to production (Vercel, etc.)
   - Get your production URL (e.g., `https://ims.prepservicesfba.com`)

2. **Create Webhook Endpoint**
   - Go to **Developers** → **Webhooks**
   - Click **Add endpoint**
   - Enter endpoint URL: `https://yourdomain.com/api/stripe/webhook`
   - Replace `yourdomain.com` with your actual domain

3. **Select Events**
   - Click **Select events**
   - Choose these events:
     - ✅ `payment_intent.succeeded`
     - ✅ `payment_intent.payment_failed`
     - ✅ `payment_intent.canceled`
     - ✅ `charge.succeeded` (optional)
     - ✅ `charge.failed` (optional)
   - Click **Add events**

4. **Save Endpoint**
   - Click **Add endpoint**
   - Copy the **Signing secret** (starts with `whsec_...`)
   - ⚠️ Save this immediately - you can only see it once!

#### Step 5: Local Development Webhook Setup

For testing webhooks locally, use Stripe CLI:

1. **Install Stripe CLI**
   - **Windows**: Download from https://github.com/stripe/stripe-cli/releases
   - **Mac**: `brew install stripe/stripe-cli/stripe`
   - **Linux**: See https://stripe.com/docs/stripe-cli

2. **Login to Stripe**
   ```bash
   stripe login
   ```
   - This will open browser for authentication

3. **Forward Webhooks to Local Server**
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   - This will give you a webhook signing secret
   - Use this in your `.env.local` as `STRIPE_WEBHOOK_SECRET`

#### Step 6: Add Environment Variables

**Local Development (`.env.local`)**:
```env
# Stripe Keys (Test Mode)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_WEBHOOK_SECRET_HERE
```

**Production (Vercel/Your Hosting)**:
1. Go to your hosting platform's dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add these variables:
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_live_...`
   - `STRIPE_SECRET_KEY` = `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...` (from webhook endpoint)
4. Select environments: **Production**, **Preview**, **Development**
5. Click **Save**

#### Step 7: Test Stripe Integration

1. **Test Cards** (Test Mode Only):
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - Requires 3D Secure: `4000 0025 0000 3155`
   - Use any future expiry date, any CVC, any ZIP

2. **Test Payment Flow**:
   - Go to `/dashboard/buy-labels`
   - Fill in shipment details
   - Complete payment with test card
   - Check Stripe Dashboard → **Payments** to see transaction

3. **Test Webhook**:
   - Go to Stripe Dashboard → **Developers** → **Webhooks**
   - Click on your webhook endpoint
   - Click **Send test webhook**
   - Select `payment_intent.succeeded`
   - Check your application logs

---

## 📦 Shippo Integration

### Requirements

#### 1. Shippo Account
- **Sign up**: https://goshippo.com/
- **Account type**: Standard account (free to create)
- **Billing**: Credit card required for label purchases

#### 2. API Key
- **API Key** (starts with `shippo_test_...` or `shippo_live_...`)
- Generated from Shippo Dashboard

#### 3. Carrier Accounts
- Connect at least one shipping carrier:
  - **USPS** (United States Postal Service)
  - **UPS** (United Parcel Service)
  - **FedEx** (Federal Express)
  - **DHL**
  - Others as needed

#### 4. Payment Method
- Add credit card in Shippo Dashboard
- Labels are charged to this card when purchased

---

### Step-by-Step Shippo Setup

#### Step 1: Create Shippo Account

1. Go to https://goshippo.com/
2. Click **Sign Up** or **Get Started**
3. Enter your email and create a password
4. Complete the registration process
5. Verify your email address

#### Step 2: Complete Account Setup

1. **Business Information**
   - Go to **Settings** → **Account**
   - Enter business name, address, and contact information
   - Add business details

2. **Billing Information**
   - Go to **Settings** → **Billing**
   - Add credit card
   - ⚠️ This card will be charged for all label purchases
   - Set up billing preferences

#### Step 3: Connect Shipping Carriers

1. **Go to Carrier Settings**
   - Navigate to **Settings** → **Carriers**
   - Or **Carriers** in the main menu

2. **Connect USPS** (Recommended for US shipping):
   - Click **Connect USPS**
   - You have two options:
     - **Shippo Postage** (Easiest - no USPS account needed)
     - **USPS Account** (Requires USPS account setup)
   - For quick start, choose **Shippo Postage**
   - Follow the connection wizard

3. **Connect UPS** (Optional):
   - Click **Connect UPS**
   - You'll need:
     - UPS account number
     - UPS API credentials
   - Follow the connection wizard

4. **Connect FedEx** (Optional):
   - Click **Connect FedEx**
   - You'll need:
     - FedEx account number
     - FedEx API credentials
   - Follow the connection wizard

5. **Verify Carrier Connection**
   - After connecting, test by creating a test shipment
   - Ensure rates are showing correctly

#### Step 4: Get API Key

1. **Navigate to API Settings**
   - Go to **Settings** → **API**
   - Or **Developers** → **API**

2. **Generate API Key**
   - You'll see two sections:
     - **Test API Key** (for development)
     - **Live API Key** (for production)
   - Click **Generate Token** or **Create API Key**

3. **Copy API Key**
   - **Test Key**: Starts with `shippo_test_...`
   - **Live Key**: Starts with `shippo_live_...`
   - ⚠️ Copy and save immediately - you can only see it once!

4. **API Key Permissions**
   - Ensure the key has permissions for:
     - Creating shipments
     - Purchasing labels
     - Getting rates
     - Tracking shipments

#### Step 5: Enable Address Validation (Recommended)

1. Go to **Settings** → **Address Validation**
2. Enable **Address Validation**
3. This helps reduce shipping errors and invalid addresses

#### Step 6: Add Environment Variables

**Local Development (`.env.local`)**:
```env
# Shippo API Key (Test Mode)
SHIPPO_API_KEY=shippo_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Production (Vercel/Your Hosting)**:
1. Go to your hosting platform's dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add:
   - `SHIPPO_API_KEY` = `shippo_live_...`
4. Select environments: **Production**, **Preview**, **Development**
5. Click **Save**

#### Step 7: Test Shippo Integration

1. **Test API Connection**:
   - Use Shippo's API documentation to test
   - Or test through your application's "Get Rates" feature

2. **Test Label Purchase**:
   - Create a test shipment
   - Purchase a test label
   - Verify label is generated correctly
   - Download and verify label PDF

3. **Test Tracking**:
   - Use a tracking number from a purchased label
   - Test tracking API endpoint
   - Verify tracking information displays correctly

---

## 🔄 Complete Setup Flow

### Phase 1: Stripe Setup (Do This First)

1. ✅ Create Stripe account
2. ✅ Complete business information
3. ✅ Get test API keys
4. ✅ Add to `.env.local`
5. ✅ Test payment flow locally
6. ✅ Deploy application
7. ✅ Set up webhook in Stripe
8. ✅ Add webhook secret to production env vars
9. ✅ Test webhook in production

### Phase 2: Shippo Setup (After Stripe)

1. ✅ Create Shippo account
2. ✅ Add billing information
3. ✅ Connect at least one carrier (USPS recommended)
4. ✅ Get test API key
5. ✅ Add to `.env.local`
6. ✅ Test rates API
7. ✅ Test label purchase flow
8. ✅ Add live API key to production
9. ✅ Test end-to-end flow

### Phase 3: Integration Testing

1. ✅ Test complete flow:
   - User fills form → Gets rates → Selects rate → Pays via Stripe
   - Payment succeeds → Webhook triggers → Shippo label purchased
   - Label available for download
2. ✅ Test error handling:
   - Payment failures
   - Shippo API errors
   - Network issues
3. ✅ Test tracking:
   - Track purchased labels
   - Display tracking information

---

## 🧪 Testing

### Stripe Testing

#### Test Cards (Test Mode Only)

| Card Number | Scenario |
|------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Card declined |
| `4000 0025 0000 3155` | Requires 3D Secure |
| `4000 0000 0000 9995` | Insufficient funds |

**Use with**:
- Any future expiry date (e.g., `12/25`)
- Any 3-digit CVC (e.g., `123`)
- Any ZIP code (e.g., `12345`)

#### Test Webhook Events

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click your webhook endpoint
3. Click **Send test webhook**
4. Select event type
5. Verify your application receives and processes it

### Shippo Testing

#### Test Shipment

1. Use test addresses:
   - **From**: Your business address
   - **To**: Any valid US address
2. Use realistic parcel dimensions:
   - Weight: 1-5 lbs
   - Dimensions: 10x8x6 inches
3. Verify rates are returned
4. Purchase test label
5. Verify label PDF is generated

#### Test Tracking

1. Use tracking number from test label
2. Call tracking API
3. Verify tracking information is returned
4. Display in UI

---

## 🐛 Troubleshooting

### Stripe Issues

#### "Stripe failed to load"
- ✅ Check `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set
- ✅ Verify key starts with `pk_test_` or `pk_live_`
- ✅ Check key is not expired or revoked

#### "Webhook signature verification failed"
- ✅ Verify `STRIPE_WEBHOOK_SECRET` is correct
- ✅ Ensure webhook URL matches exactly in Stripe dashboard
- ✅ For local testing, use Stripe CLI webhook secret

#### "Payment intent creation failed"
- ✅ Check `STRIPE_SECRET_KEY` is set correctly
- ✅ Verify key has correct permissions
- ✅ Check Stripe account is not restricted

#### "Payment succeeded but webhook not received"
- ✅ Check webhook endpoint is accessible
- ✅ Verify webhook is configured in Stripe dashboard
- ✅ Check application logs for errors
- ✅ Verify webhook secret is correct

### Shippo Issues

#### "Shippo API key not configured"
- ✅ Check `SHIPPO_API_KEY` is set in environment variables
- ✅ Verify key starts with `shippo_test_` or `shippo_live_`
- ✅ Ensure key is not expired

#### "No rates returned"
- ✅ Verify at least one carrier is connected
- ✅ Check addresses are valid
- ✅ Verify parcel dimensions are realistic
- ✅ Check Shippo account has sufficient balance

#### "Label purchase failed"
- ✅ Verify billing information is set up
- ✅ Check Shippo account has sufficient balance
- ✅ Verify carrier account is active
- ✅ Check addresses are valid and complete

#### "Tracking not found"
- ✅ Verify tracking number is correct
- ✅ Check carrier is supported
- ✅ Ensure tracking number format is correct
- ✅ Wait a few minutes after label purchase (tracking may not be immediately available)

---

## 🚀 Production Deployment

### Pre-Deployment Checklist

#### Stripe
- [ ] Switch to live API keys
- [ ] Complete Stripe account verification
- [ ] Add bank account for payouts
- [ ] Set up production webhook endpoint
- [ ] Test with real payment (small amount)
- [ ] Verify webhooks are working

#### Shippo
- [ ] Switch to live API key
- [ ] Complete Shippo account setup
- [ ] Connect production carrier accounts
- [ ] Add billing information
- [ ] Test label purchase with real address
- [ ] Verify labels are correct

### Environment Variables (Production)

```env
# Stripe (Live Mode)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Shippo (Live Mode)
SHIPPO_API_KEY=shippo_live_...
```

### Post-Deployment Testing

1. **Test Payment Flow**:
   - Use real payment method (small amount)
   - Verify payment processes correctly
   - Check Stripe Dashboard for transaction

2. **Test Label Purchase**:
   - Purchase a real label
   - Verify label is generated
   - Download and verify label PDF

3. **Test Tracking**:
   - Track the purchased label
   - Verify tracking information displays

4. **Monitor**:
   - Check application logs
   - Monitor Stripe Dashboard
   - Monitor Shippo Dashboard
   - Watch for errors

---

## 📚 Additional Resources

### Stripe
- **Documentation**: https://stripe.com/docs
- **API Reference**: https://stripe.com/docs/api
- **Test Cards**: https://stripe.com/docs/testing
- **Webhooks Guide**: https://stripe.com/docs/webhooks

### Shippo
- **Documentation**: https://docs.goshippo.com/
- **API Reference**: https://docs.goshippo.com/api/
- **Carrier Setup**: https://docs.goshippo.com/article/12-carrier-setup
- **Tracking Guide**: https://docs.goshippo.com/article/97-tracking

---

## 🔐 Security Best Practices

1. **Never commit API keys to git**
   - Use environment variables
   - Add `.env.local` to `.gitignore`

2. **Use test keys for development**
   - Only use live keys in production
   - Test thoroughly before going live

3. **Rotate keys regularly**
   - Change API keys periodically
   - Revoke old keys when not in use

4. **Monitor usage**
   - Check Stripe Dashboard regularly
   - Monitor Shippo account activity
   - Set up alerts for unusual activity

5. **Webhook security**
   - Always verify webhook signatures
   - Use HTTPS for webhook endpoints
   - Keep webhook secrets secure

---

## ✅ Final Checklist

### Stripe Integration
- [ ] Stripe account created and verified
- [ ] Test API keys obtained
- [ ] Environment variables set (local)
- [ ] Payment flow tested locally
- [ ] Application deployed
- [ ] Production webhook configured
- [ ] Live API keys set (production)
- [ ] Production payment tested

### Shippo Integration
- [ ] Shippo account created
- [ ] Billing information added
- [ ] At least one carrier connected
- [ ] Test API key obtained
- [ ] Environment variables set (local)
- [ ] Rates API tested
- [ ] Label purchase tested
- [ ] Live API key set (production)
- [ ] Production label purchase tested

### Complete Integration
- [ ] End-to-end flow tested
- [ ] Error handling verified
- [ ] Tracking functionality tested
- [ ] Documentation reviewed
- [ ] Team trained on usage

---

## 📞 Support

### Stripe Support
- **Email**: support@stripe.com
- **Dashboard**: https://dashboard.stripe.com/support
- **Status**: https://status.stripe.com/

### Shippo Support
- **Email**: support@goshippo.com
- **Help Center**: https://support.goshippo.com/
- **Status**: https://status.goshippo.com/

---

**Last Updated**: [Current Date]
**Version**: 1.0


