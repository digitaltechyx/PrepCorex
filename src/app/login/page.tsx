"use client";

import Link from "next/link";
import Image from "next/image";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

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
import { auth, db } from "@/lib/firebase";
import { Logo } from "@/components/logo";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Loader2 } from "lucide-react";
import type { UserProfile } from "@/types";
import {
  isEmailVerificationSatisfied,
} from "@/lib/email-verification";

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
});

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const authBg = PlaceHolderImages.find(p => p.id === 'auth-background');

  useEffect(() => {
    if (searchParams.get("verified") === "1") {
      toast({
        title: "Email verified",
        description: "Thank you! You can sign in once your account has been approved.",
      });
    }
  }, [searchParams, toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      // Get user profile to check role
      const userDocRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const userProfile = userDoc.data() as UserProfile;
        
        // Check user status first (default to "approved" for existing users without status)
        const userStatus = userProfile.status || "approved";
        
        if (userStatus === "deleted") {
          toast({
            variant: "destructive",
            title: "Account Deleted",
            description: "Your account has been deleted. Please contact an administrator.",
          });
          await signOut(auth);
          return;
        }

        if (!isEmailVerificationSatisfied(userProfile, user)) {
          toast({
            title: "Verify your email",
            description: "Please confirm your email address before signing in.",
          });
          router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
          return;
        }
        
        // Import permission helpers
        const { hasRole, getUserRoles } = await import("@/lib/permissions");
        
        // Redirect based on roles and status
        const userRoles = getUserRoles(userProfile);
        const hasAdminRole = hasRole(userProfile, 'admin') || hasRole(userProfile, 'sub_admin');
        const hasUserRole = hasRole(userProfile, 'user');
        const hasAgentRole = hasRole(userProfile, 'commission_agent');
        
        if (userStatus === "pending") {
          router.push("/pending-approval");
        } else if (hasAdminRole) {
          // ALWAYS prioritize admin/sub_admin dashboard if user has that role
          // Even if they have other roles, admin dashboard should be the default
          router.push("/admin/dashboard");
        } else if (hasUserRole) {
          // If user has "user" role, redirect to client dashboard
          router.push("/dashboard");
        } else if (hasAgentRole) {
          // If only commission_agent, redirect to agent dashboard
          router.push("/dashboard/agent");
        } else {
          // Fallback to client dashboard
          router.push("/dashboard");
        }
      } else {
        // If no profile exists, redirect to regular dashboard
        router.push("/dashboard");
      }
    } catch (error: any) {
      // Map auth error codes to generic, product-friendly messages
      let friendly = "Unable to sign in. Please try again.";
      const code = error?.code || "";
      switch (code) {
        case "auth/invalid-credential":
        case "auth/invalid-email":
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-login-credentials":
          friendly = "Incorrect email or password.";
          break;
        case "auth/too-many-requests":
          friendly = "Too many attempts. Please try again later.";
          break;
        case "auth/user-disabled":
          friendly = "Your account is disabled. Please contact support.";
          break;
        case "auth/network-request-failed":
          friendly = "Network error. Check your connection and try again.";
          break;
      }

      toast({
        variant: "destructive",
        title: "Login Failed",
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
            <h1 className="text-3xl font-bold font-headline mt-4">Login</h1>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="m@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Login
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm text-muted-foreground space-y-2">
            <div>
              New here?{" "}
              <Link href="/register" className="underline text-primary font-medium">
                Create your account
              </Link>
            </div>
            <div>
              Want to join our affiliate program?{" "}
              <Link href="/register-agent" className="underline text-primary font-medium">
                Apply as Affiliate
            </Link>
            </div>
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
          {/* Optional overlay for better text readability */}
          <div className="absolute inset-0 bg-black/20"></div>
        </div>
    </div>
  );
}

