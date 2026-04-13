"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { addDoc, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { useState, useEffect, useMemo, type ChangeEvent } from "react";
import { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { db, storage } from "@/lib/firebase";
import { Archive, Boxes, ImagePlus, Loader2, Package, Plus, Truck } from "lucide-react";
import type { InventoryType, ContainerSize, UserContainerHandlingPricing } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem } from "@/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

const inventoryRequestSchema = z.object({
  inventoryType: z.enum(["product", "box", "pallet", "container"], {
    required_error: "Please select an inventory type.",
  }),
  productSubType: z.enum(["new", "restock"]).optional(),
  productId: z.string().optional(), // For restock - selected product ID
  productName: z.string().optional(),
  sku: z.string().optional(),
  containerSize: z.enum(["20 feet", "40 feet"]).optional(), // For container type
  quantity: z.coerce.number().int().positive("Quantity must be a positive number."),
  remarks: z.string().optional(), // Optional remarks field
}).refine((data) => {
  // For product type, productSubType is required
  if (data.inventoryType === "product" && !data.productSubType) {
    return false;
  }
  return true;
}, {
  message: "Please select New or Restock.",
  path: ["productSubType"],
}).refine((data) => {
  // For new product, productName and SKU are required
  if (data.inventoryType === "product" && data.productSubType === "new") {
    if (!data.productName || data.productName.trim() === "") {
      return false;
    }
    if (!data.sku || data.sku.trim() === "") {
      return false;
    }
  }
  return true;
}, {
  message: "Product name and SKU are required for new products.",
  path: ["productName"],
}).refine((data) => {
  // For restock, productId is required
  if (data.inventoryType === "product" && data.productSubType === "restock") {
    if (!data.productId || data.productId.trim() === "") {
      return false;
    }
  }
  return true;
}, {
  message: "Please select a product to restock.",
  path: ["productId"],
});

