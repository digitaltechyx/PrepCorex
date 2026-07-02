import nodemailer from "nodemailer";

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  fromName?: string;
};

function getSmtpConfig() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "PrepCorex";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dev.psfstockflow.com";

  if (!smtpHost || !smtpUser || !smtpPassword) {
    throw new Error("SMTP credentials are not configured.");
  }

  return { smtpHost, smtpPort, smtpUser, smtpPassword, smtpSecure, smtpFrom, smtpFromName, appUrl };
}

export async function sendTransactionalEmail(input: SendMailInput): Promise<void> {
  const cfg = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    requireTLS: !cfg.smtpSecure,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPassword,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  await transporter.verify();
  await transporter.sendMail({
    from: `${input.fromName || cfg.smtpFromName} <${cfg.smtpFrom}>`,
    to: input.to,
    replyTo: cfg.smtpFrom,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: {
      "X-Entity-Ref-ID": `prepcorex-${Date.now()}`,
    },
  });
}

export function getAppLoginUrl(): string {
  try {
    const cfg = getSmtpConfig();
    return `${cfg.appUrl.replace(/\/$/, "")}/login`;
  } catch {
    return "/login";
  }
}
