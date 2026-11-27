# PSF lead popups (preview)

Open each HTML file in a browser (Live Server recommended) — the popup appears after ~1 second.

## Pricing lead (Google Sign-In → info@ via SMTP)

| File | Purpose |
|------|---------|
| `popup-pricing-lead-wordpress-embed.html` | “Want the latest prep pricing?” — Continue with Google (no typed email) |
| `psf-pricing-lead-smtp/` | WordPress plugin + install README (verify Google token + SMTP to info@) |

See `psf-pricing-lead-smtp/README.md` for install steps.

## CSS character / motion (no Lottie)

| File | Style |
|------|--------|
| `popup-a-split-character.html` | Split modal · animated warehouse character + boxes |
| `popup-b-orbit-boxes.html` | Center card · orbiting prep boxes |
| `popup-c-rocket-mascot.html` | Bottom sheet · flaming rocket mascot |

## Lottie variants (recommended)

| File | Lottie asset | Style |
|------|----------------|--------|
| `popup-d-lottie-delivery.html` | `lottie/delivery.json` | Split · courier / delivery loop |
| `popup-e-lottie-success.html` | `lottie/success.json` | Center card · success check |
| `popup-f-lottie-wave.html` | `lottie/scan.json` | Bottom sheet · friendly wave character |
| `popup-g-lottie-package.html` | `lottie/box.json` | Cream split · package / box |
| `popup-h-lottie-shipping.html` | `lottie/shipping.json` | Ink→cream card · shipping scene |

Player: `@lottiefiles/lottie-player` via unpkg. Animations are stored under `lottie/` so previews work offline.

**Buttons (all variants)**
- Get a Free Quote → `https://prepservicesfba.com/free-fulfillment-audit/`
- Book a Call with Arshad → `tel:+13476613010`

Dismiss is stored in `sessionStorage` (use “Show popup again” or a new tab).

### Elementor note

When you pick a winner, upload the matching JSON from `lottie/` to WordPress Media (or host it), then point `lottie-player` `src` at that absolute URL. Keep the player script tag in the HTML widget.
