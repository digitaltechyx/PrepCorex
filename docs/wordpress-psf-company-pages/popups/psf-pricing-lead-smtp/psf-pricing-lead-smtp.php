<?php
/**
 * Plugin Name: PSF Pricing Lead SMTP
 * Description: Receives Google One Tap / Sign-In pricing leads and emails them to info@prepservicesfba.com via SMTP.
 * Version: 1.1.0
 * Author: Prep Services FBA
 *
 * Install:
 * 1) Upload this folder to wp-content/plugins/psf-pricing-lead-smtp/ and activate,
 *    OR copy this file to wp-content/mu-plugins/psf-pricing-lead-smtp.php
 * 2) Add SMTP + Google Client ID constants to wp-config.php (see README).
 * 3) Paste popup-pricing-lead-wordpress-embed.html into an Elementor HTML widget (footer).
 */

if (!defined('ABSPATH')) {
  exit;
}

/** Where lead notifications are delivered. */
if (!defined('PSF_PRICING_LEAD_TO')) {
  define('PSF_PRICING_LEAD_TO', 'info@prepservicesfba.com');
}

add_action('wp_enqueue_scripts', function () {
  $data = [
    'ajaxUrl' => admin_url('admin-ajax.php'),
    'nonce' => wp_create_nonce('psf_pricing_lead'),
    'googleClientId' => defined('PSF_GOOGLE_CLIENT_ID') ? PSF_GOOGLE_CLIENT_ID : '',
  ];
  wp_register_script('psf-pricing-lead-bridge', false, [], null, true);
  wp_enqueue_script('psf-pricing-lead-bridge');
  wp_add_inline_script(
    'psf-pricing-lead-bridge',
    'window.psfPricingLead = ' . wp_json_encode($data) . ';',
    'before'
  );
});

/**
 * Configure PHPMailer SMTP when constants are set in wp-config.php.
 * If you already use WP Mail SMTP plugin, you can leave constants unset
 * and this plugin will still call wp_mail() through that plugin.
 */
add_action('phpmailer_init', function ($phpmailer) {
  if (!defined('PSF_LEAD_SMTP_HOST') || !PSF_LEAD_SMTP_HOST) {
    return;
  }
  $phpmailer->isSMTP();
  $phpmailer->Host = PSF_LEAD_SMTP_HOST;
  $phpmailer->Port = defined('PSF_LEAD_SMTP_PORT') ? (int) PSF_LEAD_SMTP_PORT : 465;
  $phpmailer->SMTPAuth = true;
  $phpmailer->Username = defined('PSF_LEAD_SMTP_USER') ? PSF_LEAD_SMTP_USER : '';
  $phpmailer->Password = defined('PSF_LEAD_SMTP_PASS') ? PSF_LEAD_SMTP_PASS : '';
  $secure = defined('PSF_LEAD_SMTP_SECURE') ? PSF_LEAD_SMTP_SECURE : 'ssl';
  if ($secure) {
    $phpmailer->SMTPSecure = $secure; // 'ssl' or 'tls'
  }
  $from = defined('PSF_LEAD_SMTP_FROM') ? PSF_LEAD_SMTP_FROM : (defined('PSF_LEAD_SMTP_USER') ? PSF_LEAD_SMTP_USER : get_option('admin_email'));
  $fromName = defined('PSF_LEAD_SMTP_FROM_NAME') ? PSF_LEAD_SMTP_FROM_NAME : 'Prep Services FBA';
  $phpmailer->setFrom($from, $fromName, false);
});

/**
 * Verify Google ID token and return email + name, or WP_Error.
 */
