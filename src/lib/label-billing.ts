import type {
  LabelApiFeeCadence,
  LabelApiFeeSettings,
  LabelBillingPeriod,
  LabelBillingSettings,
} from "@/types";

export const LABEL_BILLING_DEFAULT_LIMIT_CENTS = 2000; // $20
export const LABEL_BILLING_DEFAULT_PERIOD: LabelBillingPeriod = "monthly";
/** Default Buy Labels rate markup ($0.15). */
export const LABEL_BILLING_DEFAULT_MARKUP_CENTS = 15;
/** Monthly API fee access window (30 days). */
export const LABEL_API_FEE_MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;
/** Buy Label trial window (30 days from `trialStartedAtIso`). */
export const LABEL_TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type LabelPaymentSource = "trial" | "wallet";

export const LABEL_WALLET_TOPUP_COLLECTION = "labelWalletTopupRequests";
export const LABEL_WALLET_LEDGER_COLLECTION = "labelWalletLedger";
export const LABEL_API_FEE_PAYMENT_COLLECTION = "labelApiFeePaymentRequests";

export function labelWalletTopupPath(userId: string): string {
  return `users/${userId}/${LABEL_WALLET_TOPUP_COLLECTION}`;
}

export function labelWalletLedgerPath(userId: string): string {
  return `users/${userId}/${LABEL_WALLET_LEDGER_COLLECTION}`;
}

export function labelApiFeePaymentPath(userId: string): string {
  return `users/${userId}/${LABEL_API_FEE_PAYMENT_COLLECTION}`;
}

export function defaultLabelApiFeeSettings(): LabelApiFeeSettings {
  return {
    enabled: false,
    cadence: "monthly",
    amountCents: 0,
    status: "unpaid",
    paidAtIso: null,
    paidUntilIso: null,
    lastPaymentRequestId: null,
    lastRejectionReason: null,
  };
}

export function normalizeLabelApiFeeSettings(
  raw: Partial<LabelApiFeeSettings> | null | undefined,
  now = new Date()
): LabelApiFeeSettings {
  const base = defaultLabelApiFeeSettings();
  const enabled = raw?.enabled === true;
  const cadence: LabelApiFeeCadence = raw?.cadence === "onetime" ? "onetime" : "monthly";
  const amountCents = Math.max(0, Math.floor(Number(raw?.amountCents) || 0));
  let status = raw?.status;
  if (
    status !== "unpaid" &&
    status !== "pending" &&
    status !== "paid" &&
    status !== "rejected"
  ) {
    status = "unpaid";
  }
  const paidAtIso = raw?.paidAtIso ? String(raw.paidAtIso) : null;
  let paidUntilIso = raw?.paidUntilIso ? String(raw.paidUntilIso) : null;

  if (enabled && cadence === "monthly" && status === "paid" && paidUntilIso) {
    const until = Date.parse(paidUntilIso);
    if (Number.isFinite(until) && until <= now.getTime()) {
      status = "unpaid";
      paidUntilIso = null;
    }
  }

  if (!enabled) {
    return {
      ...base,
      enabled: false,
      cadence,
      amountCents,
      status: "unpaid",
      paidAtIso: null,
      paidUntilIso: null,
      lastPaymentRequestId: raw?.lastPaymentRequestId
        ? String(raw.lastPaymentRequestId)
        : null,
      lastRejectionReason: null,
    };
  }

  return {
    enabled: true,
    cadence,
    amountCents,
    status,
    paidAtIso,
    paidUntilIso,
    lastPaymentRequestId: raw?.lastPaymentRequestId
      ? String(raw.lastPaymentRequestId)
      : null,
    lastRejectionReason: raw?.lastRejectionReason
      ? String(raw.lastRejectionReason).slice(0, 500)
      : null,
  };
}

/** True when Buy Labels must stay blocked until the API fee is paid. */
export function isLabelApiFeeBlocking(
  settings: Pick<LabelBillingSettings, "apiFee"> | null | undefined,
  now = new Date()
): boolean {
  const fee = normalizeLabelApiFeeSettings(settings?.apiFee, now);
  if (!fee.enabled) return false;
  if (fee.amountCents < 1) return false;
  if (fee.status === "pending") return true;
  if (fee.cadence === "onetime") return fee.status !== "paid";
  if (fee.status === "paid" && fee.paidUntilIso) {
    const until = Date.parse(fee.paidUntilIso);
    return !(Number.isFinite(until) && until > now.getTime());
  }
  return true;
}

export function labelApiFeePaidUntilAfterPayment(now = new Date()): string {
  return new Date(now.getTime() + LABEL_API_FEE_MONTHLY_MS).toISOString();
}

