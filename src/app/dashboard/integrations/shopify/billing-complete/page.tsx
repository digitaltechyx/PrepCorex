"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

function BillingCompleteInner() {
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop")?.trim() || "";

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Billing step complete
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            If you approved the subscription in Shopify, your store billing is registered with Shopify for this app.
            {shop ? (
              <>
                {" "}
                Store: <span className="font-mono text-foreground">{shop}</span>
              </>
            ) : null}
          </p>
          <Button asChild className="w-full">
            <Link href="/dashboard/integrations">Back to Integrations</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ShopifyBillingCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[40vh] flex items-center justify-center p-4 text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <BillingCompleteInner />
    </Suspense>
  );
}
