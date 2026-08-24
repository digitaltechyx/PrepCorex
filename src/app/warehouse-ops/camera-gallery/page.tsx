"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsCameraGallery } from "@/components/warehouse-ops/warehouse-ops-camera-gallery";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import { useAuth } from "@/hooks/use-auth";

export default function WarehouseOpsCameraGalleryPage() {
  const { userProfile } = useAuth();

  if (!hasWarehouseOpsAccess(userProfile)) {
    return (
      <div>
        <WarehouseOpsHeader title="Camera gallery" />
        <p className="text-muted-foreground">You do not have Warehouse Ops access.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  return <WarehouseOpsCameraGallery />;
}