export function applyLabelApiFeePaid(
  fee: LabelApiFeeSettings,
  now = new Date()
): LabelApiFeeSettings {
  const paidAtIso = now.toISOString();
  if (fee.cadence === "onetime") {
    return {
      ...fee,
      status: "paid",
      paidAtIso,
      paidUntilIso: null,
      lastRejectionReason: null,
    };
  }
  return {
    ...fee,
    status: "paid",
    paidAtIso,
    paidUntilIso: labelApiFeePaidUntilAfterPayment(now),
    lastRejectionReason: null,
  };
}

export function labelApiFeeBlockMessage(fee: LabelApiFeeSettings): string {
  const amount = formatLabelBillingMoney(fee.amountCents);
  if (fee.status === "pending") {
    return `API fee payment of ${amount} is pending admin review. Buy Labels stays locked until approved.`;
  }
  if (fee.cadence === "monthly") {
    return `API fee of ${amount} is required every 30 days before you can buy labels.`;
  }
  return `One-time API fee of ${amount} is required before you can buy labels.`;
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
  const legacyMode = raw?.mode === "wallet" ? "wallet" : "limit";
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
  const walletSpendLimitRaw = Math.floor(Number(raw?.walletSpendLimitCents));
  const walletSpendLimitCents =
    Number.isFinite(walletSpendLimitRaw) && walletSpendLimitRaw > 0
      ? walletSpendLimitRaw
      : undefined;
  const currentKey = labelBillingPeriodKey(period, now);
  const storedKey = String(raw?.periodKey || "").trim();
  const rolled = !storedKey || storedKey !== currentKey;
  let periodUsedCents = rolled
    ? 0
    : Math.max(0, Math.floor(Number(raw?.periodUsedCents) || 0));
  let walletPeriodUsedCents = rolled
    ? 0
    : Math.max(0, Math.floor(Number(raw?.walletPeriodUsedCents) || 0));
  // Legacy wallet-only accounts tracked wallet spend in periodUsedCents.
  if (
    raw?.walletPeriodUsedCents == null &&
    legacyMode === "wallet" &&
    !rolled &&
    periodUsedCents > 0
  ) {
    walletPeriodUsedCents = periodUsedCents;
    periodUsedCents = 0;
  }
  const walletBalanceCents = Math.max(0, Math.floor(Number(raw?.walletBalanceCents) || 0));
  const markupCents = Math.max(
    0,
    Math.floor(
      Number.isFinite(Number(raw?.markupCents))
        ? Number(raw?.markupCents)
        : LABEL_BILLING_DEFAULT_MARKUP_CENTS
    )
  );
  let allowShippo = raw?.allowShippo !== false;
  let allowShipbest = raw?.allowShipbest !== false;
  if (!allowShippo && !allowShipbest) {
    allowShippo = true;
    allowShipbest = true;
  }

  let trialStartedAtIso = raw?.trialStartedAtIso ? String(raw.trialStartedAtIso) : null;
  let trialDisabled = raw?.trialDisabled === true;
  if (!trialStartedAtIso && legacyMode === "wallet") {
    // Legacy wallet-only: no trial window.
    trialDisabled = true;
  } else if (!trialStartedAtIso) {
    // New or legacy limit-only: start the 30-day trial now.
    trialStartedAtIso = now.toISOString();
  }

  const draft: LabelBillingSettings = {
    mode: legacyMode,
    trialStartedAtIso,
    trialDisabled,
    limitAmountCents:
      limitAmountCents > 0 ? limitAmountCents : LABEL_BILLING_DEFAULT_LIMIT_CENTS,
    period,
    periodUsedCents,
    walletPeriodUsedCents,
    walletSpendLimitCents,
    periodKey: currentKey,
    walletBalanceCents,
    markupCents,
    allowShippo,
    allowShipbest,
    apiFee: normalizeLabelApiFeeSettings(raw?.apiFee, now),
  };
  draft.mode = isLabelTrialActive(draft, now) ? "limit" : "wallet";
  return draft;
}

export function labelBillingRemainingCents(settings: LabelBillingSettings): number {
  return Math.max(0, settings.limitAmountCents - settings.periodUsedCents);
}

export function labelTrialEndsAt(
  settings: Pick<LabelBillingSettings, "trialStartedAtIso">,
  now = new Date()
): Date | null {
  const iso = settings.trialStartedAtIso;
  if (!iso) return null;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  return new Date(started + LABEL_TRIAL_DURATION_MS);
}

/** True when the 30-day Buy Label trial window is still open. */
export function isLabelTrialActive(
  settings: Pick<LabelBillingSettings, "trialStartedAtIso" | "trialDisabled">,
  now = new Date()
): boolean {
  if (settings.trialDisabled === true) return false;
  const ends = labelTrialEndsAt(settings, now);
  if (!ends) return false;
  return now.getTime() < ends.getTime();
}

export function labelTrialRemainingMs(
  settings: Pick<LabelBillingSettings, "trialStartedAtIso" | "trialDisabled">,
  now = new Date()
): number {
  if (!isLabelTrialActive(settings, now)) return 0;
  const ends = labelTrialEndsAt(settings, now);
  if (!ends) return 0;
  return Math.max(0, ends.getTime() - now.getTime());
}

