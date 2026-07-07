import nodemailer from "nodemailer";

export type SendServerEmailInput = {
  to: string;
  subject: string;
  message: string;
};

export async function sendServerEmail(input: SendServerEmailInput): Promise<void> {
  const to = input.to.trim();
  if (!to) throw new Error("Missing recipient email.");

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "Prep Services FBA";

  if (!smtpHost || !smtpUser || !smtpPassword) {
    throw new Error("SMTP credentials are not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  await transporter.verify();
  await transporter.sendMail({
    from: smtpFromName ? `${smtpFromName} <${smtpFrom}>` : smtpFrom,
    to,
    subject: input.subject,
    text: input.message,
  });
}
