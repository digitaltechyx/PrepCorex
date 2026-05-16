"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { db } from "@/lib/firebase";
import { stripUndefined } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { InventoryItem } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const formSchema = z.object({
  type: z.enum(["existing", "new"], {
    required_error: "Please select a return type",
  }),
  // For existing products
  productId: z.string().optional(),
  productName: z.string().optional(),
  sku: z.string().optional(),
  // Combine or Partial for both existing and new products
  returnType: z.enum(["combine", "partial"], {
    required_error: "Please select how products are coming",
  }),
  // For new products
  newProductName: z.string().optional(),
  newProductSku: z.string().optional(),
  // Common fields
  requestedQuantity: z.coerce.number().int().positive("Quantity must be a positive number"),
  userRemarks: z.string().optional(),
  // Additional services (user only selects, admin adds quantities)
  packIntoBoxes: z.boolean().default(false),
  placeOnPallet: z.boolean().default(false),
  shipToAddress: z.boolean().default(false),
  shippingName: z.string().optional(),
  shippingAddress: z.string().optional(),
  shippingCity: z.string().optional(),
  shippingState: z.string().optional(),
  shippingZipCode: z.string().optional(),
  shippingCountry: z.string().optional(),
})
  .refine((data) => {
    if (data.type === "existing") {
      return !!data.productId;
    }
    return true;
  }, {
    message: "Please select a product",
    path: ["productId"],
  })
  .refine((data) => {
    if (data.type === "new") {
      return !!(data.newProductName && data.newProductName.trim() !== "");
    }
    return true;
  }, {
    message: "Please enter product name",
    path: ["newProductName"],
  })
  .refine((data) => {
    if (data.shipToAddress) {
      return !!(
        data.shippingName?.trim() &&
        data.shippingAddress?.trim() &&
        data.shippingCity?.trim() &&
        data.shippingState?.trim() &&
        data.shippingZipCode?.trim() &&
        data.shippingCountry?.trim()
      );
    }
    return true;
  }, {
    message: "Please complete all shipping address fields",
    path: ["shippingName"],
  });

type FormValues = z.infer<typeof formSchema>;

const FORM_DEFAULT_VALUES = {
  type: "existing",
  productId: "",
  productName: "",
  sku: "",
  newProductName: "",
  newProductSku: "",
  userRemarks: "",
  packIntoBoxes: false,
  placeOnPallet: false,
  shipToAddress: false,
  shippingName: "",
  shippingAddress: "",
  shippingCity: "",
  shippingState: "",
  shippingZipCode: "",
  shippingCountry: "",
};

export interface ProductReturnRequestFormProps {
  /** When set, form submits a return request on behalf of this user (admin flow). */
  targetUserId?: string;
  /** That user's inventory (required when targetUserId is set). */
  targetUserInventory?: InventoryItem[];
  /** Called after successful submit (e.g. close dialog). */
  onSuccess?: () => void;
}

