"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { collection, doc, runTransaction } from "firebase/firestore";
import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import type { InventoryItem, ShipmentProductItem, LabelProductDetail } from "@/types";
import { isIntegrationInventorySource } from "@/lib/integration-inventory-sources";
import { Checkbox } from "@/components/ui/checkbox";

const shipmentItemSchema = z.object({
  productId: z.string().min(1, "Select a product."),
  quantity: z.coerce.number().int().positive("Shipped quantity must be a positive number."),
  packOf: z.coerce.number().int().positive("Pack size must be a positive number."),
  unitPrice: z.coerce.number().positive("Unit price must be a positive number."),
});

const formSchema = z.object({
  shipments: z.array(shipmentItemSchema).min(1, "Select at least one product to ship."),
  date: z.date({ required_error: "A shipping date is required." }),
  shipTo: z.string().min(1, "Ship to destination is required."),
  remarks: z.string().optional(),
});

interface ShipInventoryFormProps {
  userId: string;
  inventory: InventoryItem[];
  prefillData?: LabelProductDetail[];
  onSuccess?: () => void;
}

export function ShipInventoryForm({ userId, inventory, prefillData, onSuccess }: ShipInventoryFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Pre-fill form with labelProducts data if provided
  const defaultShipments = useMemo(() => {
    if (!prefillData || prefillData.length === 0) return [];
    
    return prefillData
      .map((product) => {
        // Find matching inventory item by productId or name
        const inventoryItem = inventory.find(
          (item) => item.id === product.productId || item.productName === product.name
        );
        
        if (!inventoryItem) return null;
        
        return {
          productId: inventoryItem.id,
          quantity: product.shippedUnits || 1,
          packOf: product.packOf || 1,
          unitPrice: 1, // Default price, user can change
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [prefillData, inventory]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      shipments: defaultShipments,
      shipTo: "",
      remarks: "",
    },
  });

  // Update form when prefillData changes
  useEffect(() => {
    if (defaultShipments.length > 0 && prefillData) {
      form.reset({
        shipments: defaultShipments,
        shipTo: "",
        remarks: "",
      });
    }
  }, [defaultShipments, form, prefillData]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "shipments",
  });

  const availableInventory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return inventory
      .filter((item) => item.quantity > 0)
      .filter((item) => !isIntegrationInventorySource((item as { source?: string }).source))
      .filter((item) => item.productName.toLowerCase().includes(normalizedQuery));
  }, [inventory, query]);

  const shipmentErrors = form.formState.errors.shipments;
  const shipmentsErrorMessage = Array.isArray(shipmentErrors)
    ? undefined
    : shipmentErrors?.message;

  const handleToggleProduct = (productId: string, checked: boolean) => {
    const currentShipments = form.getValues("shipments");
    const existingIndex = currentShipments.findIndex((shipment) => shipment.productId === productId);

    if (checked && existingIndex === -1) {
      append({
        productId,
        quantity: 1,
        packOf: 1,
        unitPrice: 1,
      });
      return;
    }

    if (!checked && existingIndex !== -1) {
      remove(existingIndex);
    }
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    const createdAt = new Date();

    try {
      await runTransaction(db, async (transaction) => {
        const shipmentWithInventory = await Promise.all(
          values.shipments.map(async (shipment) => {
            const inventoryDocRef = doc(db, `users/${userId}/inventory`, shipment.productId);
        const inventoryDoc = await transaction.get(inventoryDocRef);

        if (!inventoryDoc.exists()) {
              throw new Error("One of the selected products could not be found.");
        }

            const currentInventory = inventoryDoc.data() as Omit<InventoryItem, "id">;
            return { shipment, inventoryDocRef, currentInventory };
          })
        );

        const shippedCollectionRef = collection(db, `users/${userId}/shipped`);

        for (const { shipment, inventoryDocRef, currentInventory } of shipmentWithInventory) {
          const totalUnitsShipped = shipment.quantity * shipment.packOf;

        if (currentInventory.quantity < totalUnitsShipped) {
            throw new Error(
              `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}.`
            );
        }

        const newQuantity = currentInventory.quantity - totalUnitsShipped;
        const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

        transaction.update(inventoryDocRef, {
          quantity: newQuantity,
          status: newStatus,
        });

          const shipmentDocRef = doc(shippedCollectionRef);
          transaction.set(shipmentDocRef, {
          productName: currentInventory.productName,
          date: values.date,
            createdAt,
          shippedQty: totalUnitsShipped,
            boxesShipped: shipment.quantity,
            unitsForPricing: shipment.quantity,
          remainingQty: newQuantity,
            packOf: shipment.packOf,
            unitPrice: shipment.unitPrice,
          shipTo: values.shipTo,
          remarks: values.remarks,
            items: [
              {
                productId: shipment.productId,
                productName: currentInventory.productName,
                boxesShipped: shipment.quantity,
                shippedQty: totalUnitsShipped,
                packOf: shipment.packOf,
                unitPrice: shipment.unitPrice,
                remainingQty: newQuantity,
              } satisfies ShipmentProductItem,
            ],
            totalBoxes: shipment.quantity,
            totalUnits: totalUnitsShipped,
            totalSkus: 1,
        });
        }
      });

      toast({
        title: "Success",
        description: "Shipment recorded for all selected products.",
      });

      form.reset({
        date: values.date,
        shipTo: "",
        remarks: "",
        shipments: defaultShipments.length > 0 ? defaultShipments : [],
      });
      setQuery("");

      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to record shipment.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a Shipment</CardTitle>
        <CardDescription>Select one or more products that shipped together.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <FormLabel>Products</FormLabel>
                  <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between"
                    disabled={inventory.length === 0}
                  >
                    {fields.length
                      ? `${fields.length} product${fields.length > 1 ? "s" : ""} selected`
                      : "Select products to ship..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="p-0">
                  <DialogTitle className="sr-only">Select products</DialogTitle>
                      <div className="p-3 border-b">
                        <Input
                          autoFocus
                          placeholder="Search products..."
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                    {availableInventory.map((item) => {
                      const isSelected = fields.some((field) => field.productId === item.id);
                      return (
                        <label
                              key={item.id}
                          className="flex items-center gap-3 px-3 py-3 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer border-b last:border-b-0"
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              handleToggleProduct(item.id, checked === true)
                            }
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{item.productName}</span>
                            <span className="text-xs text-muted-foreground">
                              SKU: {item.sku || "N/A"} | In Stock: {item.quantity}
                            </span>
                            </div>
                        </label>
                      );
                    })}
                    {availableInventory.length === 0 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        {inventory.length === 0
                          ? "No inventory available."
                          : "No products match your search."}
                      </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
              {shipmentsErrorMessage && (
                <p className="text-sm font-medium text-destructive">{shipmentsErrorMessage}</p>
              )}
            </div>

            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No products selected yet. Use the button above to choose every SKU included in this shipment.
              </div>
            ) : (
              <div className="space-y-4">
                {fields.map((field, index) => {
                  const productMeta = inventory.find((item) => item.id === field.productId);
                  return (
                    <div key={field.id} className="rounded-lg border p-4 space-y-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">
                            {productMeta?.productName || "Selected product"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            In Stock: {productMeta?.quantity ?? "—"}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <X className="mr-1 h-4 w-4" />
                          Remove
                        </Button>
                      </div>

                      <input
                        type="hidden"
                        value={field.productId}
                        {...form.register(`shipments.${index}.productId` as const)}
                      />

                      <div className="grid gap-4 md:grid-cols-3">
                        <FormField
                          control={form.control}
                          name={`shipments.${index}.quantity` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Shipped Units</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`shipments.${index}.packOf` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Pack Of</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  placeholder="Enter pack size"
                                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  {...field}
                                />
                              </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
                        <FormField
                          control={form.control}
                          name={`shipments.${index}.unitPrice` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Prep Unit Price ($)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="Enter unit price"
                                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Shipping Date</FormLabel>
                  <DatePicker date={field.value} setDate={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="shipTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ship To</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter destination (e.g., Customer Name, Address, Store Location)" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Add any notes about the shipment..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isLoading || inventory.length === 0 || fields.length === 0}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Shipment
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

