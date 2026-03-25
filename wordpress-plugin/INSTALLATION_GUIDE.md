# PrepCorex Shipping Calculator - Installation Guide

## Overview

This WordPress plugin creates a comprehensive shipping cost calculator (similar to ShipHype) that compares rates from multiple carriers (USPS, UPS, FedEx, DHL) by connecting to your Next.js API.

## What's Included

✅ **Full shipping cost calculator** - Not just label rates, but actual shipping cost comparison
✅ **Multi-carrier comparison** - Shows rates from USPS, UPS, FedEx, and DHL
✅ **Beautiful UI** - Modern, responsive design similar to ShipHype
✅ **Easy integration** - Simple shortcode: `[psf_shipping_calculator]`
✅ **Real-time rates** - Connects to your Next.js API for live rate calculation

## Installation Steps

### Step 1: Upload Plugin to WordPress

1. **Via FTP/cPanel:**
   - Upload the entire `psf-shipping-calculator` folder to:
     `/wp-content/plugins/psf-shipping-calculator/`
   - Make sure the folder structure is:
     ```
     wp-content/plugins/psf-shipping-calculator/
     ├── psf-shipping-calculator.php
     ├── templates/
     ├── assets/
     └── README.md
     ```

2. **Via WordPress Admin:**
   - Go to Plugins → Add New → Upload Plugin
   - Zip the `psf-shipping-calculator` folder
   - Upload and install

### Step 2: Activate Plugin

1. Go to WordPress Admin → Plugins
2. Find "PrepCorex Shipping Cost Calculator"
3. Click "Activate"

### Step 3: Verify API Connection

The plugin connects to: `https://ims.prepservicesfba.com/api/shippo/rates`

**Important:** Make sure:
- ✅ CORS is configured on your Next.js API (already done)
- ✅ The API endpoint is accessible
- ✅ Your WordPress site domain is in the allowed origins list

### Step 4: Add Calculator to Your Site

#### Option A: Using Shortcode on a Page

1. Create a new page or edit an existing one
2. Add the shortcode:
   ```
   [psf_shipping_calculator]
   ```
3. Publish the page

#### Option B: Using Shortcode in Widget

1. Go to Appearance → Widgets
2. Add a "Shortcode" widget
3. Enter: `[psf_shipping_calculator]`
4. Save

#### Option C: Using in Theme Template

Add to your theme's PHP file:
```php
<?php echo do_shortcode('[psf_shipping_calculator]'); ?>
```

## Customization

### Custom Title
```
[psf_shipping_calculator title="Get Shipping Quotes"]
```

### Hide Title
```
[psf_shipping_calculator show_title="no"]
```

## How It Works

1. **User fills out the form:**
   - From Address (origin)
   - To Address (destination)
   - Package dimensions and weight

2. **Form submits to Next.js API:**
   - API creates a shipment in Shippo
   - Gets rates from all available carriers
   - Returns formatted rates with markup

3. **Plugin displays results:**
   - Shows all available rates in a comparison table
   - Highlights the best (lowest) rate
   - Displays carrier logos, service names, prices, and delivery times

## Features

### Rate Comparison Table
- **Carrier Column:** Shows carrier logo and name
- **Service Column:** Displays service level (Priority Mail, Ground, Express, etc.)
- **Price Column:** Shows shipping cost with currency
- **Delivery Time:** Estimated delivery days
- **Best Rate Badge:** Highlights the lowest price option

### User Experience
- ✅ Form validation
- ✅ Loading states
- ✅ Error handling
- ✅ Responsive design (mobile-friendly)
- ✅ Smooth scrolling to results

## Testing

1. **Test the calculator:**
   - Go to the page with the shortcode
   - Fill out the form with test data
   - Click "Get Shipping Rates"
   - Verify rates are displayed correctly

2. **Test different scenarios:**
   - Different origin/destination addresses
   - Various package sizes and weights
   - International addresses (if supported)

## Troubleshooting

### No Rates Showing
- Check browser console for errors
- Verify API endpoint is accessible
- Check CORS configuration
- Ensure Shippo API key is configured

### CORS Errors
- Make sure `prepservicesfba.com` is in allowed origins
- Check API response headers include CORS headers

### Styling Issues
- Clear WordPress cache
- Check for theme CSS conflicts
- Verify CSS file is loading (check browser DevTools)

## API Requirements

Your Next.js API must:
- Accept POST requests to `/api/shippo/rates`
- Accept JSON body with: `fromAddress`, `toAddress`, `parcel`
- Return JSON with: `rates` array and `shipment_id`
- Include CORS headers for `prepservicesfba.com`

## Support

For issues or questions:
- Check the plugin README.md
- Review API logs
- Contact: https://prepservicesfba.com

## Next Steps

After installation:
1. ✅ Test the calculator on your site
2. ✅ Customize the title/styling if needed
3. ✅ Add to your main pages
4. ✅ Monitor API usage and performance

---

**Plugin Version:** 1.0.0  
**Compatible with:** WordPress 5.0+  
**PHP Required:** 7.4+
