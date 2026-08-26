import { differenceInCalendarDays, format, startOfMonth, subMonths } from "date-fns";
import { adminDb } from "@/lib/firebase-admin";
import { getBuyLabelRateDisplay } from "@/lib/buy-label-rate-display";
import {
  inboundReceivedQuantity,
  isInReportRange,
  pickInvoiceDateMs,
  pickReportDateMs,
  reportEndOfDay,
  reportStartOfDay,
  reportToMs,
} from "@/lib/admin-reports-utils";
import {
  benchmarksForWeight,
  classifyLabelSavingsCarrier,
  estimatedSavings,
  isPrepCorexGofoPurchase,
  labelPurchasePaidDollars,
  parcelWeightPounds,
} from "@/lib/label-savings-benchmarks";
import { loadLabelSavingsBenchmarks } from "@/lib/label-savings-benchmarks-server";
import {
  classifyPrepFamilyFromShipped,
  estimateReturnPrepMarket,
  estimateShippedPrepMarket,
} from "@/lib/prep-savings-benchmarks";
import { loadPrepSavingsBenchmarks } from "@/lib/prep-savings-benchmarks-server";
import {
  estimateReturnPrepProfile,
  estimateShippedPrepProfile,
  loadUserPrepPricingContext,
} from "@/lib/user-prep-pricing-server";
import type {
  ClientReportInventoryRow,
  ClientReportInvoiceRow,
  ClientReportLabelRow,
  ClientReportSummary,
} from "@/lib/client-reports-types";

export type BuildClientReportInput = {
  userId: string;
  from: Date;
  to: Date;
  allTime?: boolean;
};

function inventorySourceLabel(data: Record<string, unknown>): string {
  const source = String(data.source || "").toLowerCase();
  if (source === "shopify") return "Shopify";
  if (source === "ebay") return "eBay";
  if (source === "woocommerce") return "WooCommerce";
  if (source === "tiktok") return "TikTok Shop";
  return "Manual";
}

function shippedUnits(data: Record<string, unknown>): number {
  return (
    Number(data.shippedQty) ||
    Number(data.totalUnits) ||
    Number(data.boxesShipped) ||
    0
  );
}

function isoOrNull(ms: number): string | null {
  return ms > 0 ? new Date(ms).toISOString() : null;
}

function buildActivityBuckets(from: Date, to: Date, allTime: boolean) {
  const buckets = new Map<string, { label: string; received: number; shipped: number }>();
  if (allTime) {
    let cursor = startOfMonth(from);
    const end = startOfMonth(to);
    if (cursor.getTime() > end.getTime()) cursor = end;
    while (cursor <= to) {
      const key = format(cursor, "yyyy-MM");
      buckets.set(key, { label: format(cursor, "MMM yyyy"), received: 0, shipped: 0 });
      cursor = subMonths(cursor, -1);
    }
    return buckets;
  }

  const days = Math.min(differenceInCalendarDays(to, from) + 1, 90);
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (d > to) break;
    const key = format(d, "yyyy-MM-dd");
    buckets.set(key, { label: format(d, "MMM d"), received: 0, shipped: 0 });
  }
  return buckets;
}

function bucketKey(ms: number, allTime: boolean): string {
  const d = new Date(ms);
  return allTime ? format(d, "yyyy-MM") : format(d, "yyyy-MM-dd");
}

function isCompletedLabel(data: Record<string, unknown>): boolean {
  const refund = String(data.refundStatus || "").toLowerCase();
  if (refund === "refunded") return false;
  const payment = String(data.paymentStatus || "").toLowerCase();
  if (payment && payment !== "succeeded") return false;
  const status = String(data.status || "").toLowerCase();
  if (!status) return payment === "succeeded";
  return (
    status === "label_purchased" ||
    status === "completed" ||
    status === "payment_succeeded"
  );
}