export function AddInventoryRequestForm({
  targetUserId,
  targetUserName,
  mode = "dialog",
}: {
  /**
   * When provided, creates the inventory request under this user
   * (admin "create request like user" workflow).
   */
  targetUserId?: string;
  targetUserName?: string;
  /**
   * - `dialog` (default): shows a button that opens the request dialog
   * - `inline`: renders the request form directly (no button/dialog)
   */
  mode?: "dialog" | "inline";
} = {}) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(mode === "inline");
  const [generatedId, setGeneratedId] = useState<string>("");
  const [selectedProductImageFile, setSelectedProductImageFile] = useState<File | null>(null);
  const [selectedProductImagePreview, setSelectedProductImagePreview] = useState<string>("");
  const [restockImageUrls, setRestockImageUrls] = useState<string[]>([]);

  const ownerId = targetUserId ?? userProfile?.uid;
  const ownerName = (targetUserName ?? userProfile?.name ?? "").trim();

  const form = useForm<z.infer<typeof inventoryRequestSchema>>({
    resolver: zodResolver(inventoryRequestSchema),
    defaultValues: {
      inventoryType: "product",
      productSubType: "new",
      productId: "",
      productName: "",
      sku: "",
      containerSize: undefined,
      quantity: 1,
      remarks: "",
    },
  });

  const inventoryType = form.watch("inventoryType");
  const productSubType = form.watch("productSubType");
  const containerSize = form.watch("containerSize");

  // Fetch existing inventory for restock dropdown
  const { data: existingInventory } = useCollection<InventoryItem>(
    ownerId ? `users/${ownerId}/inventory` : ""
  );

  // Filter only "In Stock" products for restock (show all products, exclude boxes/containers/pallets)
  const availableProductsForRestock = useMemo(() => {
    return existingInventory.filter(item => {
      const inventoryType = (item as any).inventoryType;
      const isExcludedType = inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
      return !isExcludedType && item.status === "In Stock";
    });
  }, [existingInventory]);

  // Fetch container handling pricing
  const { data: containerHandlingPricingList } = useCollection<UserContainerHandlingPricing>(
    ownerId ? `users/${ownerId}/containerHandlingPricing` : ""
  );

  // Get container pricing based on selected size
  const containerPricing = useMemo(() => {
    if (!containerSize || !containerHandlingPricingList || containerHandlingPricingList.length === 0) return null;
    return containerHandlingPricingList.find(p => p.containerSize === containerSize);
  }, [containerSize, containerHandlingPricingList]);

  const extractImageUrls = (item: Partial<InventoryItem> & { imageUrl?: string; imageUrls?: string[] }) => {
    if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) return item.imageUrls;
    if (item.imageUrl && typeof item.imageUrl === "string") return [item.imageUrl];
    return [];
  };

  const resetImageStates = () => {
    setSelectedProductImageFile(null);
    setSelectedProductImagePreview("");
    setRestockImageUrls([]);
  };

  const handleProductImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedProductImageFile(null);
      setSelectedProductImagePreview("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please select an image file.",
      });
      event.target.value = "";
      return;
    }

    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Please upload an image smaller than 5 MB.",
      });
      event.target.value = "";
      return;
    }

    setSelectedProductImageFile(file);
    setSelectedProductImagePreview(URL.createObjectURL(file));
  };

  const uploadProductImage = async (ownerUid: string): Promise<string[]> => {
    if (!selectedProductImageFile) return [];
    const cleanName = selectedProductImageFile.name.replace(/\s+/g, "_");
    const path = `inventory-product-images/${ownerUid}/${Date.now()}_${cleanName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, selectedProductImageFile);
    const downloadUrl = await getDownloadURL(storageRef);
    return [downloadUrl];
  };

  // Generate Box/Pallet/Container ID when type changes
  useEffect(() => {
    const generateId = async () => {
      if (
        !user ||
        !ownerId ||
        (inventoryType !== "box" && inventoryType !== "pallet" && inventoryType !== "container")
      ) {
        setGeneratedId("");
        form.setValue("productName", "");
        return;
      }

      try {
        // Get user's name initials
        const nameParts = ownerName.trim() ? ownerName.trim().split(/\s+/) : [];
        const firstName = nameParts[0] || "U";
        const lastName = nameParts[nameParts.length - 1] || "X";
        const initials = `${firstName.charAt(0).toUpperCase()}${lastName.charAt(0).toUpperCase()}`;

        // Get existing boxes/pallets to find the next number
        const inventoryRef = collection(db, `users/${ownerId}/inventory`);
        const requestsRef = collection(db, `users/${ownerId}/inventoryRequests`);
        
        // Query existing inventory items - removed orderBy to avoid index requirement
        const inventoryQuery = query(
          inventoryRef,
          where("inventoryType", "==", inventoryType)
        );
        
        // Query existing requests - removed orderBy to avoid index requirement
        const requestsQuery = query(
          requestsRef,
          where("inventoryType", "==", inventoryType)
        );

        const [inventorySnapshot, requestsSnapshot] = await Promise.all([
          getDocs(inventoryQuery),
          getDocs(requestsQuery),
        ]);

        const typePrefix = inventoryType.toUpperCase();
        const idPattern = new RegExp(`^${initials}-${typePrefix}-(\\d+)$`);
        
        // Extract numbers from existing IDs that match the exact pattern (same initials and type)
        const existingNumbers: number[] = [];
        const existingIds = new Set<string>();
        
        inventorySnapshot.docs.forEach((doc) => {
          const data = doc.data();
          const name = data.productName || "";
          existingIds.add(name);
          const match = name.match(idPattern);
          if (match) {
            existingNumbers.push(parseInt(match[1], 10));
          }
        });

        requestsSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          const name = data.productName || "";
          existingIds.add(name);
          const match = name.match(idPattern);
          if (match) {
            existingNumbers.push(parseInt(match[1], 10));
          }
        });

        let newId: string;
        
        // For containers, boxes, and pallets, use random number instead of sequential
        // Generate a random 4-digit number (1000-9999) for better uniqueness
        let attempts = 0;
        const maxAttempts = 100; // Safety limit
        
        do {
          const randomNumber = Math.floor(1000 + Math.random() * 9000); // 4-digit random number (1000-9999)
          newId = `${initials}-${typePrefix}-${randomNumber}`;
          attempts++;
        } while (existingIds.has(newId) && attempts < maxAttempts);
        
        if (attempts >= maxAttempts) {
          // Fallback: use timestamp to ensure uniqueness
          const timestamp = Date.now().toString().slice(-4);
          newId = `${initials}-${typePrefix}-${timestamp}`;
        }
        
        setGeneratedId(newId);
        form.setValue("productName", newId);
      } catch (error) {
        console.error("Error generating ID:", error);
        // Fallback: use timestamp-based ID
        const nameParts = ownerName.trim() ? ownerName.trim().split(/\s+/) : [];
        const firstName = nameParts[0] || "U";
        const lastName = nameParts[nameParts.length - 1] || "X";
        const initials = `${firstName.charAt(0).toUpperCase()}${lastName.charAt(0).toUpperCase()}`;
        const typePrefix = inventoryType.toUpperCase();
        const fallbackId = `${initials}-${typePrefix}-${Date.now().toString().slice(-4)}`;
        setGeneratedId(fallbackId);
        form.setValue("productName", fallbackId);
      }
    };

    generateId();
  }, [inventoryType, user, ownerId, ownerName, form]);

  useEffect(() => {
    resetImageStates();
  }, [inventoryType, productSubType]);

  async function onSubmit(values: z.infer<typeof inventoryRequestSchema>) {
    if (!user || !ownerId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to add inventory.",
      });
      return;
    }

    setIsLoading(true);
    try {
      // For Box/Pallet, verify ID uniqueness before submitting
      if ((values.inventoryType === "box" || values.inventoryType === "pallet") && values.productName) {
        const inventoryRef = collection(db, `users/${ownerId}/inventory`);
        const requestsRef = collection(db, `users/${ownerId}/inventoryRequests`);
        
        const [inventorySnapshot, requestsSnapshot] = await Promise.all([
          getDocs(query(inventoryRef, where("productName", "==", values.productName))),
          getDocs(query(requestsRef, where("productName", "==", values.productName))),
        ]);

        // Check if ID already exists
        if (inventorySnapshot.docs.length > 0 || requestsSnapshot.docs.length > 0) {
          toast({
            variant: "destructive",
            title: "ID Already Exists",
            description: `The ID "${values.productName}" already exists. Please try again or contact support.`,
          });
          setIsLoading(false);
          // Regenerate ID by triggering the useEffect
          const currentType = form.getValues("inventoryType");
          form.setValue("inventoryType", currentType === "box" ? "pallet" : "box");
          setTimeout(() => {
            form.setValue("inventoryType", currentType);
          }, 100);
          return;
        }
      }

      const addDate = Timestamp.now();
      const requestedAt = Timestamp.now();

      // For restock, get product name from selected product
      let finalProductName = values.productName;
      if (values.inventoryType === "product" && values.productSubType === "restock" && values.productId) {
        const selectedProduct = availableProductsForRestock.find(p => p.id === values.productId);
        if (selectedProduct) {
          finalProductName = selectedProduct.productName;
        }
      }

      let finalImageUrls: string[] = [];
      if (values.inventoryType === "product" && values.productSubType === "new") {
        finalImageUrls = await uploadProductImage(ownerId);
      } else if (values.inventoryType === "product" && values.productSubType === "restock" && values.productId) {
        const selectedProduct = availableProductsForRestock.find(p => p.id === values.productId);
        if (selectedProduct) {
          finalImageUrls = extractImageUrls(selectedProduct as any);
        }
      }

      const requestData: any = {
        userId: ownerId,
        userName: ownerName || "Unknown User",
        inventoryType: values.inventoryType,
        productName: finalProductName,
        quantity: values.quantity,
        addDate,
        status: "pending",
        requestedBy: ownerId,
        requestedAt,
      };

      // Only include productSubType and productId for product type requests
      if (values.inventoryType === "product") {
        if (values.productSubType) {
          requestData.productSubType = values.productSubType;
        }
        if (values.productId) {
          requestData.productId = values.productId;
        }
      }

      // Only include containerSize for container type requests
      if (values.inventoryType === "container" && values.containerSize) {
        requestData.containerSize = values.containerSize;
      }

      // Only include SKU for new product type
      if (values.inventoryType === "product" && values.productSubType === "new" && values.sku) {
        requestData.sku = values.sku;
      } else if (values.inventoryType === "product" && values.productSubType === "restock" && values.productId) {
        // For restock, get SKU from selected product
        const selectedProduct = availableProductsForRestock.find(p => p.id === values.productId);
        if (selectedProduct && (selectedProduct as any).sku) {
          requestData.sku = (selectedProduct as any).sku;
        }
      }

      // Include remarks if provided (trim whitespace)
      if (values.remarks && values.remarks.trim()) {
        requestData.remarks = values.remarks.trim();
      }

      if (finalImageUrls.length > 0) {
        requestData.imageUrls = finalImageUrls;
        requestData.imageUrl = finalImageUrls[0];
      }

      await addDoc(collection(db, `users/${ownerId}/inventoryRequests`), requestData);

      toast({
        title: "Success",
        description: "Inventory request submitted successfully. Waiting for admin approval.",
      });

      form.reset({
        inventoryType: "product",
        productSubType: "new",
        productId: "",
        productName: "",
        sku: "",
        containerSize: undefined,
        quantity: 1,
        remarks: "",
      });
      resetImageStates();
      setOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to submit inventory request.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const getTypeLabel = (type: InventoryType) => {
    switch (type) {
      case "product":
        return "Product";
      case "box":
        return "Box";
      case "pallet":
        return "Pallet";
      case "container":
        return "Container";
      default:
        return type;
    }
  };

  const getNameLabel = (type: InventoryType) => {
    switch (type) {
      case "product":
        return "Product Name";
      case "box":
        return "Box Name/ID";
      case "pallet":
        return "Pallet Name/ID";
      case "container":
        return "Container ID";
      default:
        return "Name";
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "dialog" && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Inventory
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Inventory Request</DialogTitle>
          <DialogDescription>
            Submit an inventory request. Admin will review and approve it.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="inventoryType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Inventory Type</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="product" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Package className="h-4 w-4 text-primary" />
                          Product
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="box" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Archive className="h-4 w-4 text-amber-600" />
                          Box
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="pallet" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Boxes className="h-4 w-4 text-violet-600" />
                          Pallet
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="container" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Truck className="h-4 w-4 text-cyan-600" />
                          Container Handling
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Product Sub-Type Selection (New/Restock) */}
            {inventoryType === "product" && (
              <FormField
                control={form.control}
                name="productSubType"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Product Type</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={(value) => {
                          field.onChange(value);
                          // Reset fields when switching between new/restock
                          if (value === "new") {
                            form.setValue("productId", "");
                            form.setValue("productName", "");
                            form.setValue("sku", "");
                          } else {
                            form.setValue("productName", "");
                            form.setValue("sku", "");
                          }
                        }}
                        value={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="new" />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer">
                            New Product
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="restock" />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer">
                            Restock Existing Product
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Restock: Product Selection */}
            {inventoryType === "product" && productSubType === "restock" && (
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Product to Restock *</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        // Auto-fill product name and SKU from selected product
                        const selectedProduct = availableProductsForRestock.find(p => p.id === value);
                        if (selectedProduct) {
                          form.setValue("productName", selectedProduct.productName);
                          form.setValue("sku", (selectedProduct as any).sku || "");
                          setRestockImageUrls(extractImageUrls(selectedProduct as any));
                        }
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a product to restock" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableProductsForRestock.length === 0 ? (
                          <SelectItem value="no-products" disabled>
                            No products available for restock
                          </SelectItem>
                        ) : (
                          availableProductsForRestock.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.productName} {product.sku ? `(SKU: ${product.sku})` : ""} - Qty: {product.quantity}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {inventoryType === "product" && productSubType === "restock" && restockImageUrls.length > 0 && (
              <div className="space-y-2">
                <Label>Current product picture</Label>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <img
                    src={restockImageUrls[0]}
                    alt="Current product"
                    className="h-24 w-24 rounded-md border object-cover"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    This existing product photo will be reused for this restock request.
                  </p>
                </div>
              </div>
            )}

            {/* Container Size Selection */}
            {inventoryType === "container" && (
              <FormField
                control={form.control}
                name="containerSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Container Size *</FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select container size" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="20 feet">20 Feet</SelectItem>
                        <SelectItem value="40 feet">40 Feet</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Product Name - Only show for New Product, Box, Pallet, or Container */}
            {(inventoryType !== "product" || productSubType === "new") && (
              <FormField
                control={form.control}
                name="productName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{getNameLabel(inventoryType)}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={`Enter ${getTypeLabel(inventoryType).toLowerCase()} name`}
                        {...field}
                        readOnly={inventoryType === "box" || inventoryType === "pallet" || inventoryType === "container"}
                        className={inventoryType === "box" || inventoryType === "pallet" || inventoryType === "container" ? "bg-muted" : ""}
                      />
                    </FormControl>
                    {(inventoryType === "box" || inventoryType === "pallet" || inventoryType === "container") && generatedId && (
                      <p className="text-xs text-muted-foreground">
                        ID will be auto-generated: {generatedId}
                      </p>
                    )}
                    {inventoryType === "container" && containerPricing && (
                      <p className="text-xs text-muted-foreground">
                        Pricing: ${containerPricing.price.toFixed(2)} per {containerSize} container
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* New Product: SKU Field */}
            {inventoryType === "product" && productSubType === "new" && (
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter SKU"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {inventoryType === "product" && productSubType === "new" && (
              <div className="space-y-2">
                <Label htmlFor="productImage" className="flex items-center gap-2">
                  <ImagePlus className="h-4 w-4" />
                  Product Picture (Optional)
                </Label>
                <Input
                  id="productImage"
                  type="file"
                  accept="image/*"
                  onChange={handleProductImageSelect}
                />
                {selectedProductImagePreview && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <img
                      src={selectedProductImagePreview}
                      alt="Selected product preview"
                      className="h-24 w-24 rounded-md border object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      min="1" 
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      value={field.value}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Remarks Field - Available for all inventory types */}
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any additional notes or remarks about this inventory request..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (mode === "dialog") {
                    setOpen(false);
                    resetImageStates();
                  } else {
                    form.reset({
                      inventoryType: "product",
                      productSubType: "new",
                      productId: "",
                      productName: "",
                      sku: "",
                      containerSize: undefined,
                      quantity: 1,
                      remarks: "",
                    });
                    resetImageStates();
                  }
                }}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Request
              </Button>
            </div>
          </form>
        </Form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

