"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function ShopifyCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const shop = searchParams.get("shop");
    const state = searchParams.get("state") ?? "";
    const hmac = searchParams.get("hmac") ?? "";
    // Reconstruct the original query string so the server can verify HMAC.
    const rawQuery = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
    if (!code || !shop) {
      setStatus("error");
      setMessage("Missing code or shop from Shopify. Please try connecting again.");
      return;
    }
    if (!user) {
      setStatus("error");
      setMessage("You must be logged in to connect a store. Redirecting to login…");
      setTimeout(() => router.replace("/login"), 2000);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const redirectUri = `${window.location.origin}/dashboard/integrations/shopify/callback`;
        const res = await fetch("/api/shopify/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code, shop, redirect_uri: redirectUri, state, hmac, raw_query: rawQuery }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          const msg = data.error || "Failed to connect store.";
          setMessage(data.detail ? `${msg}: ${data.detail}` : msg);
          return;
        }
        const billingUrl =
          typeof data.billingConfirmationUrl === "string" ? data.billingConfirmationUrl.trim() : "";
        if (billingUrl) {
          setStatus("success");
          setMessage("Store connected. Opening Shopify to confirm the app subscription (required for billing)…");
          window.location.assign(billingUrl);
          return;
        }
        if (typeof data.billingNotice === "string" && data.billingNotice) {
          console.warn("[Shopify callback] billingNotice:", data.billingNotice);
        }
        setStatus("success");
        setMessage(`Connected ${data.shop ?? shop}. Redirecting…`);
        setTimeout(() => router.replace("/dashboard/integrations"), 1500);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, user, router]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === "success" && <CheckCircle className="h-5 w-5 text-green-600" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {status === "loading" && "Connecting your store…"}
            {status === "success" && "Store connected"}
            {status === "error" && "Connection failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {status === "error" && (
            <Button asChild variant="default">
              <Link href="/dashboard/integrations">Back to Integrations</Link>
            </Button>
          )}
          {status === "loading" && (
            <p className="text-xs text-muted-foreground">Do not close this page.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
