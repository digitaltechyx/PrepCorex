"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildUserUniqueFieldKeys } from "@/lib/user-unique-fields";
import {
  checkUserFieldsUniqueClient,
  claimUserFieldUniquesClient,
  uniquenessConflictMessage,
} from "@/lib/user-uniqueness-client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { UserProfile, UserRole } from "@/types";
import { getUserRoles } from "@/lib/permissions";
import {
  CUSTOM_PRICING_PROFILE_OPTION,
  GLOBAL_PRICING_PROFILES,
  pricingProfileIdFromSelect,
  pricingProfileSelectValue,
} from "@/lib/pricing-profiles";

const editUserSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    ein: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    zipCode: z.string().optional(),
    role: z.enum(["admin", "sub_admin", "user", "commission_agent", "warehouse_operator"]),
    status: z.enum(["pending", "approved", "deleted"]).optional(),
    pricingProfile: z.string().optional(),
    newPassword: z.string().optional(),
    confirmPassword: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const pwd = values.newPassword?.trim() || "";
    const confirm = values.confirmPassword?.trim() || "";
    if (!pwd && !confirm) return;
    if (pwd.length < 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must be at least 6 characters",
        path: ["newPassword"],
      });
    }
    if (pwd !== confirm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });

type EditUserFormValues = z.infer<typeof editUserSchema>;

interface EditUserFormProps {
  user: UserProfile;
  onSuccess: () => void;
  onCancel: () => void;
}

