"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Loader2,
  Sparkles,
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { MSA_SERVICE_PROVIDER } from "@/lib/msa-content";
import {
  BUSINESS_TYPES,
  SALES_VOLUME_OPTIONS,
  SERVICES_NEEDED_OPTIONS,
} from "@/lib/onboarding-options";
import { formatMsaAgreementVersionLabel } from "@/lib/platform-document-control";
import { getDefaultFeaturesForRole, hasRole, isAccountActivated } from "@/lib/permissions";
import { logUserAuditEvent } from "@/lib/user-audit-trail-client";
import { createMsaDocumentSnapshot } from "@/lib/signed-msa-pdf";
import {
  checkUserFieldsUniqueClient,
  claimUserFieldUniquesClient,
  uniquenessConflictMessage,
} from "@/lib/user-uniqueness-client";
import { auth } from "@/lib/firebase";
import type { PlatformDocument } from "@/lib/platform-documents-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STEPS = ["Welcome", "Business", "Services", "Agreement"] as const;

function SectionBody({ body }: { body: string }) {
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return (
      <div
        className="prose prose-sm max-w-none text-muted-foreground leading-relaxed"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    );
  }
  return <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{body}</p>;
}

export function ActivateAccountWizard() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMsa, setLoadingMsa] = useState(true);
  const [msaDocument, setMsaDocument] = useState<PlatformDocument | null>(null);

  const [businessType, setBusinessType] = useState("");
  const [ein, setEin] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [zipCode, setZipCode] = useState("");

  const [servicesNeeded, setServicesNeeded] = useState<string[]>([]);
  const [salesVolume, setSalesVolume] = useState("");

  const [acceptMsa, setAcceptMsa] = useState(false);
  const [acceptSchedules, setAcceptSchedules] = useState(false);
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false);
  const [legalName, setLegalName] = useState("");

  useEffect(() => {
    if (loading || !userProfile) return;
    if (!hasRole(userProfile, "user") || isAccountActivated(userProfile)) {
      router.replace("/dashboard");
      return;
    }

    setBusinessType(userProfile.businessType ?? "");
    setEin(userProfile.ein ?? "");
    setAddress(userProfile.address ?? "");
    setCity(userProfile.city ?? "");
    setState(userProfile.state ?? "");
    setCountry(userProfile.country ?? "");
    setZipCode(userProfile.zipCode ?? "");
    setServicesNeeded(userProfile.servicesNeeded ?? []);
    setSalesVolume(userProfile.salesVolume ?? "");
    setLegalName(userProfile.name ?? "");

    if (userProfile.onboardingProfileCompletedAt) {
      setStep(3);
    }
  }, [userProfile, loading, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMsa(true);
      try {
        const res = await fetch("/api/platform-documents/msa", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled && res.ok) {
          setMsaDocument(data.document as PlatformDocument);
        }
      } catch {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Could not load agreement",
            description: "Please refresh and try again.",
          });
        }
      } finally {
        if (!cancelled) setLoadingMsa(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const toggleService = (service: string, checked: boolean) => {
    setServicesNeeded((prev) =>
      checked ? [...prev, service] : prev.filter((s) => s !== service)
    );
  };

  const saveProfilePartial = async () => {
    if (!userProfile?.uid) return;

    const uniqueCheck = await checkUserFieldsUniqueClient(
      {
        companyName: userProfile.companyName,
        ein: ein.trim(),
        phone: userProfile.phone,
      },
      userProfile.uid
    );
    if (!uniqueCheck.ok) {
      throw new Error(uniquenessConflictMessage(uniqueCheck));
    }

    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Not authenticated.");
    const claim = await claimUserFieldUniquesClient(token, {
      companyName: userProfile.companyName,
      ein: ein.trim(),
      phone: userProfile.phone,
    });
    if (!claim.ok) {
      throw new Error(uniquenessConflictMessage(claim));
    }

    await updateDoc(doc(db, "users", userProfile.uid), {
      businessType: businessType.trim(),
      ein: ein.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
      zipCode: zipCode.trim(),
      servicesNeeded,
      salesVolume: salesVolume.trim(),
      onboardingProfileCompletedAt: serverTimestamp(),
    });
  };

  const validateBusiness = () => {
    if (!businessType || !ein.trim() || !address.trim() || !city.trim() || !state.trim() || !country.trim() || !zipCode.trim()) {
      toast({
        variant: "destructive",
        title: "Business information required",
        description: "Please complete all required business fields, including EIN.",
      });
      return false;
    }
    return true;
  };

  const validateServices = () => {
    if (servicesNeeded.length === 0 || !salesVolume) {
      toast({
        variant: "destructive",
        title: "Services information required",
        description: "Select at least one service and your sales volume.",
      });
      return false;
    }
    return true;
  };

  const handleContinue = async () => {
    if (step === 1) {
      if (!validateBusiness()) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!validateServices()) return;
      setSubmitting(true);
      try {
        await saveProfilePartial();
        await logUserAuditEvent("profile_completed", {
          description: "Completed business profile and services onboarding steps.",
          metadata: {
            businessType: businessType.trim(),
            servicesNeeded,
            salesVolume: salesVolume.trim(),
          },
        });
        setStep(3);
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Could not save profile",
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleActivate = async () => {
    if (!userProfile?.uid || !msaDocument) return;
    if (!acceptMsa || !acceptSchedules || !authorityConfirmed) {
      toast({
        variant: "destructive",
        title: "Acceptance required",
        description: "Please check all agreement boxes to continue.",
      });
      return;
    }
    if (!legalName.trim()) {
      toast({
        variant: "destructive",
        title: "Legal name required",
        description: "Enter your full legal name to activate your account.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const effectiveIso = msaDocument.effectiveAt || msaDocument.updatedAt;
      const msaEffectiveDate = effectiveIso
        ? format(new Date(effectiveIso), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      const hasExistingFeatures = Array.isArray(userProfile.features) && userProfile.features.length > 0;
      const updateData: Record<string, unknown> = {
        businessType: businessType.trim(),
        ein: ein.trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        country: country.trim(),
        zipCode: zipCode.trim(),
        servicesNeeded,
        salesVolume: salesVolume.trim(),
        onboardingProfileCompletedAt: serverTimestamp(),
        accountActivatedAt: serverTimestamp(),
        msaEffectiveDate,
        msaClientDetails: {
          legalName: legalName.trim(),
          companyName: userProfile.companyName ?? "",
          address: [address, city, state, country, zipCode].filter(Boolean).join(", "),
          email: userProfile.email ?? "",
          phone: userProfile.phone ?? "",
        },
        msaAcceptance: {
          version: msaDocument.version,
          effectiveAt: effectiveIso ?? null,
          acceptedAt: new Date().toISOString(),
          acceptMsa: true,
          acceptSchedules: true,
          authorityConfirmed: true,
          legalName: legalName.trim(),
        },
        msaDocumentSnapshot: createMsaDocumentSnapshot(msaDocument),
      };
      if (!hasExistingFeatures) {
        updateData.features = getDefaultFeaturesForRole("user");
      }

      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated.");
      const claim = await claimUserFieldUniquesClient(token, {
        companyName: userProfile.companyName,
        ein: ein.trim(),
        phone: userProfile.phone,
      });
      if (!claim.ok) {
        throw new Error(uniquenessConflictMessage(claim));
      }

      await updateDoc(doc(db, "users", userProfile.uid), updateData);
      await logUserAuditEvent("account_activated", {
        description: "Accepted MSA and activated account.",
        metadata: {
          msaVersion: msaDocument.version,
          legalName: legalName.trim(),
        },
      });
      toast({
        title: "Account activated",
        description: "Welcome to PrepCorex! Your dashboard is now ready.",
      });
      router.replace("/dashboard");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Activation failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !userProfile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasRole(userProfile, "user") || isAccountActivated(userProfile)) {
    return null;
  }

  const agreementLabel = msaDocument
    ? formatMsaAgreementVersionLabel(msaDocument)
    : "MSA v1.0";

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/20 to-background">
      <div className="mx-auto max-w-3xl space-y-6 py-10 px-4 sm:px-6">
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {STEPS.map((label, index) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                  index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {index + 1}
              </div>
              <span className={cn("text-xs sm:text-sm", index === step ? "font-medium" : "text-muted-foreground")}>
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground mx-1 hidden sm:block" />
              ) : null}
            </div>
          ))}
        </div>

        {step === 0 && (
          <Card className="rounded-2xl border-2 shadow-sm">
            <CardHeader className="text-center space-y-3 pb-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <CardTitle className="text-3xl">Welcome to PrepCorex</CardTitle>
              <CardDescription className="text-base max-w-lg mx-auto">
                Your account has been approved. Before accessing your dashboard, please complete your
                profile and accept the Master Service Agreement.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pb-8">
              <Button size="lg" onClick={() => setStep(1)} className="min-w-[200px]">
                Complete your profile
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card className="rounded-2xl border-2 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Business information
              </CardTitle>
              <CardDescription>Tell us about your company.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Business type *</Label>
                <Select value={businessType} onValueChange={setBusinessType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select business type" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ein">EIN *</Label>
                <Input id="ein" value={ein} onChange={(e) => setEin(e.target.value)} placeholder="XX-XXXXXXX" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Business address *</Label>
                <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Input id="state" value={state} onChange={(e) => setState(e.target.value)} required />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="country">Country *</Label>
                  <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP / Postal code *</Label>
                  <Input id="zip" value={zipCode} onChange={(e) => setZipCode(e.target.value)} required />
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
                <Button type="button" onClick={handleContinue}>
                  Continue
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="rounded-2xl border-2 shadow-sm">
            <CardHeader>
              <CardTitle>Services needed</CardTitle>
              <CardDescription>Select the services you plan to use with Prep Services FBA.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Services *</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SERVICES_NEEDED_OPTIONS.map((service) => (
                    <label
                      key={service}
                      className="flex items-center gap-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/30"
                    >
                      <Checkbox
                        checked={servicesNeeded.includes(service)}
                        onCheckedChange={(c) => toggleService(service, !!c)}
                      />
                      <span className="text-sm">{service}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Sales volume *</Label>
                <Select value={salesVolume} onValueChange={setSalesVolume}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select monthly volume" />
                  </SelectTrigger>
                  <SelectContent>
                    {SALES_VOLUME_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
                <Button type="button" onClick={() => void handleContinue()} disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Continue to agreement
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-2">
                <FileSignature className="h-7 w-7" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Master Service Agreement</h1>
              <p className="text-sm text-muted-foreground">{agreementLabel}</p>
            </div>

            <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardDescription className="text-base">
                  Agreement between {MSA_SERVICE_PROVIDER.name} and{" "}
                  <span className="font-medium text-foreground">{userProfile.companyName}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingMsa ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ScrollArea className="h-[360px] w-full px-6 py-4">
                    <div className="space-y-5 pr-4">
                      {(msaDocument?.sections ?? []).map((section, i) => (
                        <div key={`${section.title}-${i}`} className={cn(i > 0 && "pt-4 border-t border-border/60")}>
                          <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide mb-1.5">
                            {section.title}
                          </h3>
                          <SectionBody body={section.body} />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-2 border-primary/20 bg-primary/5 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Acceptance
                </CardTitle>
                <CardDescription>
                  Agreement Version: <strong>{agreementLabel}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-start gap-3 rounded-xl border bg-background/80 p-3 cursor-pointer">
                  <Checkbox checked={acceptMsa} onCheckedChange={(c) => setAcceptMsa(!!c)} className="mt-0.5" />
                  <span className="text-sm leading-relaxed">
                    I have reviewed and accept the Master Service Agreement.
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border bg-background/80 p-3 cursor-pointer">
                  <Checkbox checked={acceptSchedules} onCheckedChange={(c) => setAcceptSchedules(!!c)} className="mt-0.5" />
                  <span className="text-sm leading-relaxed">
                    I understand the warehouse operating policies, billing terms, and liability limitations
                    (Schedule A, B, C, D).
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border bg-background/80 p-3 cursor-pointer">
                  <Checkbox
                    checked={authorityConfirmed}
                    onCheckedChange={(c) => setAuthorityConfirmed(!!c)}
                    className="mt-0.5"
                  />
                  <span className="text-sm leading-relaxed">
                    I confirm that I have authority to legally bind my company.
                  </span>
                </label>

                <div className="space-y-2">
                  <Label htmlFor="legalName" className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    Authorized representative (legal name) *
                  </Label>
                  <Input
                    id="legalName"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Full legal name"
                    className="max-w-md"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-between pt-2">
                  <Button type="button" variant="outline" onClick={() => setStep(2)}>
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button variant="outline" asChild>
                      <a
                        href={
                          msaDocument
                            ? `/api/platform-documents/msa/pdf?version=${msaDocument.version}&t=${encodeURIComponent(msaDocument.updatedAt || "")}`
                            : "/api/platform-documents/msa/pdf"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View full PDF
                      </a>
                    </Button>
                    <Button
                      size="lg"
                      onClick={() => void handleActivate()}
                      disabled={submitting || loadingMsa || !msaDocument}
                      className="min-w-[180px]"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Activating...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-5 w-5" />
                          Activate account
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
