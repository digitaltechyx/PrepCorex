import type { LabelBillingPeriod, LabelBillingSettings } from "@/types";

export const LABEL_BILLING_DEFAULT_LIMIT_CENTS = 5000; // $50
export const LABEL_BILLING_DEFAULT_PERIOD: LabelBillingPeriod = "monthly";

export const LABEL_WALLET_TOPUP_COLLECTION = "labelWalletTopupRequests";
export const LABEL_WALLET_LEDGER_COLLECTION = "labelWalletLedger";

export function labelWalletTopupPath(userId: string): string {
  return `users/${userId}/${LABEL_WALLET_TOPUP_COLLECTION}`;
}

export function labelWalletLedgerPath(userId: string): string {
  return `users/${userId}/${LABEL_WALLET_LEDGER_COLLECTION}`;
}

export function formatLabelBillingPeriod(period?: LabelBillingPeriod | null): string {
  switch (period) {
    case "daily":
      return "daily";
    case "weekly":
      return "weekly";
    case "yearly":
      return "yearly";
    case "monthly":
    default:
      return "monthly";
  }
}

/** Title-case period noun for UI labels (Day / Week / Month / Year). */
export function formatLabelBillingPeriodNoun(period?: LabelBillingPeriod | null): string {
  switch (period) {
    case "daily":
      return "Day";
    case "weekly":
      return "Week";
    case "yearly":
      return "Year";
    case "monthly":
    default:
      return "Month";
  }
}

/** Title-case adjective for spend-limit labels (Daily / Weekly / Monthly / Yearly). */
export function formatLabelBillingPeriodAdjective(period?: LabelBillingPeriod | null): string {
  switch (period) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "yearly":
      return "Yearly";
    case "monthly":
    default:
      return "Monthly";
  }
}

export function formatLabelBillingMoney(cents: number, currency = "usd"): string {
  const cur = (currency || "usd").toUpperCase();
  return `${cur} $${(Math.max(0, Math.floor(cents || 0)) / 100).toFixed(2)}`;
}

/** Signed ledger amount: `+USD $20.00`, `-USD $50.00`, or `USD $0.00`. */
export function formatSignedLabelBillingMoney(cents: number, currency = "usd"): string {
  const amount = Math.floor(Number(cents) || 0);
  const body = formatLabelBillingMoney(Math.abs(amount), currency);
  if (amount > 0) return `+${body}`;
  if (amount < 0) return `-${body}`;
  return body;
}

