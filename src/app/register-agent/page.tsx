"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import { Logo } from "@/components/logo";
import { Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  fullName: z.string().min(2, { message: "First and Last name is required." }),
  country: z.string().optional(),
  phone: z.string().min(10, { message: "Please enter a valid phone number with country code." }),
  socialProfile: z.string().optional(),
  salesExperience: z.array(z.string()).min(1, { message: "Please select at least one sales experience option." }),
  salesExperienceOther: z.string().optional(),
  referralSource: z.string().optional(),
  termsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and conditions.",
  }),
  consent: z.boolean().refine((val) => val === true, {
    message: "You must give consent to be contacted.",
  }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
});

export default function RegisterAgentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      fullName: "",
      country: "",
      phone: "",
      socialProfile: "",
      salesExperience: [],
      salesExperienceOther: "",
      referralSource: "",
      termsAccepted: false,
      consent: false,
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: values.fullName,
        email: values.email,
        phone: values.phone,
        password: values.password,
        role: "commission_agent",
        status: "pending",
        createdAt: new Date(),
        // Additional agent registration fields
        country: values.country || "",
        socialProfile: values.socialProfile || "",
        salesExperience: values.salesExperience || [],
        salesExperienceOther: values.salesExperienceOther || "",
        referralSource: values.referralSource || "",
      });

      toast({
        title: "Registration Successful",
        description: "Your commission agent application has been submitted. You will be notified once approved.",
      });
      router.push("/login");

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: error.message || "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full min-h-screen relative overflow-x-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-green-50 z-0 overflow-hidden">
        {/* Simple animated blobs */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-60 animate-blob"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-green-300 rounded-full mix-blend-multiply filter blur-3xl opacity-60 animate-blob" style={{ animationDelay: '2s' }}></div>
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-96 h-96 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-60 animate-blob" style={{ animationDelay: '4s' }}></div>
      </div>
      <div className="flex items-center justify-center py-12 min-h-screen relative z-10">
        <div className="mx-auto grid w-full max-w-[600px] gap-6 px-4">
          <div className="grid gap-2 text-center">
            <Logo variant="auth" />
            <h1 className="text-3xl font-bold font-headline mt-4">Join Our Sales Team</h1>
            <p className="text-balance text-muted-foreground">
              5–10% Commission (Remote, Flexible)
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              We're building a remote Sales Force for Prep Services FBA. Join as a Sales Partner and earn 5–10% commission for every Amazon seller or eCommerce brand you bring.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Please complete all fields accurately. Once reviewed, our team will connect with you to finalize the process.
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="your.email@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name *</FormLabel>
                    <FormDescription>First and Last name</FormDescription>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input placeholder="United States" {...field} />
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
                    <FormLabel>Cell Number/WhatsApp Number *</FormLabel>
                    <FormDescription>Include country code, e.g., +1 347 661 3010</FormDescription>
                    <FormControl>
                      <PhoneInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="+1 347 661 3010"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="socialProfile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LinkedIn / Facebook Profile</FormLabel>
                    <FormControl>
                      <Input placeholder="https://linkedin.com/in/yourprofile" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="salesExperience"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel>Sales Experience *</FormLabel>
                      <FormDescription>Select all that apply</FormDescription>
                    </div>
                    {["Amazon Sellers", "Logistics", "Cold Calling", "Email Outreach"].map((item) => (
                      <FormField
                        key={item}
                        control={form.control}
                        name="salesExperience"
                        render={({ field }) => {
                          const currentValue = Array.isArray(field.value) ? field.value : [];
                          return (
                            <FormItem
                              key={item}
                              className="flex flex-row items-start space-x-3 space-y-0"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={currentValue.includes(item)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...currentValue, item])
                                      : field.onChange(
                                          currentValue.filter(
                                            (value) => value !== item
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">
                                {item}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                    <FormField
                      control={form.control}
                      name="salesExperience"
                      render={({ field }) => {
                        const currentValue = Array.isArray(field.value) ? field.value : [];
                        const hasOther = currentValue.includes("Other");
                        return (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={hasOther}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...currentValue, "Other"])
                                    : field.onChange(
                                        currentValue.filter(
                                          (value) => value !== "Other"
                                        )
                                      )
                                }}
                              />
                            </FormControl>
                            <div className="flex-1 space-y-1">
                              <FormLabel className="font-normal">Other:</FormLabel>
                              {hasOther && (
                                <FormField
                                  control={form.control}
                                  name="salesExperienceOther"
                                  render={({ field: otherField }) => (
                                    <FormItem>
                    <FormControl>
                                        <Input placeholder="Please specify" {...otherField} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
                              )}
                            </div>
                          </FormItem>
                        )
                      }}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="referralSource"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>How Did You Hear About Us?</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Facebook Group">Facebook Group</SelectItem>
                        <SelectItem value="Telegram Channel">Telegram Channel</SelectItem>
                        <SelectItem value="WhatsApp Referral">WhatsApp Referral</SelectItem>
                        <SelectItem value="Google">Google</SelectItem>
                        <SelectItem value="Amazon Seller Event">Amazon Seller Event</SelectItem>
                        <SelectItem value="Referral By Client">Referral By Client</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
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
                    <FormDescription>Create a password for your account (minimum 6 characters)</FormDescription>
                    <FormControl>
                      <Input type="password" placeholder="••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-muted border rounded-lg p-4 space-y-3">
                <h4 className="font-semibold text-sm">📜 Terms & Conditions:</h4>
                <ul className="text-xs space-y-2 list-disc list-inside text-muted-foreground">
                  <li>I understand that this is a commission-based opportunity, not a salaried position.</li>
                  <li>I agree that all payouts will be made monthly based on confirmed client sign-ups and cleared payments.</li>
                  <li>I will not misrepresent Prep Services FBA or its services when speaking to prospects.</li>
                  <li>I will act professionally and ethically in all client communications.</li>
                  <li>Prep Services FBA reserves the right to update or modify the commission structure with prior notice.</li>
                  <li>Repeated false leads or unprofessional conduct may result in removal from the program.</li>
                </ul>
                <FormField
                  control={form.control}
                  name="termsAccepted"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-sm">
                          I confirm that I have read and understood the terms above.
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
                <FormMessage />
              </div>

              <FormField
                control={form.control}
                name="consent"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-sm">
                        Consent *
                      </FormLabel>
                      <FormDescription className="text-xs">
                        I confirm that I have read and understood the terms above. By submitting this form, I give my consent to be contacted by Prep Services FBA via WhatsApp, email, or phone for onboarding, training, client assignments, and performance monitoring.
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs text-blue-900">
                  <strong>Need help?</strong> 📞 Call or WhatsApp us at <strong>+1 (347) 661-3010</strong> or visit <strong>www.prepservicesfba.com</strong>
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit
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
            Want to become a client instead?{" "}
            <Link href="/register" className="underline text-primary">
              Register as Client
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