export function ProductReturnRequestForm({
  targetUserId,
  targetUserInventory = [],
  onSuccess,
}: ProductReturnRequestFormProps = {}) {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOnBehalfOfUser = !!targetUserId && targetUserInventory.length >= 0;

  const { data: currentUserInventory } = useCollection<InventoryItem>(
    !isOnBehalfOfUser && userProfile ? `users/${userProfile.uid}/inventory` : ""
  );
  const inventory = (isOnBehalfOfUser ? targetUserInventory : currentUserInventory) ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: FORM_DEFAULT_VALUES,
  });

  const returnType = form.watch("type");
  const existingReturnType = form.watch("returnType"); // Combine or Partial
  const packIntoBoxes = form.watch("packIntoBoxes");
  const placeOnPallet = form.watch("placeOnPallet");
  const shipToAddress = form.watch("shipToAddress");

  // Filter inventory to only show "In Stock" products (not boxes, containers, or pallets)
  const availableInventory = inventory.filter(
    (item) => {
      const inventoryType = (item as any).inventoryType;
      // Exclude boxes, containers, and pallets
      // Include products (inventoryType === "product" or undefined/missing for legacy products)
      const isExcludedType = inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
      
      return (
        item.status === "In Stock" && 
        (item.quantity || 0) > 0 &&
        !isExcludedType // Show all items that are NOT boxes, containers, or pallets
      );
    }
  );

  // Auto-fill product details when product is selected
  const selectedProductId = form.watch("productId");
  useEffect(() => {
    if (returnType === "existing" && selectedProductId) {
      const product = availableInventory.find((item) => item.id === selectedProductId);
      if (product) {
        form.setValue("productName", product.productName || "");
        // Get SKU from product - check multiple possible field names
        const productSku = (product as any).sku || (product as any).SKU || "";
        form.setValue("sku", productSku);
      } else {
        // Clear if product not found
        form.setValue("productName", "");
        form.setValue("sku", "");
      }
    } else if (returnType === "existing" && !selectedProductId) {
      // Clear when product is deselected
      form.setValue("productName", "");
      form.setValue("sku", "");
    }
  }, [selectedProductId, returnType, availableInventory, form]);

  const onSubmit = async (values: FormValues) => {
    const userId = targetUserId || userProfile?.uid;
    if (!userId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create a return request",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const now = Timestamp.now();

      // Prepare additional services (user only selects, admin adds quantities)
      const additionalServices: any = {
        packIntoBoxes: values.packIntoBoxes,
        placeOnPallet: values.placeOnPallet,
        shipToAddress: values.shipToAddress,
      };

      if (values.shipToAddress) {
        additionalServices.shippingAddress = stripUndefined({
          name: values.shippingName?.trim() || "",
          address: values.shippingAddress?.trim() || "",
          city: values.shippingCity?.trim() || "",
          state: values.shippingState?.trim() || "",
          zipCode: values.shippingZipCode?.trim() || "",
          country: values.shippingCountry?.trim() || "",
        });
      }

      const returnData: Record<string, unknown> = {
        userId,
        type: values.type,
        returnType: values.returnType,
        requestedQuantity: values.requestedQuantity,
        receivedQuantity: 0,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        userRemarks: values.userRemarks?.trim() || "",
      };

      const hasAdditionalServices =
        values.packIntoBoxes || values.placeOnPallet || values.shipToAddress;
      if (hasAdditionalServices) {
        returnData.additionalServices = additionalServices;
      }

      if (values.type === "existing") {
        returnData.productId = values.productId;
        returnData.productName = values.productName?.trim() || "";
        const sku = values.sku?.trim();
        if (sku) returnData.sku = sku;
      } else {
        returnData.newProductName = values.newProductName?.trim() || "";
        returnData.productName = values.newProductName?.trim() || "";
        const newSku = values.newProductSku?.trim();
        if (newSku) returnData.newProductSku = newSku;
      }

      await addDoc(
        collection(db, `users/${userId}/productReturns`),
        stripUndefined(returnData)
      );

      toast({
        title: "Success",
        description: isOnBehalfOfUser
          ? "Return request created for user. It will appear in Notifications."
          : "Product return request created successfully",
      });

      form.reset(FORM_DEFAULT_VALUES);
      onSuccess?.();
    } catch (error: any) {
      console.error("Error creating return request:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create return request",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) => {
          const firstKey = Object.keys(errors)[0] as keyof FormValues | undefined;
          const firstErr: any = firstKey ? (errors as any)[firstKey] : null;
          const message =
            firstErr?.message ||
            firstErr?.root?.message ||
            "Please fix the highlighted fields and try again.";

          toast({
            variant: "destructive",
            title: "Form incomplete",
            description: message,
          });

          if (firstKey) {
            try {
              form.setFocus(firstKey);
            } catch {
              // ignore focus errors
            }
          }
        })}
        className="space-y-6 max-w-2xl"
      >
        <div className="rounded-xl border border-border/50 bg-muted/20 p-5 space-y-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-medium">Return Type</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    value={field.value}
                    className="flex flex-row gap-6 pt-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="existing" id="existing" className="border-2" />
                      <Label htmlFor="existing" className="font-normal cursor-pointer">Existing Product Return</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="new" id="new" className="border-2" />
                      <Label htmlFor="new" className="font-normal cursor-pointer">New Inventory Product Return</Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                <FormDescription className="text-muted-foreground">
                  Select whether you're returning an existing product from inventory or a new product
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="returnType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-medium">How are products coming? *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger className="rounded-lg h-11">
                      <SelectValue placeholder="Select how products are coming" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="combine">Combine - All products coming together</SelectItem>
                    <SelectItem value="partial">Partial - Products coming in separate batches</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-muted-foreground">
                  <strong>Combine:</strong> All products will arrive together in one shipment. <strong>Partial:</strong> Products will arrive in multiple separate batches over time.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/20 p-5 space-y-4">
        {returnType === "existing" ? (
          <>
            <FormField
              control={form.control}
              name="productId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Select Product</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger className="rounded-lg h-11">
                        <SelectValue placeholder="Select a product from inventory" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableInventory.length === 0 ? (
                        <SelectItem value="no-products" disabled>
                          No products available in inventory
                        </SelectItem>
                      ) : (
                        availableInventory.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.productName} (Qty: {item.quantity || 0})
                            {(item as any).sku ? ` - SKU: ${(item as any).sku}` : ""}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedProductId && (
              <>
                <FormField
                  control={form.control}
                  name="productName"
                  render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Product Name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} readOnly className="rounded-lg h-11 bg-muted/50" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sku"
                  render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">SKU</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} readOnly className="rounded-lg h-11 bg-muted/50" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
                  )}
                />
              </>
            )}
          </>
        ) : (
          <>
            <FormField
              control={form.control}
              name="newProductName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">Product Name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} placeholder="Enter product name" className="rounded-lg h-11" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newProductSku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-medium">SKU (Optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} placeholder="Enter SKU" className="rounded-lg h-11" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        <FormField
          control={form.control}
          name="requestedQuantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-medium">Requested Quantity</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    field.onChange(next === "" ? undefined : Number(next));
                  }}
                  placeholder="Enter quantity"
                  className="rounded-lg h-11"
                />
              </FormControl>
              <FormDescription className="text-muted-foreground">
                Total number of products you want to return
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="userRemarks"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-medium">Remarks (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value ?? ""}
                  placeholder="Add any additional notes or instructions"
                  rows={3}
                  className="rounded-lg resize-y"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        </div>

        <div className="space-y-4 rounded-xl border border-border/50 bg-muted/20 p-5">
          <h3 className="text-lg font-semibold">Additional Services (Optional)</h3>
          <p className="text-sm text-muted-foreground">
            Select which services you need. Admin will add quantities and calculate pricing during approval.
          </p>
          
          <FormField
            control={form.control}
            name="packIntoBoxes"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Pack into Boxes</FormLabel>
                  <FormDescription>
                    Admin will add quantity (boxes) during approval
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="placeOnPallet"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Place on Pallet</FormLabel>
                  <FormDescription>
                    Admin will add quantity (pallets) during approval
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="shipToAddress"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Ship to Address</FormLabel>
                  <FormDescription>
                    Ship returned products to another address
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          {shipToAddress && (
            <div className="space-y-4 pl-6 border-l-2">
              <FormField
                control={form.control}
                name="shippingName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="Enter recipient name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="shippingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        placeholder="Enter full address"
                        rows={2}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="shippingCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Enter city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shippingState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Enter state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="shippingZipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zip Code</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Enter zip code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="shippingCountry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="Enter country" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full rounded-lg h-11 bg-orange-600 hover:bg-orange-700 font-medium">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit Return Request
        </Button>
      </form>
    </Form>
  );
}

