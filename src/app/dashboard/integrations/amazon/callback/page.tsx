"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

/**
 * Amazon Redirect URI — receives spapi_oauth_code after seller consent.
 */
export default function AmazonCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting Amazon account…");

  useEffect(() => {
    if (authLoading) return;

    const code = searchParams.get("spapi_oauth_code") || searchParams.get("code");
    const state = searchParams.get("state");
    const sellingPartnerId =
      searchParams.get("selling_partner_id") ||
      (typeof window !== "undefined"
        ? sessionStorage.getItem("amazon_selling_partner_id")
        : null);
    const err = searchParams.get("error_description") || searchParams.get("error");

    if (err) {
      setStatus("error");
      setMessage(err);
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code from Amazon. You may have declined access.");
      return;
    }

    if (!user) {
      setStatus("error");
      setMessage("You must be logged in to connect. Redirecting to login…");
      setTimeout(() => router.replace("/login"), 2000);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/integrations/amazon/exchange-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            code,
            state,
            sellingPartnerId: sellingPartnerId || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          const msg = data.error || "Failed to connect Amazon account.";
          setMessage(data.detail ? `${msg}: ${data.detail}` : msg);
          return;
        }
        try {
          sessionStorage.removeItem("amazon_selling_partner_id");
        } catch {
          /* ignore */
        }
        setStatus("success");
        setMessage(
          data.environment === "sandbox"
            ? "Amazon sandbox account connected. Redirecting…"
            : "Amazon account connected. Redirecting…"
        );
        setTimeout(() => router.replace("/dashboard/integrations"), 1500);
      } catch (e: unknown) {
        if (cancelled) return;
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, searchParams, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === "success" && <CheckCircle className="h-5 w-5 text-green-600" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {status === "loading" && "Connecting…"}
            {status === "success" && "Connected"}
            {status === "error" && "Connection failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {status === "error" && (
            <Button asChild>
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
