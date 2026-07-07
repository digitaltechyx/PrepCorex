"use client";

import { Lock, LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  getClientAccountRestrictionMessage,
  isAccountDisabled,
  isAccountLocked,
  isClientPortalAccount,
} from "@/lib/client-account-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientAccountRestrictedOverlay() {
  const { userProfile, signOut } = useAuth();

  if (!userProfile || !isClientPortalAccount(userProfile)) {
    return null;
  }

  const locked = isAccountLocked(userProfile);
  const disabled = isAccountDisabled(userProfile);
  if (!locked && !disabled) {
    return null;
  }

  const message = getClientAccountRestrictionMessage(userProfile.status);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-md" aria-hidden />
      <Card className="relative z-10 w-full max-w-lg border-2 shadow-2xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            {disabled ? <ShieldAlert className="h-7 w-7" /> : <Lock className="h-7 w-7" />}
          </div>
          <CardTitle className="text-xl">
            {disabled ? "Account Disabled" : "Account Locked"}
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed text-foreground">
            {message}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button variant="outline" onClick={() => void signOut()} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
