"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Cloud, CheckCircle2, ExternalLink, Loader2, Unplug, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function DriveConnectPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const authHeaders = async () => ({
    Authorization: `Bearer ${await user?.getIdToken()}`,
  });

  const refreshStatus = async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/drive/status", {
        headers: await authHeaders(),
      });
      const data = await response.json();
      setConnected(response.ok && data.connected === true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "google-drive-connected"
      ) {
        setConnected(true);
        setAuthUrl(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [user]);

  const handleGetAuthUrl = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/drive/auth', {
        headers: await authHeaders(),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get authorization URL');
      }
      const data = await response.json();
      setAuthUrl(data.authUrl);
      
      // Open in new window
      window.open(data.authUrl, '_blank');
      
      toast({
        title: "Authorization URL Generated",
        description: "A new window has opened. Please sign in with your Google account.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to get authorization URL",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/drive/disconnect", {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not disconnect Google Drive");
      }
      setConnected(false);
      toast({ title: "Google Drive disconnected" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Disconnect failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <Cloud className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-2xl">Connect Google Drive</CardTitle>
              <CardDescription>
                Authenticate with your personal Google Drive (2TB quota)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Why OAuth?</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>✅ Uses your personal Google Drive quota (2TB)</li>
              <li>✅ No storage quota errors</li>
              <li>✅ Files uploaded to your personal account</li>
              <li>✅ One-time authentication</li>
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold">Steps:</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Click the button below to get the authorization URL</li>
              <li>Sign in with your personal Google account (2TB Drive)</li>
              <li>Grant permissions to access Google Drive</li>
              <li>PrepCorex securely stores the refresh token in Firestore</li>
              <li>Return here and confirm the connected status</li>
            </ol>
          </div>

          {connected === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking connection…
            </p>
          ) : connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="flex items-center gap-2 font-medium text-green-800">
                <CheckCircle2 className="h-5 w-5" />
                Google Drive connected
              </p>
              <Button
                variant="outline"
                onClick={() => void handleDisconnect()}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-amber-700">
                <XCircle className="h-4 w-4" />
                Google Drive is not connected
              </p>
              <Button
                onClick={handleGetAuthUrl}
                disabled={isLoading}
                className="w-full"
                size="lg"
              >
                {isLoading ? "Loading..." : "Connect Google Drive"}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {authUrl && (
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-900 mb-1">
                    Authorization URL Generated
                  </p>
                  <p className="text-xs text-green-800 mb-2">
                    A new window should have opened. If not, click the link below:
                  </p>
                  <a 
                    href={authUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline break-all"
                  >
                    {authUrl}
                  </a>
                </div>
              </div>
            </div>
          )}

          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
            <p className="text-sm text-yellow-900">
              Only administrators can start or disconnect this integration. OAuth secrets remain
              in Vercel; the generated refresh token is stored server-side in Firestore.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

