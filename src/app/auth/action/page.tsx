"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "firebase/auth";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Logo } from "@/components/logo";
import { PlaceHolderImages } from "@/lib/placeholder-images";

const resetSchema = z
  .object({
    password: z
      .string()
      .min(6, { message: "Password must be at least 6 characters." }),
    confirmPassword: z.string().min(6, {
      message: "Confirm password must be at least 6 characters.",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

function authErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: string }).code || "");
  }
  return "";
}

function friendlyAuthError(code: string, fallback: string): string {
  switch (code) {
    case "auth/expired-action-code":
      return "This link has expired. Request a new password reset email.";
    case "auth/invalid-action-code":
      return "This link is invalid or was already used. Request a new password reset email.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/user-not-found":
      return "No account found for this reset link.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 6 characters).";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return code ? `${fallback} (${code})` : fallback;
  }
}

function safeContinuePath(continueUrl: string | null): string {
  if (!continueUrl) return "/login";
  try {
    if (continueUrl.startsWith("/") && !continueUrl.startsWith("//")) {
      return continueUrl;
    }
    const parsed = new URL(continueUrl);
    const appOrigin = (
      process.env.NEXT_PUBLIC_APP_URL || "https://prepcorex.com"
    ).replace(/\/$/, "");
    const allowed = new Set([
      "https://prepcorex.com",
      "https://www.prepcorex.com",
      appOrigin,
    ]);
    if (typeof window !== "undefined") {
      allowed.add(window.location.origin);
    }
    if (allowed.has(parsed.origin)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/login";
    }
  } catch {
    // ignore
  }
  return "/login";
}

export default function AuthActionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <AuthActionContent />
    </Suspense>
  );
}

function AuthActionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const authBg = PlaceHolderImages.find((p) => p.id === "auth-background");

  const mode = (searchParams.get("mode") || "").trim();
  const oobCode = (searchParams.get("oobCode") || "").trim();
  const continueUrl = searchParams.get("continueUrl");
  const continuePath = useMemo(() => safeContinuePath(continueUrl), [continueUrl]);

  const [checking, setChecking] = useState(true);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [verifyDone, setVerifyDone] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setChecking(true);
      setLinkError(null);
      setAccountEmail(null);
      setVerifyDone(false);
      setResetDone(false);

      if (!oobCode) {
        if (!cancelled) {
          setLinkError("This link is missing a reset code. Open the latest email and try again.");
          setChecking(false);
        }
        return;
      }

      try {
        if (mode === "resetPassword") {
          const email = await verifyPasswordResetCode(auth, oobCode);
          if (!cancelled) setAccountEmail(email);
        } else if (mode === "verifyEmail" || mode === "recoverEmail" || mode === "verifyAndChangeEmail") {
          await applyActionCode(auth, oobCode);
          if (!cancelled) setVerifyDone(true);
        } else if (!mode) {
          if (!cancelled) {
            setLinkError("This link is incomplete (missing mode). Open the latest email and try again.");
          }
        } else {
          if (!cancelled) {
            setLinkError(`Unsupported action “${mode}”. Open the latest email or contact support.`);
          }
        }
      } catch (error: unknown) {
        const code = authErrorCode(error);
        if (!cancelled) {
          setLinkError(
            friendlyAuthError(
              code,
              mode === "resetPassword"
                ? "Unable to validate this password reset link."
                : "Unable to complete this email action."
            )
          );
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, oobCode]);

  async function onResetSubmit(values: z.infer<typeof resetSchema>) {
    if (!oobCode) return;
    setIsSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, values.password);
      setResetDone(true);
      toast({
        title: "Password updated",
        description: "You can sign in with your new password.",
      });
      setTimeout(() => router.replace(continuePath), 1200);
    } catch (error: unknown) {
      const code = authErrorCode(error);
      toast({
        variant: "destructive",
        title: "Could not reset password",
        description: friendlyAuthError(code, "Unable to set a new password."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const title =
    mode === "resetPassword"
      ? "Choose a new password"
      : mode === "verifyEmail" || mode === "verifyAndChangeEmail"
        ? "Email verification"
        : mode === "recoverEmail"
          ? "Email recovery"
          : "Account action";

  return (
    <div className="w-full lg:grid lg:min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center py-12">
        <div className="mx-auto grid w-[350px] gap-6">
          <div className="grid gap-2 text-center">
            <Logo variant="auth" />
            <h1 className="text-3xl font-bold font-headline mt-4">{title}</h1>
            {mode === "resetPassword" && accountEmail && !resetDone && !linkError ? (
              <p className="text-sm text-muted-foreground">
                Resetting password for{" "}
                <span className="font-medium text-foreground">{accountEmail}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                PrepCorex account security
              </p>
            )}
          </div>

          {checking ? (
            <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              Validating link…
            </div>
          ) : linkError ? (
            <div className="grid gap-4 text-center text-sm">
              <p className="text-destructive">{linkError}</p>
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new reset link</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          ) : resetDone ? (
            <div className="grid gap-4 text-center text-sm">
              <p className="text-muted-foreground">
                Your password was updated. Redirecting you to sign in…
              </p>
              <Button asChild className="w-full">
                <Link href={continuePath}>Continue to login</Link>
              </Button>
            </div>
          ) : verifyDone ? (
            <div className="grid gap-4 text-center text-sm">
              <p className="text-muted-foreground">
                {mode === "recoverEmail"
                  ? "Your email address was restored."
                  : "Your email was verified successfully."}
              </p>
              <Button asChild className="w-full">
                <Link href={continuePath}>Continue to login</Link>
              </Button>
            </div>
          ) : mode === "resetPassword" ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onResetSubmit)} className="grid gap-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder="••••••••"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder="••••••••"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save new password
                </Button>
              </form>
            </Form>
          ) : (
            <div className="grid gap-4 text-center text-sm">
              <p className="text-muted-foreground">Nothing to do on this link.</p>
              <Button asChild className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          )}

          {!checking && !resetDone && !verifyDone ? (
            <div className="mt-2 text-center text-sm text-muted-foreground">
              <Link href="/login" className="underline text-primary font-medium">
                Back to login
              </Link>
            </div>
          ) : null}
        </div>
      </div>
      <div className="hidden bg-muted lg:block relative overflow-hidden">
        {authBg && (
          <Image
            src={authBg.imageUrl}
            alt={authBg.description}
            width="1200"
            height="800"
            data-ai-hint={authBg.imageHint}
            className="h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
          />
        )}
        <div className="absolute inset-0 bg-black/20" />
      </div>
    </div>
  );
}