export async function buildClientReport(
  input: BuildClientReportInput
): Promise<ClientReportSummary> {
  const allTime = input.allTime ?? false;
  const from = reportStartOfDay(input.from);
  const to = reportEndOfDay(input.to);
  const uid = input.userId;
  const userRef = adminDb().collection("users").doc(uid);

  const [
    inventorySnap,
    inboundSnap,
    shippedSnap,
    returnsSnap,
    disposeSnap,
    invoicesSnap,
    labelsSnap,
    benchmarks,
    prepBenchmarks,
    prepPricing,
  ] = await Promise.all([
    userRef.collection("inventory").get(),
    userRef.collection("inventoryRequests").get(),
    userRef.collection("shipped").get(),
    userRef.collection("productReturns").get(),
    userRef.collection("disposeRequests").get(),
    userRef.collection("invoices").get(),
    userRef.collection("labelPurchases").get(),
    loadLabelSavingsBenchmarks(),
    loadPrepSavingsBenchmarks(),
    loadUserPrepPricingContext(uid),
  ]);

  let currentOnHand = 0;
  let currentDamaged = 0;
  const inventory: ClientReportInventoryRow[] = inventorySnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const quantity = Math.max(0, Math.floor(Number(data.quantity) || 0));
    const damagedQuantity = Math.max(0, Math.floor(Number(data.damagedQuantity) || 0));
    currentOnHand += quantity;
    currentDamaged += damagedQuantity;
    const receivingMs = pickReportDateMs(data, ["receivingDate", "dateAdded"]);
    return {
      id: doc.id,
      productName: String(data.productName || "Product"),
      sku: data.sku != null && String(data.sku).trim() ? String(data.sku).trim() : null,
      source: inventorySourceLabel(data),
      quantity,
      damagedQuantity,
      status: String(data.status || (quantity > 0 ? "In Stock" : "Out of Stock")),
      receivingDate: isoOrNull(receivingMs),
    };
  });
  inventory.sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }));

  const activityBuckets = buildActivityBuckets(
    allTime
      ? (() => {
          const dates: number[] = [];
          inboundSnap.docs.forEach((d) => {
            const ms = pickReportDateMs(d.data() as Record<string, unknown>, [
              "receivingDate",
              "approvedAt",
              "requestedAt",
              "createdAt",
            ]);
            if (ms) dates.push(ms);
          });
          shippedSnap.docs.forEach((d) => {
            const ms = pickReportDateMs(d.data() as Record<string, unknown>, [
              "date",
              "createdAt",
              "dispatchedAt",
            ]);
            if (ms) dates.push(ms);
          });
          const min = dates.length ? Math.min(...dates) : from.getTime();
          return new Date(min);
        })()
      : from,
    to,
    allTime
  );

  let unitsReceived = 0;
  for (const doc of inboundSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (String(data.status || "").toLowerCase() !== "approved") continue;
    const ms = pickReportDateMs(data, ["receivingDate", "approvedAt", "requestedAt", "createdAt"]);
    if (!ms || !isInReportRange(new Date(ms), from, to, allTime)) continue;
    const qty = inboundReceivedQuantity(data);
    unitsReceived += qty;
    const key = bucketKey(ms, allTime);
    const bucket = activityBuckets.get(key);
    if (bucket) bucket.received += qty;
  }

  let unitsShipped = 0;
  let prepUnitCount = 0;
  let prepFbaUnitCount = 0;
  let prepFbmUnitCount = 0;
  let prepCrossdockUnitCount = 0;
  let prepReturnsUnitCount = 0;
  let estimatedPrepFba = 0;
  let estimatedPrepFbm = 0;
  let estimatedPrepCrossdock = 0;
  let estimatedPrepReturns = 0;
  let profilePrepFba = 0;
  let profilePrepFbm = 0;
  let profilePrepCrossdock = 0;
  let profilePrepReturns = 0;
  for (const doc of shippedSnap.docs) {
    const data = doc.data() as Record<string, unknown>;

    const ms = pickReportDateMs(data, ["date", "createdAt", "dispatchedAt"]);
    if (!ms || !isInReportRange(new Date(ms), from, to, allTime)) continue;
    const qty = shippedUnits(data);
    if (qty <= 0) continue;

    if (String(data.returnRequestId ?? "").trim()) {
      unitsShipped += qty;
      const key = bucketKey(ms, allTime);
      const bucket = activityBuckets.get(key);
      if (bucket) bucket.shipped += qty;
      continue;
    }

    unitsShipped += qty;
    const key = bucketKey(ms, allTime);
    const bucket = activityBuckets.get(key);
    if (bucket) bucket.shipped += qty;

    const market = estimateShippedPrepMarket(data, prepBenchmarks);
    const profile = estimateShippedPrepProfile(data, prepPricing, prepBenchmarks);
    if (!market) continue;

    prepUnitCount += market.unitCount;
    if (market.family === "fba") {
      prepFbaUnitCount += market.unitCount;
      estimatedPrepFba += market.estimated;
      profilePrepFba += profile?.estimated ?? 0;
    } else if (market.family === "crossdock") {
      prepCrossdockUnitCount += market.unitCount;
      estimatedPrepCrossdock += market.estimated;
      profilePrepCrossdock += profile?.estimated ?? 0;
    } else if (market.family === "fbm") {
      prepFbmUnitCount += market.unitCount;
      estimatedPrepFbm += market.estimated;
      profilePrepFbm += profile?.estimated ?? 0;
    }
  }

  let returnsHandled = 0;
  let unitsReturned = 0;
  for (const doc of returnsSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (String(data.status || "").toLowerCase() !== "closed") continue;
    const ms = pickReportDateMs(data, ["closedAt", "updatedAt", "createdAt"]);
    if (!ms || !isInReportRange(new Date(ms), from, to, allTime)) continue;
    returnsHandled += 1;
    const qty =
      Math.max(0, Math.floor(Number(data.receivedQuantity) || 0)) ||
      Math.max(0, Math.floor(Number(data.requestedQuantity) || 0));
    unitsReturned += qty;
    if (qty > 0) {
      const market = estimateReturnPrepMarket(qty, prepBenchmarks);
      const profile = estimateReturnPrepProfile(data, qty, prepPricing, prepBenchmarks);
      prepReturnsUnitCount += market.unitCount;
      prepUnitCount += market.unitCount;
      estimatedPrepReturns += market.estimated;
      profilePrepReturns += profile.estimated;
    }
  }

  let unitsDisposed = 0;
  for (const doc of disposeSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (String(data.status || "").toLowerCase() !== "approved") continue;
    const ms = pickReportDateMs(data, ["approvedAt", "requestedAt", "createdAt"]);
    if (!ms || !isInReportRange(new Date(ms), from, to, allTime)) continue;
    unitsDisposed += Number(data.quantity) || 0;
  }

  const invoices: ClientReportInvoiceRow[] = [];
  for (const doc of invoicesSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const ms = pickInvoiceDateMs(data);
    if (!allTime && (!ms || !isInReportRange(new Date(ms), from, to, false))) continue;
    const grandTotal = Number(data.grandTotal) || 0;
    invoices.push({
      id: doc.id,
      invoiceNumber: String(data.invoiceNumber || doc.id),
      date: (ms ? new Date(ms) : from).toISOString(),
      status: String(data.status || "pending"),
      subtotal: Number(data.subtotal) || 0,
      grandTotal,
    });
  }
  invoices.sort((a, b) => reportToMs(b.date) - reportToMs(a.date));

  const paidInvoices = invoices.filter((i) => i.status.toLowerCase() === "paid");
  const pendingInvoices = invoices.filter((i) => i.status.toLowerCase() !== "paid");

  const labelRows: ClientReportLabelRow[] = [];
  for (const doc of labelsSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!isCompletedLabel(data)) continue;
    const ms = pickReportDateMs(data, [
      "labelPurchasedAt",
      "paymentCompletedAt",
      "createdAt",
    ]);
    if (!ms || !isInReportRange(new Date(ms), from, to, allTime)) continue;

    const selected =
      data.selectedRate && typeof data.selectedRate === "object"
        ? (data.selectedRate as Record<string, unknown>)
        : {};
    const display = getBuyLabelRateDisplay({
      provider: String(selected.provider ?? ""),
      serviceLevel: String(selected.serviceLevel ?? ""),
      labelProvider: String(data.labelProvider ?? selected.labelProvider ?? ""),
      objectId: String(selected.objectId ?? selected.object_id ?? ""),
    });
    const isGofo = isPrepCorexGofoPurchase(data);
    const paid = labelPurchasePaidDollars(data);
    if (paid <= 0) continue;

    const weightLb = parcelWeightPounds(data.parcel);
    const band = benchmarksForWeight(benchmarks, weightLb);
    const carrierFamily = classifyLabelSavingsCarrier({
      isGofo,
      provider: display.provider,
      service: display.service,
    });

    labelRows.push({
      id: doc.id,
      purchasedAt: new Date(ms).toISOString(),
      trackingNumber: data.trackingNumber ? String(data.trackingNumber) : null,
      carrier: display.provider,
      service: display.service,
      paid,
      isGofo,
      carrierFamily,
      weightLb: Math.round(weightLb * 100) / 100,
      weightBand: band.label,
      estimatedUsps: band.usps,
      estimatedUps: band.ups,
      estimatedFedex: band.fedex,
      savedVsUsps: estimatedSavings(paid, band.usps),
      savedVsUps: estimatedSavings(paid, band.ups),
      savedVsFedex: estimatedSavings(paid, band.fedex),
    });
  }
  labelRows.sort((a, b) => reportToMs(b.purchasedAt) - reportToMs(a.purchasedAt));

  const gofoRows = labelRows.filter((r) => r.carrierFamily === "gofo");
  const uspsRows = labelRows.filter((r) => r.carrierFamily === "usps");
  const upsRows = labelRows.filter((r) => r.carrierFamily === "ups");
  const fedexRows = labelRows.filter((r) => r.carrierFamily === "fedex");
  const otherRows = labelRows.filter((r) => r.carrierFamily === "other");
  const sumPaid = (rows: typeof labelRows) => rows.reduce((s, r) => s + r.paid, 0);
  const paidGofo = sumPaid(gofoRows);
  const paidTotal = sumPaid(labelRows);
  const estimatedUsps = labelRows.reduce((s, r) => s + r.estimatedUsps, 0);
  const estimatedUps = labelRows.reduce((s, r) => s + r.estimatedUps, 0);
  const estimatedFedex = labelRows.reduce((s, r) => s + r.estimatedFedex, 0);

  const periodLabel = allTime
    ? "All time"
    : `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;

  return {
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: periodLabel,
      allTime,
    },
    overview: {
      unitsReceived,
      unitsShipped,
      currentOnHand,
      currentDamaged,
      returnsHandled,
      unitsReturned,
      unitsDisposed,
      invoicesBilled: invoices.reduce((s, i) => s + i.grandTotal, 0),
      invoicesPaid: paidInvoices.reduce((s, i) => s + i.grandTotal, 0),
      invoicesPending: pendingInvoices.reduce((s, i) => s + i.grandTotal, 0),
      invoiceCount: invoices.length,
      paidCount: paidInvoices.length,
      pendingCount: pendingInvoices.length,
    },
    charts: {
      activityByDay: Array.from(activityBuckets.values()),
    },
    inventory,
    invoices,
    savings: {
      benchmarks,
      gofoLabelCount: gofoRows.length,
      otherLabelCount: labelRows.length - gofoRows.length,
      labelCount: labelRows.length,
      paidGofo,
      paidUsps: sumPaid(uspsRows),
      paidUps: sumPaid(upsRows),
      paidFedex: sumPaid(fedexRows),
      paidOther: sumPaid(otherRows),
      paidTotal,
      estimatedUsps,
      estimatedUps,
      estimatedFedex,
      savedVsUsps: labelRows.reduce((s, r) => s + r.savedVsUsps, 0),
      savedVsUps: labelRows.reduce((s, r) => s + r.savedVsUps, 0),
      savedVsFedex: labelRows.reduce((s, r) => s + r.savedVsFedex, 0),
      savedOnShipping: Math.round(
        labelRows.reduce(
          (s, r) => s + Math.max(r.savedVsUsps, r.savedVsUps, r.savedVsFedex),
          0
        ) * 100
      ) / 100,
      averagePaidGofo: gofoRows.length ? Math.round((paidGofo / gofoRows.length) * 100) / 100 : 0,
      averagePaid: labelRows.length ? Math.round((paidTotal / labelRows.length) * 100) / 100 : 0,
      rows: labelRows,
      prep: {
        benchmarks: prepBenchmarks,
        profileId: prepPricing.profileId,
        profileLabel: prepPricing.profileLabel,
        unitCount: prepUnitCount,
        fbaUnitCount: prepFbaUnitCount,
        fbmUnitCount: prepFbmUnitCount,
        crossdockUnitCount: prepCrossdockUnitCount,
        returnsUnitCount: prepReturnsUnitCount,
        paidFba: Math.round(profilePrepFba * 100) / 100,
        paidFbm: Math.round(profilePrepFbm * 100) / 100,
        paidCrossdock: Math.round(profilePrepCrossdock * 100) / 100,
        paidReturns: Math.round(profilePrepReturns * 100) / 100,
        paidTotal: Math.round(
          (profilePrepFba + profilePrepFbm + profilePrepCrossdock + profilePrepReturns) * 100
        ) / 100,
        estimatedFba: Math.round(estimatedPrepFba * 100) / 100,
        estimatedFbm: Math.round(estimatedPrepFbm * 100) / 100,
        estimatedCrossdock: Math.round(estimatedPrepCrossdock * 100) / 100,
        estimatedReturns: Math.round(estimatedPrepReturns * 100) / 100,
        estimatedMarket: Math.round(
          (estimatedPrepFba +
            estimatedPrepFbm +
            estimatedPrepCrossdock +
            estimatedPrepReturns) *
            100
        ) / 100,
        savedOnPrep:
          Math.round(
            Math.max(
              0,
              estimatedPrepFba +
                estimatedPrepFbm +
                estimatedPrepCrossdock +
                estimatedPrepReturns -
                profilePrepFba -
                profilePrepFbm -
                profilePrepCrossdock -
                profilePrepReturns
            ) * 100
          ) / 100,
      },
    },
  };
}
