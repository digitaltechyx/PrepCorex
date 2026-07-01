function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="background:linear-gradient(135deg,#4338ca,#6366f1);padding:24px 28px;">
              <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.85);">PrepCorex</p>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#ffffff;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;font-size:12px;line-height:1.6;color:#6b7280;">
              Prep Services FBA LLC · PrepCorex Client Portal<br />
              This is a transactional message about your account. Please do not reply to automated notices unless you need support.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildWelcomeAccountEmail(input: {
  contactName: string;
  companyName: string;
  loginUrl: string;
}) {
  const subject = "Welcome to PrepCorex — your account is under review";
  const text = `Hello ${input.contactName},

Welcome to PrepCorex.

Your account for ${input.companyName} has been created successfully and is currently under review by our team.

Most accounts are reviewed within 1 business day. Once approved, we will send you another email and you can sign in here:
${input.loginUrl}

Thank you for choosing Prep Services FBA.

PrepCorex Team`;

  const html = emailShell(
    "Welcome to PrepCorex",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hello <strong>${input.contactName}</strong>,</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Thank you for creating your PrepCorex account for <strong>${input.companyName}</strong>.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Your registration was received successfully. Your account is now <strong>under review</strong>. Our team typically completes reviews within <strong>1 business day</strong>.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">When your account is approved, we will email you again with login instructions. You do not need to take any further action right now.</p>
<p style="margin:0 0 24px;">
  <a href="${input.loginUrl}" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Go to Login</a>
</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">We appreciate your business,<br /><strong>PrepCorex Team</strong></p>`
  );

  return { subject, text, html };
}

export function buildAccountApprovedEmail(input: {
  contactName: string;
  companyName: string;
  loginUrl: string;
}) {
  const subject = "Your PrepCorex account has been approved";
  const text = `Hello ${input.contactName},

Good news — your PrepCorex account for ${input.companyName} has been approved.

Sign in to complete your profile and accept the Master Service Agreement:
${input.loginUrl}

Welcome aboard,
PrepCorex Team`;

  const html = emailShell(
    "Your account is approved",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hello <strong>${input.contactName}</strong>,</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Good news — your PrepCorex account for <strong>${input.companyName}</strong> has been <strong>approved</strong>.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Sign in to complete your business profile, review the Master Service Agreement, and activate your account.</p>
<p style="margin:0 0 24px;">
  <a href="${input.loginUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">Sign in to PrepCorex</a>
</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">Welcome aboard,<br /><strong>PrepCorex Team</strong></p>`
  );

  return { subject, text, html };
}