/** Calendar period key in local timezone of the provided Date (server should pass now). */
export function labelBillingPeriodKey(period: LabelBillingPeriod, now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  if (period === "daily") return `${y}-${m}-${d}`;
  if (period === "yearly") return `${y}`;
  if (period === "weekly") {
    // ISO week (Mon-start)
    const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return `${y}-${m}`;
}

/** Next calendar boundary when the current period ends (exclusive end → display as last moment of period). */
export function labelBillingPeriodEndsAt(period: LabelBillingPeriod, now = new Date()): Date {
  if (period === "daily") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  }
  if (period === "weekly") {
    const day = now.getDay(); // 0 Sun
    const daysUntilMon = day === 0 ? 1 : 8 - day;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon, 0, 0, 0, 0);
  }
  if (period === "yearly") {
    return new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

export function normalizeLabelBillingSettings(
  raw: Partial<LabelBillingSettings> | null | undefined,
  now = new Date()
): LabelBillingSettings {
  const mode = raw?.mode === "wallet" ? "wallet" : "limit";
  const period: LabelBillingPeriod =
    raw?.period === "daily" ||
    raw?.period === "weekly" ||
    raw?.period === "yearly" ||
    raw?.period === "monthly"
      ? raw.period
      : LABEL_BILLING_DEFAULT_PERIOD;
  const limitAmountCents = Math.max(
    0,
    Math.floor(
      Number.isFinite(Number(raw?.limitAmountCents))
        ? Number(raw?.limitAmountCents)
        : LABEL_BILLING_DEFAULT_LIMIT_CENTS
    )
  );
  const currentKey = labelBillingPeriodKey(period, now);
  const storedKey = String(raw?.periodKey || "").trim();
  const rolled = !storedKey || storedKey !== currentKey;
  const periodUsedCents = rolled
    ? 0
    : Math.max(0, Math.floor(Number(raw?.periodUsedCents) || 0));
  const walletBalanceCents = Math.max(0, Math.floor(Number(raw?.walletBalanceCents) || 0));

  return {
    mode,
    limitAmountCents:
      limitAmountCents > 0 ? limitAmountCents : LABEL_BILLING_DEFAULT_LIMIT_CENTS,
    period,
    periodUsedCents,
    periodKey: currentKey,
    walletBalanceCents,
  };
}

export function labelBillingRemainingCents(settings: LabelBillingSettings): number {
  return Math.max(0, settings.limitAmountCents - settings.periodUsedCents);
}

export type LabelPurchaseGateResult =
  | { ok: true; settings: LabelBillingSettings }
  | { ok: false; error: string; code: "LIMIT_EXCEEDED" | "WALLET_INSUFFICIENT" | "WALLET_PERIOD_LIMIT" | "WRONG_MODE" };

/** Gate a spend of `amountCents` against current billing settings (already normalized / rolled). */
export function canSpendLabelBilling(
  settings: LabelBillingSettings,
  amountCents: number,
  opts?: { preferWallet?: boolean }
): LabelPurchaseGateResult {
  const amount = Math.max(0, Math.floor(amountCents || 0));
  if (amount < 1) {
    return { ok: false, error: "Invalid purchase amount.", code: "LIMIT_EXCEEDED" };
  }

  if (settings.mode === "limit") {
    if (opts?.preferWallet) {
      return {
        ok: false,
        error: "This account uses a purchase limit, not wallet balance.",
        code: "WRONG_MODE",
      };
    }
    if (settings.periodUsedCents + amount > settings.limitAmountCents) {
      const left = labelBillingRemainingCents(settings);
      return {
        ok: false,
        error: `Trial label purchase limit reached. Remaining this ${formatLabelBillingPeriod(settings.period)}: ${formatLabelBillingMoney(left)}. Contact an administrator to raise your limit.`,
        code: "LIMIT_EXCEEDED",
      };
    }
    return { ok: true, settings };
  }

  // wallet
  if ((settings.walletBalanceCents || 0) < amount) {
    return {
      ok: false,
      error: `Insufficient wallet balance. Available: ${formatLabelBillingMoney(settings.walletBalanceCents || 0)}. Please top up.`,
      code: "WALLET_INSUFFICIENT",
    };
  }
  if (settings.periodUsedCents + amount > settings.limitAmountCents) {
    const left = labelBillingRemainingCents(settings);
    return {
      ok: false,
      error: `Wallet ${formatLabelBillingPeriod(settings.period)} spend limit reached. Remaining: ${formatLabelBillingMoney(left)}.`,
      code: "WALLET_PERIOD_LIMIT",
    };
  }
  return { ok: true, settings };
}

export function labelBillingSummaryLine(settings: LabelBillingSettings): string {
  const period = formatLabelBillingPeriod(settings.period);
  const limit = formatLabelBillingMoney(settings.limitAmountCents);
  const used = formatLabelBillingMoney(settings.periodUsedCents);
  const left = formatLabelBillingMoney(labelBillingRemainingCents(settings));
  if (settings.mode === "wallet") {
    return `Your wallet ${period} limit is ${limit} · Used ${used} · Left ${left} · Balance ${formatLabelBillingMoney(settings.walletBalanceCents || 0)}`;
  }
  return `Trial limit ${limit} / ${period} · Used ${used} · Left ${left}`;
}
