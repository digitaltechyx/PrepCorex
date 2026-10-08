"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Truck } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { CreateShipmentWithLabelsForm } from "@/components/dashboard/create-shipment-with-labels-form";
import { adminQuickOutboundShipAfterCreate } from "@/lib/admin-quick-outbound-ship";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type { InventoryItem, UserProfile, WarehouseDoc } from "@/types";

type Props = {
  userId: string;
  userName: string;
  userProfile?: Pick<UserProfile, "uid" | "pricingProfileId">;
  inventory: InventoryItem[];
};

export function AdminQuickOutboundForm({
  userId,
  userName,
  userProfile,
  inventory,
}: Props) {
  const { userProfile: adminProfile } = useAuth();
  const { toast } = useToast();
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      const nj2 = activeWarehouses.find(
        (w) => isDefaultNj2Warehouse(w.name) || isDefaultNj2Warehouse(w.code)
      );
      setWarehouseId(nj2?.id || activeWarehouses[0]!.id);
    }
  }, [activeWarehouses, warehouseId]);

  const dispatchSection: ReactNode = (
    <div className="space-y-3 rounded-lg border border-cyan-300/60 bg-cyan-50/50 p-4 dark:bg-cyan-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-cyan-900 dark:text-cyan-100">
        <Truck className="h-4 w-4" />
        Quick Ship dispatch (required)
      </div>
      <p className="text-xs text-muted-foreground">
        Uses the full outbound form (services, product types, labels). On submit the request is
        confirmed and dispatched immediately — no pending queue for the client.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger>
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {activeWarehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name || w.code || w.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Tracking (optional)</Label>
          <Input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="Courier tracking number"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Admin notes (optional)</Label>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Internal notes stored on the shipment request"
          />
        </div>
      </div>
    </div>
  );

  return (
    <CreateShipmentWithLabelsForm
      inventory={inventory}
      targetUserId={userId}
      targetUserName={userName}
      targetUserProfile={userProfile}
      submitMode="adminQuickShip"
      extraBeforeSubmit={dispatchSection}
      validateBeforeSubmit={() => {
        if (!warehouseId) return "Select a warehouse for Quick Ship.";
        return null;
      }}
      afterRequestsCreated={async ({ requestIds }) => {
        if (!adminProfile?.uid) throw new Error("Admin session required.");
        const { shipped, errors, fulfillmentModes } = await adminQuickOutboundShipAfterCreate({
          clientUserId: userId,
          requestIds,
          adminUid: adminProfile.uid,
          warehouseId,
          trackingNumber: trackingNumber.trim() || null,
          adminRemarks: adminNotes.trim() || null,
        });

        if (errors.length > 0 && shipped.length === 0) {
          throw new Error(errors.map((e) => e.error).join(" · "));
        }

        const usedInventory = fulfillmentModes.includes("inventory");
        const usedBins = fulfillmentModes.includes("bins");
        const modeHint =
          usedBins && usedInventory
            ? " (mixed bin pick & inventory-only)"
            : usedInventory
              ? " (from client inventory)"
              : usedBins
                ? " (warehouse bins)"
                : "";

        if (errors.length > 0) {
          toast({
            variant: "destructive",
            title: "Partial Quick Ship",
            description: `${shipped.length} shipped; ${errors.length} failed: ${errors[0]?.error}`,
          });
          return {
            successDescription: `Quick Shipped ${shipped.length} of ${requestIds.length} for ${userName}${modeHint}.`,
          };
        }

        return {
          successDescription: `Quick Shipped ${shipped.length} outbound request(s) for ${userName}${modeHint}. Stock deducted and marked dispatched.`,
        };
      }}
    />
  );
}
