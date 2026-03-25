# PrepCorex Shipping Calculator - Standalone HTML Widget Setup

## Why Use Standalone HTML Widget?

✅ **No Plugin Installation** - Just copy and paste  
✅ **Works Everywhere** - HTML widget, page builder, or theme  
✅ **No Updates Needed** - Self-contained code  
✅ **Easy to Customize** - All code in one place  
✅ **No Dependencies** - Pure HTML/CSS/JavaScript  

## Quick Setup (3 Steps)

### Step 1: Copy the Code

Open the file `standalone-calculator.html` and copy **ALL** the code inside it.

### Step 2: Add to WordPress

#### Option A: Custom HTML Widget
1. Go to **Appearance → Widgets**
2. Add a **"Custom HTML"** widget
3. Paste the entire code
4. Save

#### Option B: Page/Post Editor
1. Create or edit a page/post
2. Add a **"Custom HTML"** block
3. Paste the entire code
4. Publish

#### Option C: Page Builder (Elementor, Divi, etc.)
1. Add a **"HTML"** or **"Code"** widget
2. Paste the entire code
3. Save

### Step 3: Test It!

1. Visit the page/widget
2. Fill out the form
3. Click "Get Shipping Rates"
4. See the rate comparison table!

## That's It! 🎉

The calculator is now live on your site. No activation, no configuration needed.

## Customization

### Change the Title

Find this line in the code:
```html
<h2 class="psf-calc-title">Shipping Cost Calculator</h2>
```

Change to:
```html
<h2 class="psf-calc-title">Get Shipping Quotes</h2>
```

### Change Colors

Find the CSS section and modify:
- `#007bff` - Primary blue color
- `#28a745` - Success green color
- `#0056b3` - Darker blue for gradients

### Hide Title

Remove or comment out:
```html
<!-- <h2 class="psf-calc-title">Shipping Cost Calculator</h2> -->
```

## How It Works

1. **User fills form** → Origin, destination, package details
2. **JavaScript sends data** → To your Next.js API
3. **API gets rates** → From Shippo (all carriers)
4. **Results displayed** → Beautiful comparison table

## API Connection

The calculator connects to:
```
https://ims.prepservicesfba.com/api/shippo/rates
```

Make sure:
- ✅ CORS is configured (already done)
- ✅ API is accessible
- ✅ Shippo API key is set

## Troubleshooting

### Rates Not Showing
- Check browser console (F12) for errors
- Verify API endpoint is accessible
- Test API directly with Postman/curl

### Styling Issues
- Clear browser cache
- Check for theme CSS conflicts
- Verify all CSS is included in the code

### CORS Errors
- Make sure `prepservicesfba.com` is in allowed origins
- Check API response headers

## Advantages Over Plugin

| Feature | Standalone HTML | Plugin |
|---------|----------------|--------|
| Installation | Copy/paste | Upload & activate |
| Updates | Edit code | Update plugin |
| Portability | Works anywhere | WordPress only |
| Customization | Easy | Requires plugin knowledge |
| Dependencies | None | WordPress required |

## Support

If you need help:
1. Check browser console for errors
2. Verify API is working
3. Test with different addresses

---

**Version:** 1.0.0  
**Last Updated:** 2025
