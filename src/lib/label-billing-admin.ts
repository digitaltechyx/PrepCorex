import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import {
  canSpendLabelBilling,
  labelBillingPeriodKey,
  labelWalletLedgerPath,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import type { LabelBillingPeriod, LabelBillingSettings, LabelWalletLedgerType } from "@/types";

type AdminDb = Firestore;

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
  const settings = await ensureLabelBillingPeriodRolled(db, opts.userId);
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
