"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, LockKeyhole } from "lucide-react";

type AccessState = {
  loading: boolean;
  pinRequired: boolean;
  unlocked: boolean;
};

export function PublicTrackersPinGate({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<AccessState>({
    loading: true,
    pinRequired: false,
    unlocked: false,
  });
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadAccess = useCallback(async () => {
    setAccess((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch("/api/public/trackers/access", { credentials: "include" });
      const data = (await res.json()) as {
        pinRequired?: boolean;
        unlocked?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not check access.");
      setAccess({
        loading: false,
        pinRequired: Boolean(data.pinRequired),
        unlocked: Boolean(data.unlocked),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check access.");
      setAccess({ loading: false, pinRequired: true, unlocked: false });
    }
  }, []);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const submitPin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/trackers/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Incorrect PIN.");
      }
      setPin("");
      await loadAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Incorrect PIN.");
    } finally {
      setSubmitting(false);
    }
  };

  if (access.loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!access.pinRequired || access.unlocked) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <CardTitle>Enter trackers PIN</CardTitle>
          <CardDescription>
            PrepCorex public trackers are PIN-protected. Enter the code your admin shared with you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPin} className="space-y-4">
            <Input
              type="password"
              inputMode="text"
              autoComplete="off"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={submitting}
              className="text-center text-lg tracking-widest"
            />
            {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting || !pin.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking…
                </>
              ) : (
                "Unlock trackers"
              )}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Admin?{" "}
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>{" "}
            to manage trackers without this PIN.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
