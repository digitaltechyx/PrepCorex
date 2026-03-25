# PrepCorex Shipping Cost Calculator WordPress Plugin

A comprehensive shipping cost calculator plugin for WordPress that compares rates from multiple carriers (USPS, UPS, FedEx, DHL) - similar to ShipHype.

## Features

- ✅ Compare shipping rates from multiple carriers (USPS, UPS, FedEx, DHL)
- ✅ Real-time rate calculation via Next.js API
- ✅ Beautiful, responsive design
- ✅ Easy shortcode integration
- ✅ Form validation
- ✅ Error handling
- ✅ Best rate highlighting
- ✅ Delivery time estimates

## Installation

1. Upload the `psf-shipping-calculator` folder to `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Use the shortcode `[psf_shipping_calculator]` on any page or post

## Usage

### Basic Shortcode
```
[psf_shipping_calculator]
```

### Shortcode with Custom Title
```
[psf_shipping_calculator title="Get Shipping Quotes" show_title="yes"]
```

### Parameters
- `title` - Custom title for the calculator (default: "Shipping Cost Calculator")
- `show_title` - Show/hide the title (default: "yes")

## Requirements

- WordPress 5.0 or higher
- PHP 7.4 or higher
- jQuery (usually included with WordPress)
- Access to Next.js API: `https://ims.prepservicesfba.com/api/shippo/rates`

## API Configuration

The plugin connects to your Next.js API endpoint. Make sure:
1. CORS is properly configured on the API to allow requests from `prepservicesfba.com`
2. The API endpoint is accessible: `https://ims.prepservicesfba.com/api/shippo/rates`

## File Structure

```
psf-shipping-calculator/
├── psf-shipping-calculator.php (Main plugin file)
├── templates/
│   └── calculator-form.php (Form template)
├── assets/
│   ├── css/
│   │   └── calculator.css (Styles)
│   └── js/
│       └── calculator.js (JavaScript functionality)
└── README.md
```

## Support

For support, contact: https://prepservicesfba.com

## License

GPL v2 or later
