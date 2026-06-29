"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { generateClientId } from "@/lib/client-id";
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
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import { findDefaultWarehouseLocationId } from "@/lib/default-warehouse";
import { Logo } from "@/components/logo";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PhoneInput } from "@/components/ui/phone-input";
const formSchema = z.object({
  fullName: z.string().min(2, { message: "Name must be at least 2 characters." }),
  phone: z.string().min(10, { message: "Please enter a valid phone number." }),
  email: z.string().email({ message: "Invalid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
  companyName: z.string().min(1, { message: "Company name is required." }),
  ein: z.string().min(1, { message: "EIN is required." }),
  address: z.string().min(1, { message: "Address is required." }),
  city: z.string().min(1, { message: "City is required." }),
  state: z.string().min(1, { message: "State is required." }),
  country: z.string().min(1, { message: "Country is required." }),
  zipCode: z.string().min(5, { message: "Zip code must be at least 5 characters." }),
  referralCode: z.string().optional(),
  /** Location IDs – at least one required when active locations exist (validated in submit). */
  locations: z.array(z.string()).optional().default([]),
  termsAccepted: z.boolean().refine((val) => val === true, {
    message: "You must accept the terms and conditions.",
  }),
});

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      email: "",
      password: "",
      companyName: "",
      ein: "",
      address: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
      referralCode: "",
      termsAccepted: false,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      let referredByAgentId: string | null = null;
      
      // Validate referral code if provided
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

      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      const userData: any = {
        uid: user.uid,
        name: values.fullName,
        email: values.email,
        phone: values.phone,
        password: values.password,
        companyName: values.companyName,
        ein: values.ein,
        address: values.address,
        city: values.city,
        state: values.state,
        country: values.country,
        zipCode: values.zipCode,
        role: "user",
        roles: ["user"],
        features: [], // No features until user accepts MSA (Activate Account)
        status: "pending",
        createdAt: new Date(),
        clientId: await generateClientId(),
      };

      // Add referral information if referral code was provided
      if (values.referralCode && values.referralCode.trim() !== "" && referredByAgentId) {
        userData.referredBy = values.referralCode.trim().toUpperCase();
        userData.referredByAgentId = referredByAgentId;
      }

      const defaultWarehouseId = await findDefaultWarehouseLocationId();
      if (defaultWarehouseId) {
        userData.locations = [defaultWarehouseId];
      }

      await setDoc(doc(db, "users", user.uid), userData);

      toast({
        title: "Registration Successful",
        description: "You can now log in with your credentials.",
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
    <div className="w-full min-h-screen relative">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-950 dark:via-purple-950 dark:to-pink-950 -z-10">
        {/* Animated gradient orbs */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/30 dark:bg-indigo-700/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-300/30 dark:bg-purple-700/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-300/20 dark:bg-pink-700/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>
      <div className="flex items-center justify-center py-12 min-h-screen">
        <div className="mx-auto grid w-full max-w-[500px] gap-6 px-4">
          <div className="grid gap-2 text-center">
            <Logo variant="auth" />
            <h1 className="text-3xl font-bold font-headline mt-4">Onboarding form</h1>
            <p className="text-balance text-muted-foreground">
              Enter your information to complete the onboarding form
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
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
                    <FormLabel>Phone Number</FormLabel>
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
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="ABC Company Inc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ein"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>EIN</FormLabel>
                    <FormControl>
                      <Input placeholder="12-3456789" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Complete Address</FormLabel>
                    <FormControl>
                      <Textarea placeholder="123 Main Street, Suite 100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="New York" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="NY" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
                name="zipCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zip Code</FormLabel>
                    <FormControl>
                      <Input placeholder="10001" {...field} />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Terms and Conditions */}
              <div className="space-y-3 border rounded-lg p-4 bg-muted/50">
                <h3 className="text-sm font-semibold">Terms & Conditions</h3>
                <ScrollArea className="h-[200px] w-full pr-4">
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>
                      Please read and agree to the terms and conditions before submitting. By submitting this form, you agree that all information provided is accurate. Our services are governed by our service policy and liability terms as discussed with your assigned representative. Prep Services FBA is not responsible for any shipment delays caused by carriers.
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        Always use authentic shipping labels. Fake/Forged labels lead to product confiscation, severe penalities ($5,000 - $10,000), and legal action.
                      </li>
                      <li>
                        Payments are on daily basis unless you have paid in advance before the shipment. No Payment! No Shipment!
                      </li>
                      <li>
                        If invoice didn't get processed in 24-48 hours, there will be $19 late payment fee will be applied.
                      </li>
                    </ul>
                  </div>
                </ScrollArea>
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
                        <FormLabel className="text-sm font-normal cursor-pointer">
                          I have read and agree to the terms and conditions.
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

