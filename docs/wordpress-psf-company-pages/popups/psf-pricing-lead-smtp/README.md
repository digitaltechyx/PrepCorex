# Pricing lead popup + Google Sign-In + SMTP (Prep Services FBA)

Visitor taps **Continue with Google** (One Tap / button). Email comes from Google — **no typing**. Lead is emailed to **info@prepservicesfba.com** via SMTP.

## Files

| File | Purpose |
|------|---------|
| `../popup-pricing-lead-wordpress-embed.html` | Popup UI — paste into Elementor HTML widget |
| `psf-pricing-lead-smtp.php` | Verifies Google ID token + sends mail |

## Install (WordPress)

### 1) Google OAuth Client (required)

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials  
2. Create **OAuth client ID** → Application type **Web application**  
3. **Authorized JavaScript origins** (add all you use):
   - `https://prepservicesfba.com`
   - `https://www.prepservicesfba.com`
4. Copy the **Client ID** (looks like `….apps.googleusercontent.com`)  
5. Under OAuth consent screen, add scopes if prompted: `email`, `profile`, `openid`

You can reuse an existing Web client if those origins are already listed.

### 2) Plugin

1. Upload folder `psf-pricing-lead-smtp` to `wp-content/plugins/`
2. Activate **PSF Pricing Lead SMTP** in WP Admin → Plugins  
   *(Or copy `psf-pricing-lead-smtp.php` into `wp-content/mu-plugins/`)*

### 3) Constants in `wp-config.php`

Add **above** `/* That's all, stop editing! */`:

```php
// Google Sign-In (no typed email)
define('PSF_GOOGLE_CLIENT_ID', 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com');

// SMTP → info@
define('PSF_LEAD_SMTP_HOST', 'smtp.hostinger.com');
define('PSF_LEAD_SMTP_PORT', 465);
define('PSF_LEAD_SMTP_SECURE', 'ssl'); // or 'tls'
define('PSF_LEAD_SMTP_USER', 'info@prepservicesfba.com');
define('PSF_LEAD_SMTP_PASS', 'YOUR_SMTP_PASSWORD_HERE');
define('PSF_LEAD_SMTP_FROM', 'info@prepservicesfba.com');
define('PSF_LEAD_SMTP_FROM_NAME', 'Prep Services FBA');
define('PSF_PRICING_LEAD_TO', 'info@prepservicesfba.com');
// define('PSF_PRICING_LEAD_AUTOREPLY', false); // optional: disable visitor auto-reply
```

**Alternative:** If **WP Mail SMTP** is already configured, you can skip the `PSF_LEAD_SMTP_*` constants — `wp_mail()` will use that plugin. You still need `PSF_GOOGLE_CLIENT_ID`.

### 4) Popup embed

1. Elementor → site-wide footer (or Theme Builder footer)
2. Add an **HTML** widget
3. Paste the full contents of `popup-pricing-lead-wordpress-embed.html`
4. Publish

## Visitor experience

1. After ~2.5s, popup: **Want the latest prep pricing?**
2. Primary: Google **Continue with Google** button (+ One Tap when Google allows it)
3. Secondary: **No thanks** / close
4. On success → team gets email at `info@…`; visitor gets a short auto-reply
5. Dismiss is remembered for the browser tab (`sessionStorage`)

## Test checklist

- [ ] Plugin active  
- [ ] `PSF_GOOGLE_CLIENT_ID` set + JS origins include your live domain  
- [ ] SMTP constants set (or WP Mail SMTP working)  
- [ ] Popup shows Google button (no email text field)  
- [ ] Continue with Google → inbox at info@prepservicesfba.com  
- [ ] Auto-reply arrives at the Google account email  
