import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { isAdminLikeUserDoc } from "@/lib/api-admin-auth";
import {
  applyLabelApiFeePaid,
  canSpendLabelBilling,
  isLabelApiFeeBlocking,
  LABEL_BILLING_DEFAULT_MARKUP_CENTS,
  labelApiFeeBlockMessage,
  labelBillingPeriodKey,
  labelWalletLedgerPath,
  normalizeLabelApiFeeSettings,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import { markupCentsToDollars } from "@/lib/buy-labels-markup";
import type {
  LabelApiFeeCadence,
  LabelApiFeeSettings,
  LabelBillingPeriod,
  LabelBillingSettings,
  LabelWalletLedgerType,
} from "@/types";

type AdminDb = Firestore;

export type BuyLabelsRateOptions = {
  markupDollars: number;
  allowShippo: boolean;
  allowShipbest: boolean;
};

const DEFAULT_RATE_OPTIONS: BuyLabelsRateOptions = {
  markupDollars: markupCentsToDollars(LABEL_BILLING_DEFAULT_MARKUP_CENTS),
  allowShippo: true,
  allowShipbest: true,
};

/** Resolve per-user markup / courier flags for Buy Labels rate APIs. */
export async function resolveBuyLabelsRateOptions(
  db: AdminDb,
  userId: string | null | undefined
): Promise<BuyLabelsRateOptions> {
  const uid = String(userId || "").trim();
  if (!uid) return DEFAULT_RATE_OPTIONS;
  try {
    const { settings } = await loadNormalizedLabelBilling(db, uid);
    return {
      markupDollars: markupCentsToDollars(settings.markupCents),
      allowShippo: settings.allowShippo !== false,
      allowShipbest: settings.allowShipbest !== false,
    };
  } catch {
    return DEFAULT_RATE_OPTIONS;
  }
}

/** Admin / sub-admin buy labels with no trial cap and no wallet deduction. */
export async function isLabelBillingExemptUser(db: AdminDb, userId: string): Promise<boolean> {
  const snap = await db.collection("users").doc(userId).get();
  return isAdminLikeUserDoc(snap.exists ? snap.data() : null);
}

export async function loadNormalizedLabelBilling(
  db: AdminDb,
  userId: string
): Promise<{
  ref: DocumentReference;
  settings: LabelBillingSettings;
  raw: Record<string, unknown>;
}> {
  const ref = db.collection("users").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("User not found.");
  }
  const raw = (snap.data() || {}) as Record<string, unknown>;
  const settings = normalizeLabelBillingSettings(
    (raw.labelBilling as Partial<LabelBillingSettings> | undefined) || null
  );
  return { ref, settings, raw };
}