export function EditUserForm({ user, onSuccess, onCancel }: EditUserFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [deferEmailVerification, setDeferEmailVerification] = useState(
    user.emailVerificationDeferredByAdmin === true
  );
  const [emailVerificationBusy, setEmailVerificationBusy] = useState(false);

  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      companyName: user.companyName || "",
      ein: user.ein || "",
      address: user.address || "",
      city: user.city || "",
      state: user.state || "",
      country: user.country || "",
      zipCode: user.zipCode || "",
      role: user.role || "user",
      status: user.status || "approved",
      pricingProfile: pricingProfileSelectValue(user),
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function applyEmailVerificationAction(
    action: "defer" | "revoke_defer" | "mark_verified"
  ) {
    setEmailVerificationBusy(true);
    try {
      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated.");

      const res = await fetch(`/api/admin/users/${user.uid}/email-verification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update email verification.");
      }

      if (action === "defer") setDeferEmailVerification(true);
      if (action === "revoke_defer") setDeferEmailVerification(false);
      if (action === "mark_verified") setDeferEmailVerification(false);

      toast({
        title: "Updated",
        description:
          action === "defer"
            ? "User can continue without verifying email. They may verify later."
            : action === "revoke_defer"
              ? "User must verify email before signing in again."
              : "Email marked as verified in Firebase Auth.",
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update email verification.",
      });
    } finally {
      setEmailVerificationBusy(false);
    }
  }

  async function onSubmit(values: EditUserFormValues) {
    setIsLoading(true);
    try {
      const uniqueCheck = await checkUserFieldsUniqueClient(
        {
          companyName: values.companyName,
          ein: values.ein,
          phone: values.phone,
        },
        user.uid
      );
      if (!uniqueCheck.ok) {
        toast({
          variant: "destructive",
          title: "Duplicate information",
          description: uniquenessConflictMessage(uniqueCheck),
        });
        return;
      }

      const { auth } = await import("@/lib/firebase");
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated.");

      const nextEmail = values.email.trim().toLowerCase();
      const prevEmail = (user.email || "").trim().toLowerCase();
      const newPassword = values.newPassword?.trim() || "";
      const credentialsChanged = nextEmail !== prevEmail || newPassword.length > 0;

      if (credentialsChanged) {
        const res = await fetch(`/api/admin/users/${user.uid}/credentials`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(nextEmail !== prevEmail ? { email: nextEmail } : {}),
            ...(newPassword ? { password: newPassword } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to update login credentials.");
        }
      }

      const claim = await claimUserFieldUniquesClient(
        token,
        {
          companyName: values.companyName,
          ein: values.ein,
          phone: values.phone,
        },
        user.uid
      );
      if (!claim.ok) {
        toast({
          variant: "destructive",
          title: "Duplicate information",
          description: uniquenessConflictMessage(claim),
        });
        return;
      }

      const uniqueKeys = buildUserUniqueFieldKeys({
        companyName: values.companyName,
        ein: values.ein,
        phone: values.phone,
      });

      const existingRoles = getUserRoles(user);
      const nextRoles: UserRole[] = [
        values.role as UserRole,
        ...existingRoles.filter((r) => r !== (values.role as UserRole)),
      ];

      await updateDoc(doc(db, "users", user.uid), {
        name: values.name,
        // Email may already be written by credentials API; keep profile in sync
        email: nextEmail,
        phone: values.phone || null,
        companyName: values.companyName || null,
        ein: values.ein || null,
        ...uniqueKeys,
        address: values.address || null,
        city: values.city || null,
        state: values.state || null,
        country: values.country || null,
        zipCode: values.zipCode || null,
        role: values.role,
        roles: nextRoles,
        status: values.status || "approved",
        ...(values.role === "user" && values.pricingProfile
          ? {
              pricingProfileId: pricingProfileIdFromSelect(values.pricingProfile, user.uid),
            }
          : {}),
      });

      toast({
        title: "Success",
        description: credentialsChanged
          ? "User details and login credentials were updated. They can sign in with the new email/password."
          : "User details have been updated successfully.",
      });

      onSuccess();
    } catch (error: any) {
      console.error("Error updating user:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update user details.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Personal Information */}
        <div className="space-y-4">
          <h4 className="font-semibold text-sm border-b pb-2">Personal Information</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
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
                  <FormLabel>Login email *</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="john@example.com" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Changing this updates their Firebase login. They must sign in with the new email.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="+1 (555) 123-4567" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="sub_admin">Sub Admin</SelectItem>
                      <SelectItem value="warehouse_operator">Warehouse Operator</SelectItem>
                      <SelectItem value="commission_agent">Commission Agent</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pricingProfile"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pricing profile</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select pricing profile" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GLOBAL_PRICING_PROFILES.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_PRICING_PROFILE_OPTION.id}>
                        {CUSTOM_PRICING_PROFILE_OPTION.label}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Custom assigns a per-user pricing table. Edit custom rates under Pricing → Custom.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || "approved"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="deleted">Deleted</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Login credentials */}
        <div className="space-y-4">
          <h4 className="font-semibold text-sm border-b pb-2">Reset password (optional)</h4>
          <p className="text-xs text-muted-foreground">
            Leave blank to keep the current password. If you set a new one, the user signs in with it
            immediately (old password stops working).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Leave blank to keep current"
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
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Repeat new password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {user.emailVerificationRequired === true && (
          <div className="space-y-3 rounded-md border p-3">
            <h4 className="font-semibold text-sm">Email verification</h4>
            <p className="text-xs text-muted-foreground">
              Use this when the user cannot receive the verification email. Allowing continuation does
              not mark the email verified — they can still verify later from the verify-email page.
            </p>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="defer-email-verification">Allow without verification</Label>
                <p className="text-xs text-muted-foreground">
                  {deferEmailVerification
                    ? "Currently deferred — user can sign in and use the app."
                    : "Currently blocked until email is verified."}
                </p>
              </div>
              <Switch
                id="defer-email-verification"
                checked={deferEmailVerification}
                disabled={emailVerificationBusy || isLoading}
                onCheckedChange={(checked) => {
                  void applyEmailVerificationAction(checked ? "defer" : "revoke_defer");
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={emailVerificationBusy || isLoading}
              onClick={() => void applyEmailVerificationAction("mark_verified")}
            >
              {emailVerificationBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark email as verified instead
            </Button>
          </div>
        )}

        {/* Company Information */}
        <div className="space-y-4">
          <h4 className="font-semibold text-sm border-b pb-2">Company Information</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Company Inc." {...field} />
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
          </div>
        </div>

        {/* Address Information */}
        <div className="space-y-4">
          <h4 className="font-semibold text-sm border-b pb-2">Address Information</h4>
          
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Street Address</FormLabel>
                <FormControl>
                  <Input placeholder="123 Main St" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </form>
    </Form>
  );
}

