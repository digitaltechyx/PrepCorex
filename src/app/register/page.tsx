"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { generateClientId } from "@/lib/client-id";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import { findDefaultWarehouseLocationId } from "@/lib/default-warehouse";
import { Logo } from "@/components/logo";
import { Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { buildUserUniqueFieldKeys } from "@/lib/user-unique-fields";
import {
  checkUserFieldsUniqueClient,
  claimUserFieldUniquesClient,
  uniquenessConflictMessage,
} from "@/lib/user-uniqueness-client";
import { sendUserVerificationEmail } from "@/lib/email-verification";
import type { PlatformDocumentSlug, PlatformDocumentSummary } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS } from "@/lib/platform-documents-types";

const REGISTRATION_DOCUMENT_SLUGS = ["terms", "privacy"] as const satisfies readonly PlatformDocumentSlug[];

const formSchema = z.object({
  contactName: z.string().min(2, { message: "Contact name must be at least 2 characters." }),
  companyName: z.string().min(1, { message: "Company name is required." }),
  phone: z.string().min(10, { message: "Please enter a valid phone number." }),
  email: z.string().email({ message: "Invalid email address." }),
  referralCode: z.string().optional(),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
  documentsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must agree to the listed documents.",
  }),
  authorizedRepresentative: z.boolean().refine((val) => val === true, {
    message: "You must confirm you are authorized to accept on behalf of your company.",
  }),
});