/** Persist rolled periodKey/used if calendar rolled since last write. */
export async function ensureLabelBillingPeriodRolled(
  db: AdminDb,
  userId: string
): Promise<LabelBillingSettings> {
  const { ref, settings, raw } = await loadNormalizedLabelBilling(db, userId);
  const stored = (raw.labelBilling as Partial<LabelBillingSettings> | undefined) || {};
  const needsWrite =
    stored.periodKey !== settings.periodKey ||
    Number(stored.periodUsedCents || 0) !== settings.periodUsedCents ||
    !stored.mode ||
    stored.limitAmountCents == null;

  if (needsWrite) {
    await ref.set(
      {
        labelBilling: {
          ...settings,
          walletBalanceCents: settings.walletBalanceCents ?? 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  }
  return settings;
}

export async function appendLabelWalletLedger(
  db: AdminDb,
  input: {
    userId: string;
    type: LabelWalletLedgerType;
    amountCents: number;
    balanceAfterCents?: number | null;
    periodUsedAfterCents?: number | null;
    reason?: string | null;
    receiptUrls?: string[];
    adminEvidenceUrls?: string[];
    topupRequestId?: string | null;
    labelPurchaseId?: string | null;
    createdBy: string;
    createdByName?: string | null;
  }
) {
  await db.collection(labelWalletLedgerPath(input.userId)).add({
    userId: input.userId,
    type: input.type,
    amountCents: Math.floor(input.amountCents),
    balanceAfterCents: input.balanceAfterCents ?? null,
    periodUsedAfterCents: input.periodUsedAfterCents ?? null,
    reason: input.reason || null,
    receiptUrls: input.receiptUrls || [],
    adminEvidenceUrls: input.adminEvidenceUrls || [],
    topupRequestId: input.topupRequestId || null,
    labelPurchaseId: input.labelPurchaseId || null,
    createdBy: input.createdBy,
    createdByName: input.createdByName || null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Roll period if needed and assert the spend is allowed (does not mutate used/balance).
 */
export async function assertCanSpendLabelBilling(
  db: AdminDb,
  opts: { userId: string; amountCents: number; preferWallet: boolean }
): Promise<LabelBillingSettings> {
  if (await isLabelBillingExemptUser(db, opts.userId)) {
    const { settings } = await loadNormalizedLabelBilling(db, opts.userId);
    return settings;
  }
  const settings = await ensureLabelBillingPeriodRolled(db, opts.userId);
  if (isLabelApiFeeBlocking(settings)) {
    const fee = normalizeLabelApiFeeSettings(settings.apiFee);
    throw Object.assign(new Error(labelApiFeeBlockMessage(fee)), {
      code: "API_FEE_REQUIRED",
    });
  }
  const gate = canSpendLabelBilling(settings, opts.amountCents, {
    preferWallet: opts.preferWallet,
  });
  if (!gate.ok) {
    throw Object.assign(new Error(gate.error), { code: gate.code });
  }
  if (settings.mode === "wallet" && !opts.preferWallet) {
    throw Object.assign(new Error("This account pays with wallet balance. Use wallet checkout."), {
      code: "WRONG_MODE",
    });
  }
  if (settings.mode === "limit" && opts.preferWallet) {
    throw Object.assign(new Error("This account uses a purchase limit, not wallet."), {
      code: "WRONG_MODE",
    });
  }
  return settings;
}

/**
 * Atomically gate + apply a label spend.
 * - limit mode: increments periodUsed only (call after Stripe success)
 * - wallet mode: decrements wallet + increments periodUsed (call before label buy)
 */
export async function applyLabelBillingSpend(
  db: AdminDb,
  opts: {
    userId: string;
    amountCents: number;
    preferWallet: boolean;
    labelPurchaseId?: string | null;
    actorUid: string;
    actorName?: string | null;
  }
): Promise<{ settings: LabelBillingSettings }> {
  if (await isLabelBillingExemptUser(db, opts.userId)) {
    const { settings } = await loadNormalizedLabelBilling(db, opts.userId);
    return { settings };
  }
  const userRef = db.collection("users").doc(opts.userId);
  const amount = Math.max(0, Math.floor(opts.amountCents));

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("User not found.");
    const data = snap.data() || {};
    const settings = normalizeLabelBillingSettings(
      (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
    );
    const gate = canSpendLabelBilling(settings, amount, { preferWallet: opts.preferWallet });
    if (!gate.ok) {
      throw Object.assign(new Error(gate.error), { code: gate.code });
    }

    if (settings.mode === "wallet") {
      if (!opts.preferWallet) {
        throw Object.assign(new Error("This account pays with wallet balance. Use wallet checkout."), {
          code: "WRONG_MODE",
        });
      }
      const nextBalance = (settings.walletBalanceCents || 0) - amount;
      const nextUsed = settings.periodUsedCents + amount;
      const next: LabelBillingSettings = {
        ...settings,
        walletBalanceCents: nextBalance,
        periodUsedCents: nextUsed,
        periodKey: labelBillingPeriodKey(settings.period),
      };
      tx.set(
        userRef,
        { labelBilling: { ...next, updatedAt: FieldValue.serverTimestamp() } },
        { merge: true }
      );
      return next;
    }

    // limit mode — Stripe path; only track period usage
    if (opts.preferWallet) {
      throw Object.assign(new Error("This account uses a purchase limit, not wallet."), {
        code: "WRONG_MODE",
      });
    }
    const nextUsed = settings.periodUsedCents + amount;
    const next: LabelBillingSettings = {
      ...settings,
      periodUsedCents: nextUsed,
      periodKey: labelBillingPeriodKey(settings.period),
    };
    tx.set(
      userRef,
      { labelBilling: { ...next, updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );
    return next;
  });

  if (opts.preferWallet && result.mode === "wallet") {
    await appendLabelWalletLedger(db, {
      userId: opts.userId,
      type: "purchase",
      amountCents: -amount,
      balanceAfterCents: result.walletBalanceCents ?? 0,
      periodUsedAfterCents: result.periodUsedCents,
      labelPurchaseId: opts.labelPurchaseId || null,
      createdBy: opts.actorUid,
      createdByName: opts.actorName || null,
      reason: "Label purchase",
    });
  }

  return { settings: result };
}

export async function adminUpdateLabelBilling(
  db: AdminDb,
  opts: {
    userId: string;
    mode?: "limit" | "wallet";
    limitAmountCents?: number;
    period?: LabelBillingPeriod;
    resetPeriodUsed?: boolean;
    walletBalanceCents?: number;
    reissueCreditCents?: number;
    markupCents?: number;
    allowShippo?: boolean;
    allowShipbest?: boolean;
    apiFeeEnabled?: boolean;
    apiFeeCadence?: LabelApiFeeCadence;
    apiFeeAmountCents?: number;
    reason?: string | null;
    actorUid: string;
    actorName?: string | null;
  }
): Promise<LabelBillingSettings> {
  const userRef = db.collection("users").doc(opts.userId);
  type LedgerDraft = {
    type: LabelWalletLedgerType;
    amountCents: number;
    balanceAfter: number;
    periodUsedAfter: number;
    reason: string | null;
  };

  const { next, ledger } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("User not found.");
    const data = snap.data() || {};
    let settings = normalizeLabelBillingSettings(
      (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
    );
    let ledgerDraft: LedgerDraft | null = null;

    if (opts.mode === "limit" || opts.mode === "wallet") {
      settings = { ...settings, mode: opts.mode };
    }
    if (opts.period) {
      const period = opts.period;
      const key = labelBillingPeriodKey(period);
      settings = {
        ...settings,
        period,
        periodKey: key,
        periodUsedCents: settings.periodKey === key ? settings.periodUsedCents : 0,
      };
      settings = normalizeLabelBillingSettings(settings);
    }
    if (opts.limitAmountCents != null && Number.isFinite(opts.limitAmountCents)) {
      settings = {
        ...settings,
        limitAmountCents: Math.max(0, Math.floor(opts.limitAmountCents)),
      };
    }
    if (opts.markupCents != null && Number.isFinite(opts.markupCents)) {
      settings = {
        ...settings,
        markupCents: Math.max(0, Math.floor(opts.markupCents)),
      };
    }
    if (typeof opts.allowShippo === "boolean" || typeof opts.allowShipbest === "boolean") {
      const allowShippo =
        typeof opts.allowShippo === "boolean" ? opts.allowShippo : settings.allowShippo;
      const allowShipbest =
        typeof opts.allowShipbest === "boolean" ? opts.allowShipbest : settings.allowShipbest;
      if (!allowShippo && !allowShipbest) {
        throw new Error("Enable at least one courier (Shippo or PrepCorex GOFO).");
      }
      settings = { ...settings, allowShippo, allowShipbest };
    }
    if (
      typeof opts.apiFeeEnabled === "boolean" ||
      opts.apiFeeCadence != null ||
      opts.apiFeeAmountCents != null
    ) {
      const prev = normalizeLabelApiFeeSettings(settings.apiFee);
      const enabled =
        typeof opts.apiFeeEnabled === "boolean" ? opts.apiFeeEnabled : prev.enabled;
      const cadence =
        opts.apiFeeCadence === "onetime" || opts.apiFeeCadence === "monthly"
          ? opts.apiFeeCadence
          : prev.cadence;
      const amountCents =
        opts.apiFeeAmountCents != null && Number.isFinite(opts.apiFeeAmountCents)
          ? Math.max(0, Math.floor(opts.apiFeeAmountCents))
          : prev.amountCents;
      if (enabled && amountCents < 1) {
        throw new Error("Enter an API fee amount greater than $0 when enabling.");
      }
      let nextFee: LabelApiFeeSettings = {
        ...prev,
        enabled,
        cadence,
        amountCents,
      };
      if (!enabled) {
        nextFee = normalizeLabelApiFeeSettings({
          ...nextFee,
          enabled: false,
          status: "unpaid",
          paidAtIso: null,
          paidUntilIso: null,
          lastRejectionReason: null,
        });
      } else if (!prev.enabled && enabled) {
        // Freshly enabled — require payment even if an old paidUntil remains.
        nextFee = {
          ...nextFee,
          status: "unpaid",
          paidAtIso: null,
          paidUntilIso: null,
          lastRejectionReason: null,
        };
      } else if (prev.cadence !== cadence) {
        // Cadence change resets entitlement until paid again.
        nextFee = {
          ...nextFee,
          status: "unpaid",
          paidAtIso: null,
          paidUntilIso: null,
          lastRejectionReason: null,
        };
      }
      settings = { ...settings, apiFee: normalizeLabelApiFeeSettings(nextFee) };
    }
    if (opts.resetPeriodUsed) {
      settings = { ...settings, periodUsedCents: 0 };
      ledgerDraft = {
        type: "period_reset",
        amountCents: 0,
        balanceAfter: settings.walletBalanceCents || 0,
        periodUsedAfter: 0,
        reason: opts.reason || "Period usage reset by admin",
      };
    }
    if (opts.walletBalanceCents != null && Number.isFinite(opts.walletBalanceCents)) {
      const newBal = Math.max(0, Math.floor(opts.walletBalanceCents));
      const delta = newBal - (settings.walletBalanceCents || 0);
      settings = { ...settings, walletBalanceCents: newBal };
      ledgerDraft = {
        type: "admin_adjust",
        amountCents: delta,
        balanceAfter: newBal,
        periodUsedAfter: settings.periodUsedCents,
        reason: opts.reason || "Wallet balance adjusted by admin",
      };
    }
    if (opts.reissueCreditCents != null && opts.reissueCreditCents > 0) {
      const credit = Math.floor(opts.reissueCreditCents);
      const newBal = (settings.walletBalanceCents || 0) + credit;
      settings = { ...settings, walletBalanceCents: newBal, mode: "wallet" };
      ledgerDraft = {
        type: "reissue_credit",
        amountCents: credit,
        balanceAfter: newBal,
        periodUsedAfter: settings.periodUsedCents,
        reason: opts.reason || "Reissue credit",
      };
    }

    settings = normalizeLabelBillingSettings(settings);
    tx.set(
      userRef,
      { labelBilling: { ...settings, updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );
    return { next: settings, ledger: ledgerDraft };
  });

  if (ledger) {
    await appendLabelWalletLedger(db, {
      userId: opts.userId,
      type: ledger.type,
      amountCents: ledger.amountCents,
      balanceAfterCents: ledger.balanceAfter,
      periodUsedAfterCents: ledger.periodUsedAfter,
      reason: ledger.reason,
      createdBy: opts.actorUid,
      createdByName: opts.actorName || null,
    });
  }

  return next;
}

/** Instantly pay outstanding API fee from label wallet balance. */
export async function payLabelApiFeeFromWallet(
  db: AdminDb,
  opts: { userId: string; actorUid: string; actorName?: string | null }
): Promise<LabelBillingSettings> {
  const userRef = db.collection("users").doc(opts.userId);

  const { next, amountPaid } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("User not found.");
    const data = snap.data() || {};
    let settings = normalizeLabelBillingSettings(
      (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
    );
    const fee = normalizeLabelApiFeeSettings(settings.apiFee);
    if (!fee.enabled || fee.amountCents < 1) {
      throw Object.assign(new Error("No API fee is required on this account."), {
        code: "API_FEE_NOT_REQUIRED",
      });
    }
    if (!isLabelApiFeeBlocking(settings)) {
      throw Object.assign(new Error("API fee is already paid."), {
        code: "API_FEE_ALREADY_PAID",
      });
    }
    if (fee.status === "pending") {
      throw Object.assign(
        new Error("An ACH/Zelle API fee payment is already pending admin review."),
        { code: "API_FEE_PENDING" }
      );
    }
    const bal = settings.walletBalanceCents || 0;
    if (bal < fee.amountCents) {
      throw Object.assign(
        new Error(
          `Insufficient wallet balance. Need ${(fee.amountCents / 100).toFixed(2)} USD, have ${(bal / 100).toFixed(2)}.`
        ),
        { code: "WALLET_INSUFFICIENT" }
      );
    }
    const newBal = bal - fee.amountCents;
    settings = {
      ...settings,
      walletBalanceCents: newBal,
      apiFee: applyLabelApiFeePaid(fee),
    };
    settings = normalizeLabelBillingSettings(settings);
    tx.set(
      userRef,
      { labelBilling: { ...settings, updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );
    return { next: settings, amountPaid: fee.amountCents };
  });

  await appendLabelWalletLedger(db, {
    userId: opts.userId,
    type: "api_fee",
    amountCents: -Math.abs(amountPaid),
    balanceAfterCents: next.walletBalanceCents || 0,
    periodUsedAfterCents: next.periodUsedCents,
    reason: `API fee (${normalizeLabelApiFeeSettings(next.apiFee).cadence})`,
    createdBy: opts.actorUid,
    createdByName: opts.actorName || null,
  });

  return next;
}

/** Mark API fee paid after admin approves ACH/Zelle receipt (or manual grant). */
export async function markLabelApiFeePaid(
  db: AdminDb,
  opts: {
    userId: string;
    paymentRequestId?: string | null;
    actorUid: string;
  }
): Promise<LabelBillingSettings> {
  const userRef = db.collection("users").doc(opts.userId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error("User not found.");
    const data = snap.data() || {};
    let settings = normalizeLabelBillingSettings(
      (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
    );
    const fee = normalizeLabelApiFeeSettings(settings.apiFee);
    if (!fee.enabled) {
      throw new Error("API fee is not enabled for this user.");
    }
    settings = {
      ...settings,
      apiFee: {
        ...applyLabelApiFeePaid(fee),
        lastPaymentRequestId: opts.paymentRequestId || fee.lastPaymentRequestId || null,
      },
    };
    settings = normalizeLabelBillingSettings(settings);
    tx.set(
      userRef,
      { labelBilling: { ...settings, updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );
    return settings;
  });
}
