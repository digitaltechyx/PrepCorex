"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { FileText, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { shippedNeedsInvoice } from "@/lib/invoice-line-catalog";
import { allowsPrepcorexCreateInvoice } from "@/lib/outbound-billing";
import type { ShippedItem, UserProfile } from "@/types";
import { Button } from "@/components/ui/button";

/**
 * After marketplace quick fulfill: offer Create Invoice (On clients) or
 * Add services → CRM draft (Off clients).
 */
export function QuickFulfillInvoiceOffer({
  clientUser,
  shippedId,
  channelLabel,
  onCloseForNow,
  onOpenInvoice,
}: {
  clientUser: Pick<UserProfile, "uid" | "name" | "email" | "phone">;
  shippedId: string;
  channelLabel: string;
  onCloseForNow: () => void;
  onOpenInvoice: (
    shipment: ShippedItem,
    mode: "prepcorex" | "crm_draft"
  ) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [shipment, setShipment] = useState<ShippedItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allowCreateInvoice, setAllowCreateInvoice] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [shipSnap, userSnap] = await Promise.all([
          getDoc(doc(db, `users/${clientUser.uid}/shipped/${shippedId}`)),
          getDoc(doc(db, `users/${clientUser.uid}`)),
        ]);
        if (cancelled) return;
        if (!shipSnap.exists()) {
          setLoadError("Shipped order not found. You can still invoice from Shipped Orders.");
          setShipment(null);
          return;
        }
        setShipment({ id: shipSnap.id, ...(shipSnap.data() as Omit<ShippedItem, "id">) });
        const profile = userSnap.exists()
          ? (userSnap.data() as UserProfile)
          : null;
        setAllowCreateInvoice(allowsPrepcorexCreateInvoice(profile));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load shipped order.");
          setShipment(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientUser.uid, shippedId]);

  const canAct = shipment
    ? allowCreateInvoice
      ? shippedNeedsInvoice(shipment, { allowPrepcorexCreateInvoice: true })
      : !shipment.invoiceId &&
        !shipment.crmExternalInvoiceId &&
        String(shipment.invoiceStatus || "").trim().toLowerCase() === "pending"
    : false;

  const mode: "prepcorex" | "crm_draft" = allowCreateInvoice ? "prepcorex" : "crm_draft";

  return (
    <div className="space-y-4 py-2">
      <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
        <p className="font-medium text-emerald-900 dark:text-emerald-100">
          {channelLabel} order fulfilled
        </p>
        <p className="mt-1 text-emerald-800/90 dark:text-emerald-200/90">
          {allowCreateInvoice
            ? "Create an invoice now, or skip and use Create Invoice later on Shipped Orders."
            : "This client uses CRM draft billing. Add services now (optional), then lines go to their CRM draft — or skip and do it later from Shipped Orders."}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shipped order…
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : !canAct ? (
        <p className="text-sm text-muted-foreground">
          This order is already invoiced or already in a CRM draft. Close to continue.
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCloseForNow}>
          Close for now
        </Button>
        <Button
          type="button"
          disabled={!canAct || loading || !shipment}
          onClick={() => {
            if (!shipment) return;
            onOpenInvoice(shipment, mode);
          }}
        >
          <FileText className="mr-2 h-4 w-4" />
          {allowCreateInvoice ? "Create Invoice" : "Add services → CRM"}
        </Button>
      </div>
    </div>
  );
}