function psf_pricing_lead_verify_google_credential($credential) {
  if (!defined('PSF_GOOGLE_CLIENT_ID') || !PSF_GOOGLE_CLIENT_ID) {
    return new WP_Error('no_client', 'Google Client ID is not configured on the server.');
  }

  $credential = is_string($credential) ? trim($credential) : '';
  if ($credential === '' || strlen($credential) > 4096) {
    return new WP_Error('bad_token', 'Invalid Google sign-in token.');
  }

  $url = add_query_arg(
    ['id_token' => $credential],
    'https://oauth2.googleapis.com/tokeninfo'
  );

  $response = wp_remote_get($url, [
    'timeout' => 12,
    'redirection' => 0,
  ]);

  if (is_wp_error($response)) {
    return new WP_Error('google_unreachable', 'Could not verify Google account. Try again.');
  }

  $code = (int) wp_remote_retrieve_response_code($response);
  $body = json_decode(wp_remote_retrieve_body($response), true);
  if ($code !== 200 || !is_array($body)) {
    return new WP_Error('bad_token', 'Google sign-in expired or invalid. Please try again.');
  }

  $aud = isset($body['aud']) ? (string) $body['aud'] : '';
  if (!hash_equals((string) PSF_GOOGLE_CLIENT_ID, $aud)) {
    return new WP_Error('aud_mismatch', 'Google Client ID mismatch. Check PSF_GOOGLE_CLIENT_ID.');
  }

  $email = isset($body['email']) ? sanitize_email($body['email']) : '';
  if (!$email || !is_email($email)) {
    return new WP_Error('no_email', 'Google did not share an email for this account.');
  }

  // Prefer verified emails only.
  if (isset($body['email_verified']) && !in_array($body['email_verified'], [true, 'true', '1', 1], true)) {
    return new WP_Error('unverified', 'Please use a verified Google account.');
  }

  $name = '';
  if (!empty($body['name'])) {
    $name = sanitize_text_field($body['name']);
  } elseif (!empty($body['given_name'])) {
    $name = sanitize_text_field($body['given_name']);
  }

  return [
    'email' => $email,
    'name' => $name,
  ];
}

function psf_pricing_lead_handle() {
  $nonce = isset($_POST['nonce']) ? sanitize_text_field(wp_unslash($_POST['nonce'])) : '';
  if (!$nonce || !wp_verify_nonce($nonce, 'psf_pricing_lead')) {
    wp_send_json_error(['message' => 'Session expired. Refresh the page and try again.'], 403);
  }

  $credential = isset($_POST['credential']) ? wp_unslash($_POST['credential']) : '';
  $pageUrl = isset($_POST['pageUrl']) ? esc_url_raw(wp_unslash($_POST['pageUrl'])) : '';

  $identity = psf_pricing_lead_verify_google_credential($credential);
  if (is_wp_error($identity)) {
    wp_send_json_error(['message' => $identity->get_error_message()], 400);
  }

  $email = $identity['email'];
  $name = $identity['name'];

  // Basic rate limit by IP (transient).
  $ip = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : 'unknown';
  $rateKey = 'psf_pl_' . md5($ip . '|' . strtolower($email));
  if (get_transient($rateKey)) {
    wp_send_json_error(['message' => 'You already submitted recently. Please wait a few minutes.'], 429);
  }
  set_transient($rateKey, 1, 10 * MINUTE_IN_SECONDS);

  $to = PSF_PRICING_LEAD_TO;
  $subject = 'New pricing lead — Prep Services FBA website';
  $lines = [
    'A visitor requested the latest prep pricing via Google Sign-In.',
    '',
    'Name: ' . ($name !== '' ? $name : '(not provided by Google)'),
    'Email: ' . $email,
    'Page: ' . ($pageUrl !== '' ? $pageUrl : '(unknown)'),
    'Time: ' . gmdate('Y-m-d H:i:s') . ' UTC',
    'IP: ' . $ip,
    'Source: Google One Tap / Sign in with Google',
  ];
  $body = implode("\n", $lines);

  $headers = [
    'Content-Type: text/plain; charset=UTF-8',
    'Reply-To: ' . ($name !== '' ? sprintf('%s <%s>', $name, $email) : $email),
  ];

  $sent = wp_mail($to, $subject, $body, $headers);
  if (!$sent) {
    wp_send_json_error(['message' => 'Email failed to send. Check SMTP settings or contact support.'], 500);
  }

  // Optional auto-reply to the visitor (same SMTP).
  if (!defined('PSF_PRICING_LEAD_AUTOREPLY') || PSF_PRICING_LEAD_AUTOREPLY) {
    $visitorSubject = 'Thanks — Prep Services FBA pricing request received';
    $visitorBody = implode("\n", [
      $name !== '' ? ('Hi ' . $name . ',') : 'Hi,',
      '',
      'Thanks for requesting our latest prep pricing. Our team will follow up shortly.',
      '',
      'If you need anything sooner, reply to this email or write info@prepservicesfba.com.',
      '',
      '— Prep Services FBA',
    ]);
    wp_mail($email, $visitorSubject, $visitorBody, ['Content-Type: text/plain; charset=UTF-8']);
  }

  wp_send_json_success([
    'message' => 'Sent',
    'email' => $email,
  ]);
}

add_action('wp_ajax_psf_pricing_lead', 'psf_pricing_lead_handle');
add_action('wp_ajax_nopriv_psf_pricing_lead', 'psf_pricing_lead_handle');
