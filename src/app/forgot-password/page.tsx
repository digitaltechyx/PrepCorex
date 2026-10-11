"use client";

import Link from "next/link";
import Image from "next/image";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { sendPasswordResetEmail } from "firebase/auth";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
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

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const authBg = PlaceHolderImages.find((p) => p.id === "auth-background");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    const prefill = searchParams.get("email")?.trim();
    if (prefill) form.setValue("email", prefill);
  }, [searchParams, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const email = values.email.trim().toLowerCase();
    try {
      const continueUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/login`
          : "https://prepcorex.com/login";

      await sendPasswordResetEmail(auth, email, {
        url: continueUrl,
        handleCodeInApp: false,
      });

      setSentTo(email);
      toast({
        title: "Check your email",
        description:
          "If an account exists for that address, we sent a password reset link. It may take a minute to arrive.",
      });
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code || "")
          : "";

      // Same generic success for user-not-found (avoid email enumeration)
      if (code === "auth/user-not-found" || code === "auth/invalid-email") {
        setSentTo(email);
        toast({
          title: "Check your email",
          description:
            "If an account exists for that address, we sent a password reset link. It may take a minute to arrive.",
        });
        return;
      }

      let friendly = "Unable to send reset email. Please try again.";
      if (code === "auth/too-many-requests") {
        friendly = "Too many attempts. Please try again later.";
      } else if (code === "auth/network-request-failed") {
        friendly = "Network error. Check your connection and try again.";
      }

      toast({
        variant: "destructive",
        title: "Reset failed",
        description: friendly,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full lg:grid lg:min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center py-12">
        <div className="mx-auto grid w-[350px] gap-6">
          <div className="grid gap-2 text-center">
            <Logo variant="auth" />
            <h1 className="text-3xl font-bold font-headline mt-4">Forgot password</h1>
            <p className="text-sm text-muted-foreground">
              Enter your login email and we&apos;ll send a reset link.
            </p>
          </div>

          {sentTo ? (
            <div className="grid gap-4 text-center text-sm">
              <p className="text-muted-foreground">
                If <span className="font-medium text-foreground">{sentTo}</span> is registered,
                open the email and follow the link to choose a new password.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
              <button
                type="button"
                className="text-primary underline text-sm font-medium"
                onClick={() => {
                  setSentTo(null);
                  form.reset({ email: sentTo });
                }}
              >
                Try a different email
              </button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="m@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset link
                </Button>
              </form>
            </Form>
          )}

          <div className="mt-2 text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link href="/login" className="underline text-primary font-medium">
              Back to login
            </Link>
          </div>
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