export function labelWalletSpendLimitCents(settings: LabelBillingSettings): number {
  const cap = Math.floor(Number(settings.walletSpendLimitCents));
  if (Number.isFinite(cap) && cap > 0) return cap;
  return settings.limitAmountCents;
}

export function labelWalletRemainingCents(settings: LabelBillingSettings): number {
  const cap = labelWalletSpendLimitCents(settings);
  const used = Math.max(0, Math.floor(Number(settings.walletPeriodUsedCents) || 0));
  return Math.max(0, cap - used);
}

export function resolveLabelPaymentSource(
  settings: LabelBillingSettings,
  preferWallet: boolean,
  now = new Date()
): LabelPaymentSource {
  if (preferWallet) return "wallet";
  if (isLabelTrialActive(settings, now)) return "trial";
  return "wallet";
}

export type LabelPurchaseGateResult =
  | { ok: true; settings: LabelBillingSettings }
  | {
      ok: false;
      error: string;
      code:
        | "LIMIT_EXCEEDED"
        | "WALLET_INSUFFICIENT"
        | "WALLET_PERIOD_LIMIT"
        | "WRONG_MODE"
        | "TRIAL_EXPIRED"
        | "API_FEE_REQUIRED";
    };

/** Gate a spend of `amountCents` against current billing settings (already normalized / rolled). */
export function canSpendLabelBilling(
  settings: LabelBillingSettings,
  amountCents: number,
  opts?: { preferWallet?: boolean; paymentSource?: LabelPaymentSource },
  now = new Date()
): LabelPurchaseGateResult {
  const amount = Math.max(0, Math.floor(amountCents || 0));
  if (amount < 1) {
    return { ok: false, error: "Invalid purchase amount.", code: "LIMIT_EXCEEDED" };
  }

  if (isLabelApiFeeBlocking(settings)) {
    const fee = normalizeLabelApiFeeSettings(settings.apiFee);
    return {
      ok: false,
      error: labelApiFeeBlockMessage(fee),
      code: "API_FEE_REQUIRED",
    };
  }

  const source =
    opts?.paymentSource ??
    resolveLabelPaymentSource(settings, opts?.preferWallet === true, now);

  if (source === "trial") {
    if (!isLabelTrialActive(settings, now)) {
      return {
        ok: false,
        error:
          "Your 30-day Buy Label trial has ended. Top up your wallet to purchase labels.",
        code: "TRIAL_EXPIRED",
      };
    }
    if (settings.periodUsedCents + amount > settings.limitAmountCents) {
      const left = labelBillingRemainingCents(settings);
      return {
        ok: false,
        error: `Trial label purchase limit reached. Remaining this ${formatLabelBillingPeriod(settings.period)}: ${formatLabelBillingMoney(left)}. Use your wallet or contact an administrator.`,
        code: "LIMIT_EXCEEDED",
      };
    }
    return { ok: true, settings };
  }

  if ((settings.walletBalanceCents || 0) < amount) {
    return {
      ok: false,
      error: `Insufficient wallet balance. Available: ${formatLabelBillingMoney(settings.walletBalanceCents || 0)}. Please top up.`,
      code: "WALLET_INSUFFICIENT",
    };
  }
  const walletCap = labelWalletSpendLimitCents(settings);
  const walletUsed = Math.max(0, Math.floor(Number(settings.walletPeriodUsedCents) || 0));
  if (walletUsed + amount > walletCap) {
    const left = labelWalletRemainingCents(settings);
    return {
      ok: false,
      error: `Wallet ${formatLabelBillingPeriod(settings.period)} spend limit reached. Remaining: ${formatLabelBillingMoney(left)}.`,
      code: "WALLET_PERIOD_LIMIT",
    };
  }
  return { ok: true, settings };
}

export function labelBillingSummaryLine(
  settings: LabelBillingSettings,
  now = new Date()
): string {
  const period = formatLabelBillingPeriod(settings.period);
  const walletBal = formatLabelBillingMoney(settings.walletBalanceCents || 0);
  const walletLeft = formatLabelBillingMoney(labelWalletRemainingCents(settings));
  const trialActive = isLabelTrialActive(settings, now);
  if (trialActive) {
    const limit = formatLabelBillingMoney(settings.limitAmountCents);
    const used = formatLabelBillingMoney(settings.periodUsedCents);
    const left = formatLabelBillingMoney(labelBillingRemainingCents(settings));
    const ends = labelTrialEndsAt(settings, now);
    const daysLeft = ends
      ? Math.max(1, Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    return `Buy Label trial · ${daysLeft} day(s) left · Trial ${limit}/${period} · Used ${used} · Left ${left} · Wallet ${walletBal} · Wallet limit left ${walletLeft}`;
  }
  return `Label wallet · Balance ${walletBal} · ${formatLabelBillingPeriodAdjective(settings.period)} spend left ${walletLeft}`;
}
