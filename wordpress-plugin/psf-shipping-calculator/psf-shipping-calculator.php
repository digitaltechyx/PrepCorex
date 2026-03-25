<?php
/**
 * Plugin Name: PrepCorex Shipping Cost Calculator
 * Plugin URI: https://prepservicesfba.com
 * Description: A comprehensive shipping cost calculator that compares rates from multiple carriers (USPS, UPS, FedEx, DHL) - similar to ShipHype.
 * Version: 1.0.0
 * Author: PrepCorex
 * Author URI: https://prepservicesfba.com
 * License: GPL v2 or later
 * Text Domain: psf-shipping-calculator
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

// Define plugin constants
define('PSF_SC_VERSION', '1.0.0');
define('PSF_SC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PSF_SC_PLUGIN_URL', plugin_dir_url(__FILE__));

class PSF_Shipping_Calculator {
    
    private static $instance = null;
    
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('init', array($this, 'init'));
        add_shortcode('psf_shipping_calculator', array($this, 'render_calculator'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_scripts'));
    }
    
    public function init() {
        // Plugin initialization
    }
    
    public function enqueue_scripts() {
        // Only load on pages with the shortcode
        global $post;
        if (is_a($post, 'WP_Post') && has_shortcode($post->post_content, 'psf_shipping_calculator')) {
            wp_enqueue_style(
                'psf-shipping-calculator-css',
                PSF_SC_PLUGIN_URL . 'assets/css/calculator.css',
                array(),
                PSF_SC_VERSION
            );
            
            wp_enqueue_script(
                'psf-shipping-calculator-js',
                PSF_SC_PLUGIN_URL . 'assets/js/calculator.js',
                array('jquery'),
                PSF_SC_VERSION,
                true
            );
            
            // Localize script with API endpoint
            wp_localize_script('psf-shipping-calculator-js', 'psfShippingCalc', array(
                'apiUrl' => 'https://ims.prepservicesfba.com/api/shippo/rates',
                'nonce' => wp_create_nonce('psf_shipping_calc_nonce'),
            ));
        }
    }
    
    public function render_calculator($atts) {
        $atts = shortcode_atts(array(
            'title' => 'Shipping Cost Calculator',
            'show_title' => 'yes',
        ), $atts);
        
        ob_start();
        include PSF_SC_PLUGIN_DIR . 'templates/calculator-form.php';
        return ob_get_clean();
    }
}

// Initialize the plugin
function psf_shipping_calculator_init() {
    return PSF_Shipping_Calculator::get_instance();
}

// Start the plugin
psf_shipping_calculator_init();
