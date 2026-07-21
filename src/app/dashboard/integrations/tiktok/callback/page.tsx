"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function TikTokCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);

  useEffect(() => {
    const code =
      searchParams.get("code") ||
      searchParams.get("auth_code") ||
      searchParams.get("authCode");
    const state = searchParams.get("state") ?? "";
    if (!code) {
      setStatus("error");
      setMessage("Missing authorization code from TikTok. Please try connecting again.");
      return;
    }
    if (!user) {
      setStatus("error");
      setMessage("You must be logged in to connect a shop. Redirecting to login…");
      setTimeout(() => router.replace("/login"), 2000);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/tiktok/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code, auth_code: code, state }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          const msg = data.error || "Failed to connect TikTok Shop.";
          setMessage(data.detail ? `${msg}: ${data.detail}` : msg);
          return;
        }
        setConnectionId(typeof data.connectionId === "string" ? data.connectionId : null);
        setStatus("success");
        setMessage(`Connected ${data.shopName ?? "TikTok Shop"}. Redirecting…`);
        const next =
          typeof data.connectionId === "string"
            ? `/dashboard/integrations/tiktok/products?connectionId=${encodeURIComponent(data.connectionId)}`
            : "/dashboard/integrations";
        setTimeout(() => router.replace(next), 1200);
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, user, router]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "loading" && <Loader2 className="h-5 w-5 animate-spin" />}
            {status === "success" && <CheckCircle className="h-5 w-5 text-green-600" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            {status === "loading" && "Connecting TikTok Shop…"}
            {status === "success" && "Shop connected"}
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
          {status === "success" && connectionId && (
            <Button asChild variant="outline">
              <Link
                href={`/dashboard/integrations/tiktok/products?connectionId=${encodeURIComponent(connectionId)}`}
              >
                Select products
              </Link>
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
