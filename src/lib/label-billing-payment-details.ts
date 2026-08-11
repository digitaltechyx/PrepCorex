/** Global ACH + Zelle details shown on wallet top-up (same for all users). */

export const LABEL_WALLET_ACH = {
  abaRoutingNumber: "091311229",
  bankName: "Choice Financial Group",
  bankNote: "Mercury uses Choice Financial Group as a banking partner.",
  bankAddress: "4501 23rd Avenue S, Fargo, ND 58104 US",
  beneficiaryName: "Prep Services FBA",
  accountNumber: "202578353457",
  accountKind: "Checking",
  beneficiaryAddress: "1762 Carriage Drive, Williamstown, NJ 08094 US",
} as const;

export const LABEL_WALLET_ZELLE = {
  recipientName: "ARSHAD IQBAL",
  phone: "+1 347 661 3010",
  qrImageSrc: "/label-billing/zelle-qr.png",
} as const;

export const LABEL_WALLET_TOPUP_DISCLAIMER =
  "For faster credit we prefer Zelle. ACH and bank transfers can take 1–3 business days. Delays may occur depending on your bank. Always include your warehouse / account phone so we can match your payment.";