function DocumentViewLink({ slug, label }: { slug: PlatformDocumentSlug; label: string }) {
  return (
    <a
      href={`/api/platform-documents/${slug}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [documentVersions, setDocumentVersions] = useState<
    Partial<Record<PlatformDocumentSlug, number>>
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform-documents");
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.documents)) {
          const map: Partial<Record<PlatformDocumentSlug, number>> = {};
          for (const doc of data.documents as PlatformDocumentSummary[]) {
            map[doc.slug] = doc.version;
          }
          setDocumentVersions(map);
        }
      } catch {
        // Defaults applied on submit if fetch fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactName: "",
      companyName: "",
      phone: "",
      email: "",
      referralCode: "",
      password: "",
      documentsAccepted: false,
      authorizedRepresentative: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      let referredByAgentId: string | null = null;

      if (values.referralCode && values.referralCode.trim() !== "") {
        const referralCode = values.referralCode.trim().toUpperCase();
        const agentsQuery = query(
          collection(db, "users"),
          where("referralCode", "==", referralCode),
          where("role", "==", "commission_agent"),
          where("status", "==", "approved")
        );
        const agentsSnapshot = await getDocs(agentsQuery);

        if (!agentsSnapshot.empty) {
          referredByAgentId = agentsSnapshot.docs[0].id;
        } else {
          toast({
            variant: "destructive",
            title: "Invalid Referral Code",
            description: "The referral code you entered is invalid or the agent is not approved.",
          });
          setIsLoading(false);
          return;
        }
      }

      const uniqueCheck = await checkUserFieldsUniqueClient({
        companyName: values.companyName.trim(),
        phone: values.phone,
      });
      if (!uniqueCheck.ok) {
        toast({
          variant: "destructive",
          title: "Registration blocked",
          description: uniquenessConflictMessage(uniqueCheck),
        });
        setIsLoading(false);
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );
      const user = userCredential.user;

      const acceptedDocuments = Object.fromEntries(
        REGISTRATION_DOCUMENT_SLUGS.map((slug) => [
          slug,
          { version: documentVersions[slug] ?? 1 },
        ])
      );

      const uniqueKeys = buildUserUniqueFieldKeys({
        companyName: values.companyName.trim(),
        phone: values.phone,
      });

      const userData: Record<string, unknown> = {
        uid: user.uid,
        name: values.contactName.trim(),
        email: values.email,
        phone: values.phone,
        password: values.password,
        companyName: values.companyName.trim(),
        ...uniqueKeys,
        role: "user",
        roles: ["user"],
        features: [],
        status: "pending",
        emailVerificationRequired: true,
        createdAt: new Date(),
        clientId: await generateClientId(),
        platformAgreementsAccepted: {
          acceptedAt: new Date(),
          authorizedRepresentative: true,
          documents: acceptedDocuments,
        },
      };

      if (values.referralCode && values.referralCode.trim() !== "" && referredByAgentId) {
        userData.referredBy = values.referralCode.trim().toUpperCase();
        userData.referredByAgentId = referredByAgentId;
      }

      const defaultWarehouseId = await findDefaultWarehouseLocationId();
      if (defaultWarehouseId) {
        userData.locations = [defaultWarehouseId];
      }

      await setDoc(doc(db, "users", user.uid), userData);

      try {
        const token = await user.getIdToken();
        const claim = await claimUserFieldUniquesClient(token, {
          companyName: values.companyName.trim(),
          phone: values.phone,
        });
        if (!claim.ok) {
          await user.delete();
          toast({
            variant: "destructive",
            title: "Registration blocked",
            description: uniquenessConflictMessage(claim),
          });
          setIsLoading(false);
          return;
        }
      } catch {
        // Registry claim failed after account creation — admin can reconcile
      }

      try {
        const token = await user.getIdToken();
        await fetch("/api/email/account", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: "welcome",
            contactName: values.contactName.trim(),
            companyName: values.companyName.trim(),
            email: values.email,
          }),
        });
      } catch {
        // Account created; email failure is non-blocking
      }

      try {
        const token = await user.getIdToken();
        await fetch("/api/audit/log", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: "account_created",
            description: `Account registered for ${values.companyName.trim()}.`,
            metadata: {
              companyName: values.companyName.trim(),
              email: values.email,
              userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            },
          }),
        });
      } catch {
        // Non-blocking
      }

      try {
        await sendUserVerificationEmail(user);
      } catch {
        toast({
          variant: "destructive",
          title: "Could not send verification email",
          description: "Your account was created. Use Resend on the next screen or contact support.",
        });
      }

      toast({
        title: "Account created",
        description:
          "Check your email to verify your address. Your account is under review after verification.",
      });
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full min-h-screen relative">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-950 dark:via-purple-950 dark:to-pink-950 -z-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/30 dark:bg-indigo-700/20 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-0 right-0 w-96 h-96 bg-purple-300/30 dark:bg-purple-700/20 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-300/20 dark:bg-pink-700/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "2s" }}
        />
      </div>
      <div className="flex items-center justify-center py-12 min-h-screen">
        <div className="mx-auto grid w-full max-w-[500px] gap-6 px-4">
          <div className="grid gap-2 text-center">
            <Logo variant="auth" />
            <h1 className="text-3xl font-bold font-headline mt-4">Create Your Account</h1>
            <p className="text-balance text-muted-foreground">
              Register your company to access the PrepCorex client portal
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="ABC Company Inc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone *</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Enter your phone number"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input placeholder="m@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="referralCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Referral Code (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter referral code if you have one"
                        {...field}
                        className="uppercase"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
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
                    <FormLabel>Password *</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                <FormField
                  control={form.control}
                  name="documentsAccepted"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-2 leading-none">
                        <FormLabel className="text-sm font-normal cursor-pointer">
                          I have read and agree to the following documents:
                        </FormLabel>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          <li>
                            {PLATFORM_DOCUMENT_LABELS.terms.shortLabel} (
                            <DocumentViewLink slug="terms" label="View" />)
                          </li>
                          <li>
                            {PLATFORM_DOCUMENT_LABELS.privacy.shortLabel} (
                            <DocumentViewLink slug="privacy" label="View" />)
                          </li>
                        </ul>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="authorizedRepresentative"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm font-normal cursor-pointer">
                          I confirm that I am authorized to create this account and accept these
                          agreements on behalf of my company.
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create account
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="underline text-primary">
              Login
            </Link>
          </div>
          <div className="mt-2 text-center text-sm">
            Want to join our affiliate program?{" "}
            <Link href="/register-agent" className="underline text-primary font-semibold">
              Apply as Affiliate
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
