"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { findDefaultWarehouseLocationId } from "@/lib/default-warehouse";
import { generateClientId } from "@/lib/client-id";
import { useState, useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import { Loader2, UserPlus, Shield, Zap, MapPin, Users, Package } from "lucide-react";
import { getDefaultFeaturesForRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { buildUserUniqueFieldKeys } from "@/lib/user-unique-fields";
import {
  checkUserFieldsUniqueClient,
  claimUserFieldUniquesClient,
  uniquenessConflictMessage,
} from "@/lib/user-uniqueness-client";
import { OPS_FEATURES_CONFIG, OPS_FEATURE_PRESETS } from "@/lib/warehouse-ops-permissions";
import type { UserProfile, UserRole, UserFeature, WarehouseDoc } from "@/types";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  companyName: z.string().min(1, "Company name is required"),
  ein: z.string().min(1, "EIN is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  country: z.string().min(1, "Country is required"),
  zipCode: z.string().min(5, "Zip code must be at least 5 characters"),
  role: z.enum(["user", "sub_admin", "warehouse_operator"]).default("user"),
  features: z.array(z.string()).default([]),
});

interface CreateUserFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

// Admin features available for sub admins (full list so sub admin can get all modules)
const ADMIN_FEATURES: { value: UserFeature; label: string; description: string }[] = [
  { value: "admin_dashboard", label: "Admin Dashboard", description: "Access to admin dashboard overview" },
  { value: "manage_users", label: "Manage Users", description: "View assigned users (view-only)" },
  { value: "manage_invoices", label: "Manage Invoices", description: "View and manage invoices" },
  { value: "manage_labels", label: "Manage Labels", description: "View and manage uploaded labels" },
  { value: "manage_quotes", label: "Quote Management", description: "Access to quote management" },
  { value: "manage_pricing", label: "Pricing", description: "Access to pricing management" },
  { value: "manage_documents", label: "Documents", description: "Access to document requests" },
  { value: "manage_product_returns", label: "Product Returns", description: "Access to product returns" },
  { value: "manage_dispose_requests", label: "Dispose Requests", description: "Access to dispose requests" },
  { value: "manage_shopify_orders", label: "Shopify Orders", description: "Access to Shopify orders" },
  { value: "manage_ebay_orders", label: "eBay Orders", description: "Access to eBay orders" },
  { value: "manage_inventory_admin", label: "Inventory Management", description: "Access to admin inventory management" },
  { value: "manage_notifications", label: "Notifications", description: "Access to notifications and pending requests" },
];

type LocationDoc = { id: string; name?: string; active?: boolean };

export function CreateUserForm({ onSuccess, onCancel }: CreateUserFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [subAdminManagedLocationIds, setSubAdminManagedLocationIds] = useState<string[]>([]);
  const [subAdminAssignedUserIds, setSubAdminAssignedUserIds] = useState<string[]>([]);
  const [assignedWarehouseIds, setAssignedWarehouseIds] = useState<string[]>([]);

  const { data: locationDocs } = useCollection<LocationDoc>("locations");
  const { data: warehouseDocs } = useCollection<WarehouseDoc>("warehouses");
  const activeWarehouses = useMemo(
    () => warehouseDocs.filter((w) => w.active !== false),
    [warehouseDocs]
  );
  const { data: allUsersList } = useCollection<UserProfile>("users");

  const activeLocations = useMemo(
    () => locationDocs.filter((l) => l.active !== false).map((l) => ({ id: l.id, name: l.name ?? "" })),
    [locationDocs]
  );
  const assignableUsersList = useMemo(
    () =>
      allUsersList
        .filter((u) => u.uid && u.status !== "deleted")
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [allUsersList]
  );

  const form = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      password: "",
      companyName: "",
      ein: "",
      address: "",
      city: "",
      state: "",
      country: "",
      zipCode: "",
      role: "user",
      features: [],
    },
  });

  const selectedRole = form.watch("role");
  const selectedFeatures = form.watch("features");

  async function onSubmit(values: z.infer<typeof createUserSchema>) {
    if (values.role === "warehouse_operator" && assignedWarehouseIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Warehouse required",
        description: "Assign at least one warehouse for this operator.",
      });
      return;
    }
    setIsLoading(true);
    try {
      const isOps = values.role === "warehouse_operator";
      if (!isOps) {
        const uniqueCheck = await checkUserFieldsUniqueClient({
          companyName: values.companyName,
          ein: values.ein,
          phone: values.phone,
        });
        if (!uniqueCheck.ok) {
          toast({
            variant: "destructive",
            title: "Duplicate information",
            description: uniquenessConflictMessage(uniqueCheck),
          });
          setIsLoading(false);
          return;
        }
      }

      // Create the user account in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );

      // Determine features based on role
      let userFeatures: UserFeature[] = [];
      if (values.role === "sub_admin") {
        const selected = values.features as UserFeature[];
        userFeatures = selected.length > 0 ? selected : ADMIN_FEATURES.map((f) => f.value);
      } else if (values.role === "warehouse_operator") {
        const selected = values.features as UserFeature[];
        userFeatures =
          selected.length > 0 ? selected : getDefaultFeaturesForRole("warehouse_operator");
      } else {
        userFeatures = getDefaultFeaturesForRole(values.role);
      }

      const companyName = isOps ? values.companyName?.trim() || "PrepCorex Ops" : values.companyName;
      const einValue = isOps ? values.ein?.trim() || "N/A" : values.ein;
      const uniqueKeys = buildUserUniqueFieldKeys({
        companyName,
        ein: einValue,
        phone: values.phone,
      });

      const profileData: Record<string, unknown> = {
        uid: userCredential.user.uid,
        name: values.name,
        email: values.email,
        phone: values.phone,
        password: values.password,
        companyName,
        ein: einValue,
        ...uniqueKeys,
        address: isOps ? values.address?.trim() || "N/A" : values.address,
        city: isOps ? values.city?.trim() || "N/A" : values.city,
        state: isOps ? values.state?.trim() || "N/A" : values.state,
        country: isOps ? values.country?.trim() || "USA" : values.country,
        zipCode: isOps ? values.zipCode?.trim() || "00000" : values.zipCode,
        role: values.role,
        roles: [values.role],
        features: userFeatures,
        status: values.role === "sub_admin" || isOps ? "approved" : "pending",
        emailVerificationRequired: false,
        createdAt: new Date(),
        clientId: await generateClientId(),
      };
      if (values.role === "sub_admin") {
        profileData.managedLocationIds = subAdminManagedLocationIds;
        profileData.assignedUserIds = subAdminAssignedUserIds;
      }
      if (isOps) {
        profileData.assignedWarehouseIds = assignedWarehouseIds;
      }
      const defaultWarehouseId = await findDefaultWarehouseLocationId();
      if (defaultWarehouseId && values.role === "user") {
        profileData.locations = [defaultWarehouseId];
      }
      await setDoc(doc(db, "users", userCredential.user.uid), profileData);

      if (!isOps) {
        try {
          const token = await userCredential.user.getIdToken();
          await claimUserFieldUniquesClient(token, {
            companyName,
            ein: einValue,
            phone: values.phone,
          });
        } catch {
          // Non-blocking; registry can be reconciled by admin
        }
      }

      toast({
        title: "Success",
        description: `User "${values.name}" has been created successfully!`,
      });

      form.reset();
      onSuccess?.();

      // Sign out the newly created user and sign back in as admin
      await auth.signOut();
      // The AuthProvider will handle re-authentication automatically

    } catch (error: any) {
      let errorMessage = "Failed to create user.";
      
      if (error.code === "auth/email-already-in-use") {
        errorMessage = "An account with this email already exists.";
      } else if (error.code === "auth/weak-password") {
        errorMessage = "Password is too weak.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage = "Invalid email address.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg border-0 shadow-none">
      <CardContent className="p-0">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter full name" {...field} />
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
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter email address" 
                      type="email"
                      {...field} 
                    />
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
                    <Input 
                      placeholder="Enter phone number" 
                      type="tel"
                      {...field} 
                    />
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter password (min 6 characters)" 
                      type="password"
                      {...field} 
                    />
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
                  <FormLabel>User Role</FormLabel>
                  <FormControl>
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50">
                        <input
                          type="radio"
                          id="role-user"
                          checked={field.value === "user"}
                          onChange={() => field.onChange("user")}
                          className="h-4 w-4"
                        />
                        <label htmlFor="role-user" className="flex-1 cursor-pointer">
                          <div className="font-medium">Regular User</div>
                          <div className="text-xs text-muted-foreground">
                            Client access with inventory management, shipments, and invoices
                          </div>
                        </label>
                      </div>
                      <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50">
                        <input
                          type="radio"
                          id="role-sub_admin"
                          checked={field.value === "sub_admin"}
                          onChange={() => field.onChange("sub_admin")}
                          className="h-4 w-4"
                        />
                        <label htmlFor="role-sub_admin" className="flex-1 cursor-pointer">
                          <div className="font-medium">Sub Admin</div>
                          <div className="text-xs text-muted-foreground">
                            Admin dashboard access with limited features (select features below)
                          </div>
                        </label>
                      </div>
                      <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-accent/50 border-orange-200/60">
                        <input
                          type="radio"
                          id="role-warehouse_operator"
                          checked={field.value === "warehouse_operator"}
                          onChange={() => field.onChange("warehouse_operator")}
                          className="h-4 w-4"
                        />
                        <label htmlFor="role-warehouse_operator" className="flex-1 cursor-pointer">
                          <div className="font-medium">Warehouse Operator</div>
                          <div className="text-xs text-muted-foreground">
                            Floor staff — /warehouse-ops (receiving, putaway). No client or admin billing access.
                          </div>
                        </label>
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedRole === "warehouse_operator" && (
              <>
                <div className="rounded-lg border border-orange-200/60 p-4 space-y-3 bg-orange-50/50 dark:bg-orange-950/20">
                  <div className="flex flex-wrap gap-2">
                    <Label className="text-sm font-medium w-full">Ops permission presets</Label>
                    {OPS_FEATURE_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => form.setValue("features", preset.features)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-orange-600" />
                    <Label className="text-base font-medium">Assigned warehouses</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Operator only sees and works in these warehouses. Super admin can change anytime in Roles &amp; Permissions.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {activeWarehouses.map((w) => {
                      const on = assignedWarehouseIds.includes(w.id);
                      return (
                        <Badge
                          key={w.id}
                          variant={on ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() =>
                            setAssignedWarehouseIds((prev) =>
                              on ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                            )
                          }
                        >
                          {w.code}
                        </Badge>
                      );
                    })}
                  </div>
                  {assignedWarehouseIds.length === 0 ? (
                    <p className="text-sm text-amber-700">Select at least one warehouse.</p>
                  ) : null}
                </div>
                <FormField
                  control={form.control}
                  name="features"
                  render={() => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Warehouse Ops features
                      </FormLabel>
                      <div className="grid grid-cols-1 gap-3">
                        {OPS_FEATURES_CONFIG.map((feature) => (
                          <div
                            key={feature.value}
                            className="flex items-start space-x-3 p-3 border rounded-lg"
                          >
                            <Checkbox
                              checked={selectedFeatures.includes(feature.value)}
                              onCheckedChange={(checked) => {
                                const currentFeatures = form.getValues("features");
                                if (checked) {
                                  form.setValue("features", [...currentFeatures, feature.value]);
                                } else {
                                  form.setValue(
                                    "features",
                                    currentFeatures.filter((f) => f !== feature.value)
                                  );
                                }
                              }}
                              className="mt-1"
                            />
                            <div>
                              <p className="text-sm font-medium">{feature.label}</p>
                              <p className="text-xs text-muted-foreground">{feature.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedRole === "sub_admin" && (
              <>
              <FormField
                control={form.control}
                name="features"
                render={() => (
                  <FormItem>
                    <div className="mb-4">
                      <FormLabel className="text-base flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Admin Features
                      </FormLabel>
                      <p className="text-sm text-muted-foreground mt-1">
                        Select which admin features this sub admin should have access to.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {ADMIN_FEATURES.map((feature) => (
                        <div
                          key={feature.value}
                          className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={selectedFeatures.includes(feature.value)}
                            onCheckedChange={(checked) => {
                              const currentFeatures = form.getValues("features");
                              if (checked) {
                                form.setValue("features", [...currentFeatures, feature.value]);
                              } else {
                                form.setValue(
                                  "features",
                                  currentFeatures.filter((f) => f !== feature.value)
                                );
                              }
                            }}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-1">
                            <label className="text-sm font-medium leading-none cursor-pointer">
                              {feature.label}
                            </label>
                            <p className="text-xs text-muted-foreground">{feature.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedFeatures.length === 0 && (
                      <p className="text-sm text-amber-600 mt-2">
                        âš ï¸ No features selected. Sub admin will not have access to any admin pages.
                      </p>
                    )}
                  </FormItem>
                )}
              />
              <div className="space-y-4 rounded-lg border p-4 bg-muted/30 mt-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <Label className="text-base font-medium">Sub Admin: Locations & Users</Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select locations this sub admin manages, then assign users. Sub admin will only see data for assigned users (and users who have the selected locations).
                  </p>
                  <div>
                    <Label className="text-sm">Managed locations</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {activeLocations.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No locations. Add them in Roles & Permissions → Assign Location.</p>
                      ) : (
                        activeLocations.map((loc) => {
                          const isSelected = subAdminManagedLocationIds.includes(loc.id);
                          return (
                            <label key={loc.id} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  setSubAdminManagedLocationIds((prev) =>
                                    checked ? [...prev, loc.id] : prev.filter((id) => id !== loc.id)
                                  );
                                }}
                              />
                              <span className="text-sm">{loc.name || loc.id}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm">Assigned users</Label>
                      {subAdminManagedLocationIds.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const ids = new Set(subAdminAssignedUserIds);
                            assignableUsersList.forEach((u) => {
                              const userLocs = u.locations ?? [];
                              if (userLocs.some((lid) => subAdminManagedLocationIds.includes(lid))) ids.add(u.uid!);
                            });
                            setSubAdminAssignedUserIds(Array.from(ids));
                          }}
                        >
                          Auto-assign users with selected locations
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="h-32 mt-2 rounded border p-2">
                      <div className="space-y-2">
                        {assignableUsersList.map((u) => {
                          const isSelected = subAdminAssignedUserIds.includes(u.uid!);
                          return (
                            <label key={u.uid} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  setSubAdminAssignedUserIds((prev) =>
                                    checked ? [...prev, u.uid!] : prev.filter((id) => id !== u.uid)
                                  );
                                }}
                              />
                              <span className="text-sm">{formatUserDisplayName(u, { showEmail: false })}</span>
                              {(u.locations?.length ?? 0) > 0 && (
                                <Badge variant="secondary" className="text-xs">{u.locations!.length} loc</Badge>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isLoading} className="flex-1">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create User
              </Button>
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

