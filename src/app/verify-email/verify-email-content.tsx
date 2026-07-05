"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { Loader2, Mail, RefreshCw, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isEmailVerificationSatisfied,
  reloadAuthUser,
  sendUserVerificationEmail,
  userRequiresEmailVerification,
} from "@/lib/email-verification";

export default function VerifyEmailPage() {
  const { user, userProfile, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);

  const emailParam = searchParams.get("email");
  const displayEmail = user?.email || emailParam || "";

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (emailParam) return;
      router.replace("/login");
      return;
    }
    if (!userRequiresEmailVerification(userProfile)) {
      router.replace("/login");
      return;
    }
    if (isEmailVerificationSatisfied(userProfile, user)) {
      if (userProfile?.status === "pending") {
        router.replace("/pending-approval");
      } else {
        router.replace("/login?verified=1");
      }
    }
  }, [loading, user, userProfile, router, emailParam]);

  const handleResend = async () => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Sign in required",
        description: "Log in with your password to resend the verification email.",
      });
      router.push("/login");
      return;
    }
    setResending(true);
    try {
      const result = await sendUserVerificationEmail(user);
      if (result.throttled) {
        toast({
          title: "Verification email already sent",
          description: `Please check your inbox. You can resend again in about ${result.cooldownSeconds ?? 60} seconds.`,
        });
        return;
      }
      toast({
        title: "Verification email sent",
        description: "Check your inbox for a message from PrepCorex with the confirmation link.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not send email",
        description: err instanceof Error ? err.message : "Please try again in a few minutes.",
      });
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    if (!user) return;
    setChecking(true);
    try {
      await reloadAuthUser();
      const refreshed = auth.currentUser;
      if (refreshed?.emailVerified) {
        toast({
          title: "Email verified",
          description: "Thank you! You can continue once your account is approved.",
        });
        if (userProfile?.status === "pending") {
          router.replace("/pending-approval");
        } else {
          router.replace("/login?verified=1");
        }
        return;
      }
      toast({
        title: "Not verified yet",
        description: "Open the link in your email, then click “I've verified my email” again.",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-950 dark:via-purple-950 dark:to-pink-950 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Logo variant="auth" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100">
              <Mail className="h-7 w-7 text-indigo-600" />
            </div>
            <CardTitle className="text-2xl">Verify your email</CardTitle>
            <CardDescription className="text-base">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">{displayEmail || "your email"}</span>.
              Please verify before signing in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground space-y-2">
              <p className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-indigo-500" />
                Click the link in the email to confirm your address.
              </p>
              <p>After verification, your account will remain under admin review until approved.</p>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={() => void handleCheckVerified()}
              disabled={checking || !user}
            >
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              I&apos;ve verified my email
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void handleResend()}
              disabled={resending}
            >
              {resending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Resend verification email
            </Button>

            <div className="flex flex-col gap-2 pt-2 text-center text-sm">
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Sign out and use a different account
              </button>
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
