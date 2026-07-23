"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { getAmazonRedirectUriClient } from "@/lib/amazon-sp-api-client";

/**
 * Amazon Log-in URI target.
 * Amazon sends: amazon_callback_uri, amazon_state, selling_partner_id, optional version.
 * We authenticate the PrepCorex user, then bounce back to Amazon to finish OAuth.
 */
export default function AmazonLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Continuing Amazon authorization…");

  useEffect(() => {
    if (authLoading) return;

    const amazonCallbackUri = searchParams.get("amazon_callback_uri");
    const amazonState = searchParams.get("amazon_state");
    const sellingPartnerId = searchParams.get("selling_partner_id");
    const version = searchParams.get("version");

    if (!amazonCallbackUri || !amazonState) {
      setStatus("error");
      setMessage("Missing Amazon authorization parameters. Start Connect again from Integrations.");
      return;
    }

    if (!user) {
      const returnTo = `/dashboard/integrations/amazon/login?${searchParams.toString()}`;
      setMessage("You must be logged in. Redirecting to login…");
      setTimeout(() => {
        router.replace(`/login?redirect=${encodeURIComponent(returnTo)}`);
      }, 800);
      return;
    }

    try {
      const redirectUri = getAmazonRedirectUriClient();
      const ourState =
        (typeof window !== "undefined" && sessionStorage.getItem("amazon_oauth_state")) || "";
      const url = new URL(amazonCallbackUri);
      url.searchParams.set("amazon_state", amazonState);
      url.searchParams.set("redirect_uri", redirectUri);
      if (ourState) {
        url.searchParams.set("state", ourState);
      }
      if (version === "beta" || !version) {
        url.searchParams.set("version", "beta");
      }
      if (sellingPartnerId) {
        sessionStorage.setItem("amazon_selling_partner_id", sellingPartnerId);
      }
      window.location.href = url.toString();
    } catch (err: unknown) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to continue Amazon authorization.");
    }
  }, [authLoading, user, searchParams, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {status === "loading" ? "Amazon authorization" : "Authorization failed"}
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
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> Do not close this page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
