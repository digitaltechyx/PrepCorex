"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { collection, doc, Timestamp, writeBatch } from "firebase/firestore";
import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X, Plus, ChevronDown } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import type { InventoryItem, ServiceType, ProductType, UserPricing, UserBoxForwardingPricing, UserPalletForwardingPricing, UserAdditionalServicesPricing } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollection } from "@/hooks/use-collection";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
import imageCompression from "browser-image-compression";
import { ImageIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const shipmentItemSchema = z.object({
  productId: z.string().min(1, "Select a product."),
  quantity: z.coerce.number().int().positive("Shipped quantity must be a positive number."),
  packOf: z.coerce.number().int().positive("Pack size must be a positive number."),
  // Custom products use placeholder pricing until admin sets final pricing.
  unitPrice: z.coerce.number().nonnegative("Unit price must be a non-negative number."),
  totalPrice: z.coerce.number().nonnegative("Total price must be a non-negative number."),
  // Per-line type/dimensions (product shipments only; validated in group superRefine)
  productType: z.enum(["Standard", "Large", "Custom"]).optional(),
  customDimensions: z.string().optional(),
  // Additional Services per product - user only selects which services they want (boolean flags)
  // Admin will add quantities during approval
  selectedAdditionalServices: z.array(z.enum(["bubbleWrap", "stickerRemoval", "warningLabels"])).optional(),
});

const shipmentGroupSchema = z.object({
  shipmentType: z.enum(["product", "box", "pallet"], { required_error: "Shipment type is required." }),
  palletSubType: z.enum(["existing_inventory", "forwarding"]).optional(),
  shipments: z.array(shipmentItemSchema).min(1, "Select at least one item to ship."),
  date: z.date({ required_error: "A shipping date is required." }),
  remarks: z.string().optional(),
  service: z.enum(["FBA/WFS/TFS", "FBM"]).optional(),
}).superRefine((data, ctx) => {
  if (data.shipmentType === "product") {
    if (!data.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Service is required for product shipments.",
        path: ["service"],
      });
    }
    (data.shipments || []).forEach((s, i) => {
      if (!s.productType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Product type / dimension is required for each line.",
          path: ["shipments", i, "productType"],
        });
      }
      if (s.productType === "Custom") {
        if (typeof s.customDimensions !== "string" || s.customDimensions.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Custom dimensions are required for Custom product type.",
            path: ["shipments", i, "customDimensions"],
          });
        }
      } else if (s.productType && s.productType !== "Custom") {
        const p = Number(s.unitPrice);
        if (Number.isNaN(p) || p <= 1e-9) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unit price must be a positive number.",
            path: ["shipments", i, "unitPrice"],
          });
        }
      }
    });
  }
}).refine((data) => {
  if (data.shipmentType === "pallet") {
    return data.palletSubType;
  }
  return true;
}, {
  message: "Please select pallet sub-type.",
  path: ["palletSubType"],
});

const formSchema = z.object({
  shipmentGroups: z.array(shipmentGroupSchema).min(1, "Create at least one shipment."),
});

interface CreateShipmentWithLabelsFormProps {
  inventory: InventoryItem[];
  /**
   * When set (e.g. admin creating for a client), shipment requests and pricing
   * subcollections use this user. Defaults to the signed-in user.
   */
  targetUserId?: string;
  targetUserName?: string;
}

interface LabelItem {
  file: File;
  preview: string | null;
  uploadedUrl: string | null;
}

interface LabelUploadState {
  items: LabelItem[];
  isUploading: boolean;
}

export function CreateShipmentWithLabelsForm({
  inventory,
  targetUserId,
  targetUserName,
}: CreateShipmentWithLabelsFormProps) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const ownerId = targetUserId ?? user?.uid ?? "";
  const ownerDisplayName =
    (targetUserName ?? userProfile?.name ?? "").trim() || "Unknown User";

  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  
  // Label upload states for each shipment group
  const [labelStates, setLabelStates] = useState<Record<number, LabelUploadState>>({});
  
  // Popup states for each group
  const [openPopups, setOpenPopups] = useState<Record<string, boolean>>({});
  
  // Accordion state - only one shipment open at a time
  const [openAccordionValue, setOpenAccordionValue] = useState<string | undefined>(undefined);
  
  const togglePopup = (groupId: string, popupType: string) => {
    const key = `${groupId}_${popupType}`;
    setOpenPopups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };
  
  const closePopup = (groupId: string, popupType: string) => {
    const key = `${groupId}_${popupType}`;
    setOpenPopups(prev => ({
      ...prev,
      [key]: false
    }));
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      shipmentGroups: [],
    },
  });

  const { fields: shipmentGroups, append: appendGroup, remove: removeGroup } = useFieldArray({
    control: form.control,
    name: "shipmentGroups",
  });

  // Fetch pricing for the inventory owner (client), including when admin targets a user
  const { data: pricingRules } = useCollection<UserPricing>(
    ownerId ? `users/${ownerId}/pricing` : ""
  );

  const { data: boxForwardingPricing } = useCollection<UserBoxForwardingPricing>(
    ownerId ? `users/${ownerId}/boxForwardingPricing` : ""
  );

  const { data: palletForwardingPricing } = useCollection<UserPalletForwardingPricing>(
    ownerId ? `users/${ownerId}/palletForwardingPricing` : ""
  );

  const { data: additionalServicesPricing } = useCollection<UserAdditionalServicesPricing>(
    ownerId ? `users/${ownerId}/additionalServicesPricing` : ""
  );


  // Auto-calculate pricing for all shipment groups
  const watchedGroups = form.watch("shipmentGroups");
  useEffect(() => {
    try {
      const allGroups = watchedGroups || [];
      
      if (!Array.isArray(allGroups)) return;
      
      allGroups.forEach((group, groupIndex) => {
        if (!group) return;
        
        const shipmentType = group.shipmentType;
        const palletSubType = group.palletSubType;
        const service = group.service;
        const shipments = group.shipments || [];
        
        if (!Array.isArray(shipments)) return;
        
        shipments.forEach((shipment, shipmentIndex) => {
          if (!shipment) return;
        const lineProductType = shipment.productType;
        const quantity = shipment.quantity || 0;
        // Keep packOf for Custom too (admin needs full detail). Pricing stays placeholder for Custom.
        const packOf = shipmentType === "product" ? (shipment.packOf || 1) : 1;
        const totalUnits = quantity * packOf;
        
        let finalUnitPrice = 0;
        
        // Custom product pricing is a placeholder ($1). Admin will set final pricing during approval.
        if (shipmentType === "product" && lineProductType === "Custom") {
          finalUnitPrice = 1;
        } else if (shipmentType === "product" && service && lineProductType && pricingRules && pricingRules.length > 0) {
          // Use quantity (not totalUnits) to determine unit price
          // This ensures unit price stays consistent regardless of packOf value
          const calculatedPrice = calculatePrepUnitPrice(
            pricingRules,
            service,
            lineProductType,
            quantity // Use quantity, not totalUnits, to get consistent unit price
          );
          if (calculatedPrice && calculatedPrice.rate !== undefined && calculatedPrice.rate !== null) {
            finalUnitPrice = calculatedPrice.rate;
          }
        } else if (shipmentType === "box") {
          if (boxForwardingPricing && boxForwardingPricing.length > 0) {
            const latestBoxPricing = [...boxForwardingPricing].sort((a, b) => {
              const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
              const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
              return bUpdated - aUpdated;
            })[0];
            if (latestBoxPricing && latestBoxPricing.price !== undefined && latestBoxPricing.price !== null) {
              // Ensure price is a number
              const priceValue = typeof latestBoxPricing.price === 'string' 
                ? parseFloat(latestBoxPricing.price) 
                : latestBoxPricing.price;
              if (!isNaN(priceValue) && priceValue > 0) {
                finalUnitPrice = priceValue;
              }
            }
          }
          // If no pricing found, keep finalUnitPrice at 0 to clear incorrect values
        } else if (shipmentType === "pallet") {
          if (palletSubType === "forwarding") {
            if (palletForwardingPricing && palletForwardingPricing.length > 0) {
              const latestPalletForwarding = [...palletForwardingPricing].sort((a, b) => {
                const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
                const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
                return bUpdated - aUpdated;
              })[0];
              if (latestPalletForwarding && latestPalletForwarding.price !== undefined && latestPalletForwarding.price !== null) {
                // Ensure price is a number
                const priceValue = typeof latestPalletForwarding.price === 'string' 
                  ? parseFloat(latestPalletForwarding.price) 
                  : latestPalletForwarding.price;
                if (!isNaN(priceValue) && priceValue > 0) {
                  finalUnitPrice = priceValue;
                }
              }
            }
          } else if (palletSubType === "existing_inventory") {
            // Existing Inventory pallets are priced manually by admin at approval time.
            // Keep pricing at 0 as a placeholder.
            finalUnitPrice = 0;
          }
          // If no pricing found, keep finalUnitPrice at 0 to clear incorrect values
        }

        // Calculate total price
        // Formula: Total = (Unit Price Ã— Quantity) + (Pack Of Price Ã— (Pack Of - 1))
        // The unit price is per item, and packOfPrice is charged for each pack beyond the first one
        // Example: Rate = 0.10, Pack Of Price = 1.00, Quantity = 10
        //   Pack Of = 1: (0.10 Ã— 10) + (1.00 Ã— 0) = 1.00 + 0.00 = 1.00 (first pack is free)
        //   Pack Of = 2: (0.10 Ã— 10) + (1.00 Ã— 1) = 1.00 + 1.00 = 2.00 (charge for 2nd pack)
        //   Pack Of = 3: (0.10 Ã— 10) + (1.00 Ã— 2) = 1.00 + 2.00 = 3.00 (charge for 2nd and 3rd pack)
        //   Pack Of = 5: (0.10 Ã— 10) + (1.00 Ã— 4) = 1.00 + 4.00 = 5.00 (charge for 2nd, 3rd, 4th, 5th pack)
        let calculatedTotal = 0;
        // Custom product total shown to user is a placeholder ($1).
        if (shipmentType === "product" && lineProductType === "Custom") {
          calculatedTotal = 1;
        } else if (shipmentType === "product" && finalUnitPrice > 0 && quantity > 0) {
          const baseTotal = finalUnitPrice * quantity; // Unit price Ã— quantity (not multiplied by packOf)
          let packOfPrice = 0;
          if (service && lineProductType && pricingRules && pricingRules.length > 0) {
            // Look up packOfPrice based on quantity only, not totalUnits
            // This ensures packOfPrice doesn't change when packOf changes
            const calculatedPriceForPackOf = calculatePrepUnitPrice(
              pricingRules,
              service,
              lineProductType,
              quantity // Use quantity, not totalUnits, to get the correct packOfPrice
            );
            if (calculatedPriceForPackOf) {
              packOfPrice = calculatedPriceForPackOf.packOf || 0; // Charge per pack (beyond the first pack)
            }
          }
          // Pack charge: packOfPrice Ã— (packOf - 1)
          // First pack is free, charge applies from 2nd pack onwards
          // When packOf = 1, charge = 0 (no additional packs)
          // When packOf = 2, charge = packOfPrice Ã— 1 (charge for 2nd pack)
          // When packOf = 3, charge = packOfPrice Ã— 2 (charge for 2nd and 3rd pack)
          // When packOf = 5, charge = packOfPrice Ã— 4 (charge for 2nd, 3rd, 4th, 5th pack)
          const packCharge = packOfPrice * Math.max(0, packOf - 1);
          calculatedTotal = parseFloat((baseTotal + packCharge).toFixed(2));
        } else if (finalUnitPrice > 0 && quantity > 0) {
          calculatedTotal = parseFloat((finalUnitPrice * quantity).toFixed(2));
        }

        // Always update to ensure pricing is calculated correctly
        const currentUnitPrice = form.getValues(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice`);
        const currentTotalPrice = form.getValues(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.totalPrice`);
        
        // Update unit price if it changed - always update when we have a calculated price (even if it's 0.10)
        // Use a small epsilon for floating point comparison
        if (Math.abs((currentUnitPrice || 0) - finalUnitPrice) > 0.001) {
          form.setValue(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice`, finalUnitPrice, { shouldValidate: false });
        }
        
        // Update total price if it changed
        if (currentTotalPrice !== calculatedTotal) {
          form.setValue(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.totalPrice`, calculatedTotal, { shouldValidate: false });
        }

        // For Custom products, ensure unitPrice is always set to 1 in form state (prevents submit validation issues)
        if (shipmentType === "product" && lineProductType === "Custom" && Math.abs((currentUnitPrice || 0) - 1) > 0.001) {
          form.setValue(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice`, 1, { shouldValidate: false });
        }
        });
      });
    } catch (error) {
      console.error("Error calculating pricing:", error);
    }
  }, [watchedGroups, pricingRules, boxForwardingPricing, palletForwardingPricing, form]);

  // Initialize label state when a new group is added
  const handleAddShipmentGroup = () => {
    const newIndex = shipmentGroups.length;
    appendGroup({
      shipmentType: "product",
      palletSubType: undefined,
      shipments: [],
      date: new Date(),
      remarks: undefined,
      service: "FBA/WFS/TFS",
    });
    setLabelStates(prev => ({
      ...prev,
      [newIndex]: { items: [], isUploading: false }
    }));
  };

  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error("Error compressing image:", error);
      throw error;
    }
  };

  const handleLabelSelect = async (groupIndex: number, event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const fileList = event.target.files;
      if (!fileList?.length) return;

      const maxSizeBytes = 10 * 1024 * 1024;
      const newItems: LabelItem[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;
        const isValidType = file.type.startsWith("image/") || file.type === "application/pdf";
        if (!isValidType) {
          toast({
            variant: "destructive",
            title: "Invalid File",
            description: `"${file.name}" is not a valid type. Please select images (JPG, PNG) or PDF.`,
          });
          continue;
        }
        if (file.size > maxSizeBytes) {
          toast({
            variant: "destructive",
            title: "File Too Large",
            description: `"${file.name}" is over 10 MB. Please choose a smaller file.`,
          });
          continue;
        }
        newItems.push({
          file,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          uploadedUrl: null,
        });
      }
      if (newItems.length === 0) return;

      setLabelStates(prev => ({
        ...prev,
        [groupIndex]: {
          ...prev[groupIndex],
          items: [...(prev[groupIndex]?.items ?? []), ...newItems],
          isUploading: prev[groupIndex]?.isUploading ?? false,
        }
      }));
      event.target.value = "";
    } catch (error: any) {
      console.error("Error selecting label file:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to select file. Please try again.",
      });
    }
  };

  const uploadOneLabel = async (groupIndex: number, itemIndex: number, file: File): Promise<string | null> => {
    if (!ownerId) return null;
    let fileToUpload = file;
    if (file.type.startsWith("image/")) {
      const compressedFile = await compressImage(file);
      if (compressedFile.size > 1024 * 1024) return null;
      fileToUpload = compressedFile;
    }
    const currentDate = new Date();
    const clientName = ownerDisplayName;
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('clientName', clientName);
    const originalName = file.name || fileToUpload.name;
    if (originalName && originalName !== 'blob') {
      formData.append('fileName', originalName);
    }
    const year = currentDate.getFullYear().toString();
    const month = currentDate.toLocaleString('en-US', { month: 'long' });
    const dateStr = currentDate.toISOString().split('T')[0];
    formData.append('folderPath', `${year}/${month}/${clientName}/${dateStr}`);

    const response = await fetch('/api/onedrive/upload', { method: 'POST', body: formData });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Label upload failed.');
    }
    const result = await response.json();
    const urlToStore = result.webUrl || result.downloadURL;
    if (!urlToStore) throw new Error('Label upload failed.');

    setLabelStates(prev => {
      const items = [...(prev[groupIndex]?.items ?? [])];
      if (items[itemIndex]) items[itemIndex] = { ...items[itemIndex], uploadedUrl: urlToStore };
      return { ...prev, [groupIndex]: { ...prev[groupIndex], items, isUploading: prev[groupIndex]?.isUploading ?? false } };
    });
    return urlToStore;
  };

  const handleLabelUpload = async (groupIndex: number): Promise<string[]> => {
    const labelState = labelStates[groupIndex];
    const items = labelState?.items ?? [];
    const pending = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => !item.uploadedUrl && item.file);
    if (pending.length === 0) {
      return items.map((i) => i.uploadedUrl).filter(Boolean) as string[];
    }
    try {
      setLabelStates(prev => ({ ...prev, [groupIndex]: { items: prev[groupIndex]?.items ?? [], isUploading: true } }));
      const urls: string[] = [];
      for (const { item, idx } of pending) {
        if (!item.file) continue;
        const url = await uploadOneLabel(groupIndex, idx, item.file);
        if (url) urls.push(url);
      }
      const allUrls = [...items.map((i) => i.uploadedUrl).filter(Boolean), ...urls] as string[];
      if (urls.length > 0) {
        toast({
          title: "Success",
          description: urls.length === 1 ? "Label uploaded successfully!" : `${urls.length} labels uploaded successfully!`,
        });
      }
      return allUrls;
    } catch (error: any) {
      console.error("Error uploading label:", error);
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message || "Label upload failed. Please try again.",
      });
      setLabelStates(prev => ({ ...prev, [groupIndex]: { ...prev[groupIndex], isUploading: false } }));
      return items.map((i) => i.uploadedUrl).filter(Boolean) as string[];
    }
  };

  const handleRemoveLabel = (groupIndex: number, itemIndex?: number) => {
    setLabelStates(prev => {
      const state = prev[groupIndex];
      const items = state?.items ?? [];
      if (itemIndex !== undefined) {
        const item = items[itemIndex];
        if (item?.preview) URL.revokeObjectURL(item.preview);
        const newItems = items.filter((_, i) => i !== itemIndex);
        return { ...prev, [groupIndex]: { items: newItems, isUploading: false } };
      }
      items.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
      return { ...prev, [groupIndex]: { items: [], isUploading: false } };
    });
  };

  const handleRemoveGroup = (index: number) => {
    handleRemoveLabel(index);
    removeGroup(index);
    const newStates: Record<number, LabelUploadState> = {};
    shipmentGroups.forEach((_, i) => {
      if (i !== index) {
        const oldIndex = i > index ? i - 1 : i;
        newStates[oldIndex] = labelStates[i] || { items: [], isUploading: false };
      }
    });
    setLabelStates(newStates);
  };

  // Helper function to remove undefined values from objects (Firestore doesn't allow undefined)
  const removeUndefined = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return null;
    }
    // Preserve Firestore Timestamp objects
    if (obj && typeof obj === 'object' && ('seconds' in obj || 'toDate' in obj || obj.constructor?.name === 'Timestamp')) {
      return obj;
    }
    // Preserve Date objects
    if (obj instanceof Date) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(removeUndefined).filter(item => item !== undefined);
    }
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const key in obj) {
        if (obj[key] !== undefined) {
          cleaned[key] = removeUndefined(obj[key]);
        }
      }
      return cleaned;
    }
    return obj;
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create shipment requests.",
      });
      return;
    }
    if (!ownerId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No client user selected for shipment requests.",
      });
      return;
    }
    if (!targetUserId && !userProfile) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User profile is still loading. Try again in a moment.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      const requestedAt = Timestamp.now();
      let totalRequestsCreated = 0;

      // Process each shipment group
      for (let i = 0; i < values.shipmentGroups.length; i++) {
        const group = values.shipmentGroups[i];
        // Get the current label state - check both the index and ensure we have the latest state
        const labelState = labelStates[i] || { items: [], isUploading: false };

        // Validate stock availability for this group
        const stockErrors: string[] = [];
        group.shipments.forEach((shipment) => {
          const product = inventory.find(item => item.id === shipment.productId);
          if (product) {
            const packOf = group.shipmentType === "product" ? (shipment.packOf || 1) : 1;
            const totalUnits = shipment.quantity * packOf;
            if (totalUnits > product.quantity) {
              const unitType = group.shipmentType === "box" ? "boxes" : group.shipmentType === "pallet" ? "pallets" : "units";
              stockErrors.push(
                `${product.productName}: Requested ${totalUnits} ${unitType} but only ${product.quantity} available.`
              );
            }
          }
        });

        if (stockErrors.length > 0) {
          toast({
            variant: "destructive",
            title: "Insufficient Stock",
            description: `Group ${i + 1}: ${stockErrors.join(" ")}`,
          });
          setIsLoading(false);
          return;
        }

        // Upload labels if selected (optional) - get fresh state to ensure we have the latest
        const currentLabelState = labelStates[i] || { items: [], isUploading: false };
        const hasPending = currentLabelState.items.some((it) => it.file && !it.uploadedUrl);
        const existingUrls = currentLabelState.items.map((it) => it.uploadedUrl).filter(Boolean) as string[];
        let labelUrl = "";
        if (existingUrls.length > 0 && !hasPending) {
          labelUrl = existingUrls.join(",");
          console.log(`[Group ${i + 1}] Using existing label URL(s):`, labelUrl);
        } else if (currentLabelState.items.length > 0 || hasPending) {
          const uploadedUrls = await handleLabelUpload(i);
          labelUrl = uploadedUrls.join(",");
          if (labelUrl) console.log(`[Group ${i + 1}] Label(s) uploaded:`, labelUrl);
        }

        const dateTimestamp = Timestamp.fromDate(group.date);

        const mapShipmentsForFirestore = (rows: typeof group.shipments) =>
          rows.map((shipment: any) => {
            const cleaned: any = {
              productId: shipment.productId,
              quantity: shipment.quantity,
              packOf: shipment.packOf || 1,
              unitPrice: shipment.unitPrice || 0,
            };
            if (shipment.selectedAdditionalServices && shipment.selectedAdditionalServices.length > 0) {
              cleaned.selectedAdditionalServices = shipment.selectedAdditionalServices;
            }
            return cleaned;
          });

        const writeOneRequest = (shipmentsSlice: typeof group.shipments, productType?: ProductType, customDimensions?: string) => {
          const requestRef = doc(collection(db, `users/${ownerId}/shipmentRequests`));
          const requestData: any = {
            userId: ownerId,
            userName: ownerDisplayName,
            date: dateTimestamp,
            remarks: group.remarks || undefined,
            shipmentType: group.shipmentType,
            labelUrl: labelUrl || "",
            status: "pending",
            requestedBy: ownerId,
            requestedAt,
          };

          if (group.shipmentType === "box") {
            requestData.service = "Box Forwarding";
          } else if (group.shipmentType === "pallet") {
            if (group.palletSubType === "forwarding") {
              requestData.service = "Pallet Forwarding";
            } else if (group.palletSubType === "existing_inventory") {
              requestData.service = "Pallet Existing Inventory";
            }
            if (group.palletSubType) {
              requestData.palletSubType = group.palletSubType;
            }
          } else if (group.shipmentType === "product") {
            if (group.service) {
              requestData.service = group.service;
            }
            if (productType) {
              requestData.productType = productType;
            }
            if (productType === "Custom" && customDimensions?.trim()) {
              requestData.customDimensions = customDimensions.trim();
            }
          }

          requestData.shipments = mapShipmentsForFirestore(shipmentsSlice);
          batch.set(requestRef, removeUndefined(requestData));
          totalRequestsCreated += 1;
        };

        if (group.shipmentType === "product") {
          const buckets = new Map<
            string,
            { productType: ProductType; customDimensions?: string; rows: typeof group.shipments }
          >();
          for (const row of group.shipments) {
            const pt = row.productType;
            if (!pt) continue;
            const key = `${pt}||${(row.customDimensions || "").trim()}`;
            const existing = buckets.get(key);
            if (existing) {
              existing.rows.push(row);
            } else {
              buckets.set(key, {
                productType: pt,
                customDimensions: pt === "Custom" ? row.customDimensions : undefined,
                rows: [row],
              });
            }
          }
          for (const b of buckets.values()) {
            writeOneRequest(b.rows, b.productType, b.customDimensions);
          }
        } else {
          writeOneRequest(group.shipments);
        }
      }

      await batch.commit();

      toast({
        title: "Success",
        description: targetUserId
          ? `${totalRequestsCreated} shipment request(s) created for ${ownerDisplayName}.`
          : `${totalRequestsCreated} shipment request(s) with labels submitted successfully. Admin will review them.`,
      });

      form.reset({
        shipmentGroups: [],
      });
      setQuery("");
      setLabelStates({});
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to submit shipment requests.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const onInvalidSubmit = (errors: any) => {
    // Open the first shipment accordion that has an error so the user can see the field messages.
    const groups = errors?.shipmentGroups;
    if (Array.isArray(groups)) {
      const firstBadIndex = groups.findIndex((g) => g && Object.keys(g).length > 0);
      if (firstBadIndex >= 0) {
        setOpenAccordionValue(`shipment-${firstBadIndex}`);
      }
    }

    const findFirstMessage = (err: any): string | undefined => {
      if (!err) return undefined;
      if (typeof err?.message === "string" && err.message.length > 0) return err.message;
      if (Array.isArray(err)) {
        for (const item of err) {
          const msg = findFirstMessage(item);
          if (msg) return msg;
        }
        return undefined;
      }
      if (typeof err === "object") {
        for (const key of Object.keys(err)) {
          const msg = findFirstMessage(err[key]);
          if (msg) return msg;
        }
      }
      return undefined;
    };

    const firstMessage =
      findFirstMessage(errors?.shipmentGroups) ||
      "Please fill all required fields before submitting.";

    toast({
      variant: "destructive",
      title: "Fix required fields",
      description: firstMessage,
    });
  };

  if (!user || (!targetUserId && !userProfile)) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading user data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Simple Fulfillment Notice */}
      {!targetUserId && (
        <div className="p-4 border border-green-200 rounded-lg bg-green-50">
          <p className="text-sm text-green-800 font-medium">
            For same day fulfillment please create shipment before 11 am EST.
          </p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalidSubmit)} className="space-y-6">
          {/* Add Shipment Button */}
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Create Shipment</h3>
              <p className="text-sm text-muted-foreground">Create multiple shipments, each with its own label</p>
            </div>
            <Button
              type="button"
              onClick={handleAddShipmentGroup}
              variant="outline"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Shipment
            </Button>
          </div>

          {/* Shipments */}
          {shipmentGroups.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">No shipments yet. Click "Add Shipment" to get started.</p>
              </CardContent>
            </Card>
          )}

          <Accordion 
            type="single" 
            collapsible 
            value={openAccordionValue} 
            onValueChange={setOpenAccordionValue}
            className="space-y-4"
          >
          {shipmentGroups.map((group, groupIndex) => {
            const groupShipmentType = form.watch(`shipmentGroups.${groupIndex}.shipmentType`);
            const groupPalletSubType = form.watch(`shipmentGroups.${groupIndex}.palletSubType`);
            const groupService = form.watch(`shipmentGroups.${groupIndex}.service`);
            const groupShipments = form.watch(`shipmentGroups.${groupIndex}.shipments`);
            
            // Calculate available inventory without useMemo (inside map)
            const normalizedQuery = query.trim().toLowerCase();
            const availableInventory = inventory
              .filter((item) => item.quantity > 0)
              .filter((item) => {
                const inventoryType = (item as any).inventoryType;
                if (groupShipmentType === "box") {
                  return inventoryType === "box";
                } else if (groupShipmentType === "pallet") {
                  if (groupPalletSubType === "forwarding") {
                    return inventoryType === "pallet";
                  } else if (groupPalletSubType === "existing_inventory") {
                    // Show all products (inventoryType === "product" or undefined/missing)
                    const isExcludedType = inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
                    return !isExcludedType;
                  }
                  return false;
                } else {
                  // Product type - show all products (inventoryType === "product" or undefined/missing)
                  const isExcludedType = inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
                  return !isExcludedType;
                }
              })
              .filter((item) => item.productName.toLowerCase().includes(normalizedQuery));

            const labelState = labelStates[groupIndex] || { items: [], isUploading: false };

            const popupKey = group.id;

            return (
              <AccordionItem key={group.id} value={`shipment-${groupIndex}`} className="border-2 rounded-lg px-4 mb-4">
                <div className="relative">
                  <AccordionTrigger className="hover:no-underline pr-12 [&>svg]:hidden">
                    <div className="flex items-center justify-between w-full">
                      <div className="text-left">
                        <div className="text-lg font-semibold">Shipment {groupIndex + 1}</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          Each shipment creates a separate shipment request with its own label
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveGroup(groupIndex);
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <AccordionContent>
                  <div className="pt-4">
                    {/* Horizontal Entry-Type View (single line) */}
                    <div className="overflow-x-auto">
                      <div className="flex flex-nowrap items-end gap-3 min-w-max pb-4 border-b">
                    {/* Shipment Type - Popup */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.shipmentType`}
                      render={({ field }) => (
                        <FormItem className="flex-shrink-0">
                          <FormLabel className="text-xs text-muted-foreground mb-1 block">Shipment Type *</FormLabel>
                          <Dialog open={openPopups[`${popupKey}_shipmentType`] || false} onOpenChange={(open) => {
                            if (open) {
                              setOpenPopups(prev => ({ ...prev, [`${popupKey}_shipmentType`]: true }));
                            } else {
                              closePopup(popupKey, 'shipmentType');
                            }
                          }}>
                            <DialogTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-[120px] justify-between"
                                onClick={() => togglePopup(popupKey, 'shipmentType')}
                              >
                                <span className="truncate">{field.value ? field.value.charAt(0).toUpperCase() + field.value.slice(1) : "Select"}</span>
                                <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-1" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Select Shipment Type</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-2 py-4">
                                {["product", "box", "pallet"].map((type) => (
                                  <Button
                                    key={type}
                                    type="button"
                                    variant={field.value === type ? "default" : "outline"}
                                    className="w-full justify-start"
                                    onClick={() => {
                                      field.onChange(type);
                                      if (type !== "pallet") {
                                        form.setValue(`shipmentGroups.${groupIndex}.palletSubType`, undefined);
                                      }
                                      form.setValue(`shipmentGroups.${groupIndex}.shipments`, []);
                                      closePopup(popupKey, 'shipmentType');
                                    }}
                                  >
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                  </Button>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Pallet Sub-Type - Popup */}
                    {groupShipmentType === "pallet" && (
                      <FormField
                        control={form.control}
                        name={`shipmentGroups.${groupIndex}.palletSubType`}
                        render={({ field }) => (
                          <FormItem className="flex-shrink-0">
                            <FormLabel className="text-xs text-muted-foreground mb-1 block">Pallet Type *</FormLabel>
                            <Dialog open={openPopups[`${popupKey}_palletType`] || false} onOpenChange={(open) => {
                              if (open) {
                                setOpenPopups(prev => ({ ...prev, [`${popupKey}_palletType`]: true }));
                              } else {
                                closePopup(popupKey, 'palletType');
                              }
                            }}>
                              <DialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-[150px] justify-between"
                                  onClick={() => togglePopup(popupKey, 'palletType')}
                                >
                                  <span className="truncate">
                                    {field.value === "existing_inventory" ? "Existing Inventory" :
                                     field.value === "forwarding" ? "Pallet Forwarding" : "Select"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-1" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Select Pallet Type</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-2 py-4">
                                  <Button
                                    type="button"
                                    variant={field.value === "existing_inventory" ? "default" : "outline"}
                                    className="w-full justify-start"
                                    onClick={() => {
                                      field.onChange("existing_inventory");
                                      form.setValue(`shipmentGroups.${groupIndex}.shipments`, []);
                                      closePopup(popupKey, 'palletType');
                                    }}
                                  >
                                    Existing Inventory
                                  </Button>
                                  <Button
                                    type="button"
                                    variant={field.value === "forwarding" ? "default" : "outline"}
                                    className="w-full justify-start"
                                    onClick={() => {
                                      field.onChange("forwarding");
                                      form.setValue(`shipmentGroups.${groupIndex}.shipments`, []);
                                      closePopup(popupKey, 'palletType');
                                    }}
                                  >
                                    Pallet Forwarding
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {/* Products - Popup (FIRST) */}
                    <FormItem className="flex-shrink-0">
                      <FormLabel className="text-xs text-muted-foreground mb-1 block">Products</FormLabel>
                      <Dialog open={openPopups[`${popupKey}_products`] || false} onOpenChange={(open) => {
                        if (open) {
                          setOpenPopups(prev => ({ ...prev, [`${popupKey}_products`]: true }));
                        } else {
                          closePopup(popupKey, 'products');
                        }
                      }}>
                        <DialogTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-[160px] justify-between"
                            onClick={() => togglePopup(popupKey, 'products')}
                          >
                            <span className="truncate">
                              {groupShipments.length > 0 
                                ? `${groupShipments.length} product${groupShipments.length > 1 ? 's' : ''} selected`
                                : "Search products..."}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-1" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>Select Products</DialogTitle>
                            <DialogDescription>
                              Search and select products for this shipment
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <Input
                              placeholder="Search products..."
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                            <ScrollArea className="h-[300px]">
                              <div className="space-y-2">
                                {availableInventory.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">
                                    No products available for this shipment type.
                                  </p>
                                ) : (
                                  availableInventory.map((item) => {
                                    const isSelected = groupShipments.some((shipment) => shipment.productId === item.id);
                                    return (
                                      <div key={item.id} className="flex items-center space-x-2 p-2 hover:bg-muted rounded">
                                        <Checkbox
                                          checked={isSelected}
                                          onCheckedChange={(checked) => {
                                            const currentShipments = form.getValues(`shipmentGroups.${groupIndex}.shipments`);
                                            if (checked) {
                                              // Calculate initial price based on shipment type
                                              let initialUnitPrice = 0;
                                              let initialTotalPrice = 0;
                                              
                                              const group = form.getValues(`shipmentGroups.${groupIndex}`);
                                              const shipmentType = group?.shipmentType;
                                              const palletSubType = group?.palletSubType;
                                              
                                              if (shipmentType === "box" && boxForwardingPricing && boxForwardingPricing.length > 0) {
                                                const latestBoxPricing = [...boxForwardingPricing].sort((a, b) => {
                                                  const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
                                                  const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
                                                  return bUpdated - aUpdated;
                                                })[0];
                                                if (latestBoxPricing && latestBoxPricing.price !== undefined && latestBoxPricing.price !== null) {
                                                  const priceValue = typeof latestBoxPricing.price === 'string' 
                                                    ? parseFloat(latestBoxPricing.price) 
                                                    : latestBoxPricing.price;
                                                  if (!isNaN(priceValue) && priceValue > 0) {
                                                    initialUnitPrice = priceValue;
                                                    initialTotalPrice = priceValue; // quantity is 1 by default
                                                  }
                                                }
                                              } else if (shipmentType === "pallet") {
                                                if (palletSubType === "forwarding" && palletForwardingPricing && palletForwardingPricing.length > 0) {
                                                  const latestPalletForwarding = [...palletForwardingPricing].sort((a, b) => {
                                                    const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
                                                    const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
                                                    return bUpdated - aUpdated;
                                                  })[0];
                                                  if (latestPalletForwarding && latestPalletForwarding.price) {
                                                    const priceValue = typeof latestPalletForwarding.price === 'string' 
                                                      ? parseFloat(latestPalletForwarding.price) 
                                                      : latestPalletForwarding.price;
                                                    if (!isNaN(priceValue) && priceValue > 0) {
                                                      initialUnitPrice = priceValue;
                                                      initialTotalPrice = priceValue;
                                                    }
                                                  }
                                                } else if (palletSubType === "existing_inventory") {
                                                  // Existing Inventory pallets are priced manually by admin at approval time.
                                                  // Keep pricing at 0 as a placeholder.
                                                  initialUnitPrice = 0;
                                                  initialTotalPrice = 0;
                                                }
                                              }
                                              // Product lines default to Standard; pricing follows per-line type via useEffect
                                              if (shipmentType === "product" && group?.service && pricingRules && pricingRules.length > 0) {
                                                const calculated = calculatePrepUnitPrice(pricingRules, group.service, "Standard", 1);
                                                if (calculated?.rate != null && !Number.isNaN(calculated.rate) && calculated.rate > 0) {
                                                  initialUnitPrice = calculated.rate;
                                                  initialTotalPrice = calculated.rate;
                                                }
                                              }

                                              form.setValue(`shipmentGroups.${groupIndex}.shipments`, [
                                                ...currentShipments,
                                                {
                                                  productId: item.id,
                                                  quantity: 1,
                                                  packOf: 1,
                                                  unitPrice: initialUnitPrice,
                                                  totalPrice: initialTotalPrice,
                                                  productType: shipmentType === "product" ? ("Standard" as const) : undefined,
                                                  customDimensions: undefined,
                                                  selectedAdditionalServices: undefined,
                                                }
                                              ]);
                                            } else {
                                              const index = currentShipments.findIndex(s => s.productId === item.id);
                                              if (index !== -1) {
                                                const updated = [...currentShipments];
                                                updated.splice(index, 1);
                                                form.setValue(`shipmentGroups.${groupIndex}.shipments`, updated);
                                              }
                                            }
                                          }}
                                        />
                                        <label className="flex-1 text-sm cursor-pointer">
                                          <div className="flex flex-col">
                                            <span className="font-medium">{item.productName}</span>
                                            <span className="text-xs text-muted-foreground">
                                              SKU: {item.sku || "N/A"} | In Stock: {item.quantity}
                                            </span>
                                          </div>
                                        </label>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </ScrollArea>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => closePopup(popupKey, 'products')}
                              >
                                Done
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </FormItem>

                    {/* Service - Popup (only for product type) - After Products */}
                    {groupShipmentType === "product" && (
                      <FormField
                        control={form.control}
                        name={`shipmentGroups.${groupIndex}.service`}
                        render={({ field }) => (
                          <FormItem className="flex-shrink-0">
                            <FormLabel className="text-xs text-muted-foreground mb-1 block">Service *</FormLabel>
                            <Dialog open={openPopups[`${popupKey}_service`] || false} onOpenChange={(open) => {
                              if (open) {
                                setOpenPopups(prev => ({ ...prev, [`${popupKey}_service`]: true }));
                              } else {
                                closePopup(popupKey, 'service');
                              }
                            }}>
                              <DialogTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-[130px] justify-between"
                                  onClick={() => togglePopup(popupKey, 'service')}
                                >
                                  <span className="truncate">{field.value || "Select"}</span>
                                  <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-1" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Select Service</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-2 py-4">
                                  <Button
                                    type="button"
                                    variant={field.value === "FBA/WFS/TFS" ? "default" : "outline"}
                                    className="w-full justify-start"
                                    onClick={() => {
                                      field.onChange("FBA/WFS/TFS");
                                      closePopup(popupKey, 'service');
                                    }}
                                  >
                                    FBA/WFS/TFS
                                  </Button>
                                  <Button
                                    type="button"
                                    variant={field.value === "FBM" ? "default" : "outline"}
                                    className="w-full justify-start"
                                    onClick={() => {
                                      field.onChange("FBM");
                                      closePopup(popupKey, 'service');
                                    }}
                                  >
                                    FBM
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {/* Date */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.date`}
                      render={({ field }) => (
                        <FormItem className="flex-shrink-0">
                          <FormLabel className="text-xs text-muted-foreground mb-1 block">Shipping Date</FormLabel>
                          <DatePicker date={field.value} setDate={field.onChange} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Remarks */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.remarks`}
                      render={({ field }) => (
                        <FormItem className="flex-1 min-w-[160px]">
                          <FormLabel className="text-xs text-muted-foreground mb-1 block">Remarks (Optional)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Add any additional remarks or notes..." {...field} className="w-full min-h-[80px]" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Label Upload - Multiple files */}
                    <div className="flex-shrink-0">
                      <FormLabel className="text-xs text-muted-foreground mb-1 block">Upload Shipping Label(s) (Optional)</FormLabel>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          onChange={(e) => {
                            handleLabelSelect(groupIndex, e).catch((error) => {
                              console.error("Unhandled error in handleLabelSelect:", error);
                              toast({
                                variant: "destructive",
                                title: "Error",
                                description: "Failed to process file selection. Please try again.",
                              });
                            });
                          }}
                          className="w-[170px]"
                          disabled={labelState.isUploading || isLoading}
                        />
                        {(labelState.items?.length ?? 0) > 0 && (
                          <>
                            {labelState.items.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-1">
                                {item.preview ? (
                                  <img src={item.preview} alt="" className="h-6 w-6 rounded object-cover" />
                                ) : (
                                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                )}
                                <span className="text-xs max-w-[100px] truncate" title={item.file.name}>{item.file.name}</span>
                                {item.uploadedUrl ? (
                                  <span className="text-xs text-green-600">Uploaded</span>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0"
                                  onClick={() => handleRemoveLabel(groupIndex, itemIdx)}
                                  disabled={labelState.isUploading || isLoading}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleRemoveLabel(groupIndex)}
                              disabled={labelState.isUploading || isLoading}
                            >
                              Clear all
                            </Button>
                          </>
                        )}
                        {labelState.isUploading && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>
                      </div>
                    </div>

                  {/* Selected Products Details */}
                  {groupShipments.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <div className="text-sm font-medium mb-2">Selected Products:</div>
                      {groupShipments.map((shipment, shipmentIndex) => {
                        const product = inventory.find((item) => item.id === shipment.productId);
                        const quantity = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`) || 0;
                        const packOf = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`) || 1;
                        const totalUnits = quantity * packOf;
                        const availableStock = product?.quantity || 0;
                        const lineProductType = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.productType`);
                        const lineProductTypePopupKey = `${popupKey}_line_${shipmentIndex}_productType`;

                        return (
                          <div key={shipment.productId || shipmentIndex} className="border rounded-lg p-3 bg-muted/30">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex-1">
                                <div className="font-medium text-sm">{product?.productName}</div>
                                <div className="text-xs text-muted-foreground">In Stock: {availableStock}</div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const currentShipments = form.getValues(`shipmentGroups.${groupIndex}.shipments`);
                                  const updated = currentShipments.filter((_, i) => i !== shipmentIndex);
                                  form.setValue(`shipmentGroups.${groupIndex}.shipments`, updated);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            {groupShipmentType === "product" && (
                              <div className="mb-3 space-y-2">
                                <FormField
                                  control={form.control}
                                  name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.productType` as const}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Product type / dimension *</FormLabel>
                                      <Dialog
                                        open={openPopups[lineProductTypePopupKey] || false}
                                        onOpenChange={(open) => {
                                          setOpenPopups((prev) => ({ ...prev, [lineProductTypePopupKey]: open }));
                                        }}
                                      >
                                        <DialogTrigger asChild>
                                          <Button type="button" variant="outline" className="w-full max-w-md justify-between">
                                            <span className="truncate">
                                              {field.value === "Standard"
                                                ? "Standard (6×6×6) - <3lbs"
                                                : field.value === "Large"
                                                  ? "Large (10×10×10) - <6lbs"
                                                  : field.value === "Custom"
                                                    ? "Custom"
                                                    : "Select"}
                                            </span>
                                            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                                          </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                          <DialogHeader>
                                            <DialogTitle>Product type / dimension</DialogTitle>
                                            <DialogDescription>Applies to this line only. Submit splits requests by type.</DialogDescription>
                                          </DialogHeader>
                                          <div className="space-y-2 py-2">
                                            {(["Standard", "Large", "Custom"] as const).map((opt) => (
                                              <Button
                                                key={opt}
                                                type="button"
                                                variant={field.value === opt ? "default" : "outline"}
                                                className="w-full justify-start"
                                                onClick={() => {
                                                  field.onChange(opt);
                                                  if (opt !== "Custom") {
                                                    form.setValue(
                                                      `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.customDimensions`,
                                                      undefined
                                                    );
                                                  }
                                                  setOpenPopups((prev) => ({ ...prev, [lineProductTypePopupKey]: false }));
                                                }}
                                              >
                                                {opt === "Standard"
                                                  ? "Standard (6×6×6) - <3lbs"
                                                  : opt === "Large"
                                                    ? "Large (10×10×10) - <6lbs"
                                                    : "Custom"}
                                              </Button>
                                            ))}
                                          </div>
                                        </DialogContent>
                                      </Dialog>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                {lineProductType === "Custom" && (
                                  <FormField
                                    control={form.control}
                                    name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.customDimensions` as const}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel className="text-xs">Custom dimensions *</FormLabel>
                                        <FormControl>
                                          <Textarea
                                            placeholder="Length × width × height (in), weight (lbs), etc."
                                            className="min-h-[72px] text-sm"
                                            {...field}
                                          />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                )}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <FormField
                                control={form.control}
                                name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity` as const}
                                render={({ field }) => (
                                  <FormItem className="flex-1">
                                    <FormLabel className="text-xs">Qty</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min="1"
                                        className="h-8"
                                        {...field}
                                        onChange={(e) => {
                                          const value = parseInt(e.target.value) || 0;
                                          field.onChange(value);
                                        }}
                                      />
                                    </FormControl>
                                    {totalUnits > availableStock && (
                                      <p className="text-xs font-medium text-destructive">
                                        Insufficient stock!
                                      </p>
                                    )}
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              {groupShipmentType === "product" && (
                                <FormField
                                  control={form.control}
                                  name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf` as const}
                                  render={({ field }) => (
                                    <FormItem className="flex-1">
                                      <FormLabel className="text-xs">Pack Of</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          min="1"
                                          className="h-8"
                                          {...field}
                                          onChange={(e) => {
                                            const value = parseInt(e.target.value) || 1;
                                            field.onChange(value);
                                          }}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              )}

                              <FormField
                                control={form.control}
                                name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.totalPrice` as const}
                                render={({ field }) => {
                                  // Custom: show placeholder $1 and admin message; admin sets final pricing on approval.
                                  if (groupShipmentType === "product" && lineProductType === "Custom") {
                                    return (
                                      <FormItem className="flex-1">
                                        <FormLabel className="text-xs">Price ($)</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="text"
                                            className="h-8 [appearance:textfield]"
                                            readOnly
                                            value={"1.00"}
                                          />
                                        </FormControl>
                                        <div className="mt-2 rounded-md border-2 border-blue-200 border-dashed bg-blue-50 p-2">
                                          <p className="text-xs font-medium text-blue-700 text-center">
                                            Admin can review your request and then charge
                                          </p>
                                        </div>
                                        <FormMessage />
                                      </FormItem>
                                    );
                                  }

                                  const quantity = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`) || 0;
                                  const packOf = groupShipmentType === "product" ? (form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`) || 1) : 1;
                                  const totalUnits = quantity * packOf;
                                  let unitPrice = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice`) || 0;
                                  
                                  // Recalculate unit price if not set or if we have pricing rules
                                  // Use quantity (not totalUnits) to determine unit price
                                  // This ensures unit price stays consistent regardless of packOf value
                                  if (groupShipmentType === "product" && groupService && lineProductType && pricingRules && pricingRules.length > 0 && quantity > 0) {
                                    const calculatedPrice = calculatePrepUnitPrice(
                                      pricingRules,
                                      groupService,
                                      lineProductType,
                                      quantity // Use quantity, not totalUnits, to get consistent unit price
                                    );
                                    // Always use calculated rate if available (even if it's 0.10)
                                    if (calculatedPrice && calculatedPrice.rate !== undefined && calculatedPrice.rate !== null) {
                                      unitPrice = calculatedPrice.rate;
                                    }
                                  }
                                  
                                  // Calculate total price with pack of charge
                                  // Formula: Total = (Unit Price Ã— Quantity) + (Pack Of Price Ã— (Pack Of - 1))
                                  // The unit price is per item, and packOfPrice is charged for each pack beyond the first one
                                  let calculatedTotal = 0;
                                  if (groupShipmentType === "product" && unitPrice > 0 && quantity > 0) {
                                    const baseTotal = unitPrice * quantity; // Unit price Ã— quantity (not multiplied by packOf)
                                    let packOfPrice = 0;
                                    if (groupService && lineProductType && pricingRules && pricingRules.length > 0) {
                                      // Look up packOfPrice based on quantity only, not totalUnits
                                      // This ensures packOfPrice doesn't change when packOf changes
                                      const calculatedPriceForPackOf = calculatePrepUnitPrice(
                                        pricingRules,
                                        groupService,
                                        lineProductType,
                                        quantity // Use quantity, not totalUnits, to get the correct packOfPrice
                                      );
                                      if (calculatedPriceForPackOf) {
                                        packOfPrice = calculatedPriceForPackOf.packOf || 0; // Charge per pack (beyond the first pack)
                                      }
                                    }
                                    // Pack charge: packOfPrice Ã— (packOf - 1)
                                    // First pack is free, charge applies from 2nd pack onwards
                                    const packCharge = packOfPrice * Math.max(0, packOf - 1);
                                    calculatedTotal = parseFloat((baseTotal + packCharge).toFixed(2));
                                  } else if (unitPrice > 0 && quantity > 0) {
                                    calculatedTotal = parseFloat((unitPrice * quantity).toFixed(2));
                                  }
                                  
                                  // Always show calculated total if available, otherwise show field value
                                  const displayValue = calculatedTotal > 0 ? calculatedTotal : (field.value || 0);
                                  // Format to always show 2 decimal places (e.g., 0.10 instead of 0.1)
                                  const formattedValue = typeof displayValue === 'number' ? displayValue.toFixed(2) : parseFloat(displayValue || 0).toFixed(2);
                                  
                                  return (
                                    <FormItem className="flex-1">
                                      <FormLabel className="text-xs">Price ($)</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="text"
                                          placeholder="Auto"
                                          className="h-8 [appearance:textfield]"
                                          readOnly
                                          value={formattedValue}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }}
                              />
                              {/* Hidden unitPrice field: required by schema even though we don't show it in the UI */}
                              <FormField
                                control={form.control}
                                name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice` as const}
                                render={({ field }) => (
                                  <input type="hidden" {...field} value={field.value ?? ""} />
                                )}
                              />
                            </div>
                            
                            {/* Additional Services - Per Product */}
                            <div className="mt-3 pt-3 border-t">
                              <FormField
                                control={form.control}
                                name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.selectedAdditionalServices` as const}
                                render={({ field }) => {
                                  const selectedServices = field.value || [];
                                  const hasBubbleWrap = selectedServices.includes("bubbleWrap");
                                  const hasStickerRemoval = selectedServices.includes("stickerRemoval");
                                  const hasWarningLabels = selectedServices.includes("warningLabels");
                                  const selectedServicesDisplay: string[] = [];
                                  if (hasBubbleWrap) selectedServicesDisplay.push("Bubble Wrap");
                                  if (hasStickerRemoval) selectedServicesDisplay.push("Sticker Removal");
                                  if (hasWarningLabels) selectedServicesDisplay.push("Warning Labels");
                                  const displayText = selectedServicesDisplay.length > 0 
                                    ? selectedServicesDisplay.join(", ")
                                    : "Select (optional)";
                                  const productPopupKey = `${popupKey}_product_${shipmentIndex}_additionalServices`;

                                  return (
                                    <FormItem>
                                      <FormLabel className="text-xs font-medium">Additional Services (Optional)</FormLabel>
                                      <Dialog
                                        open={openPopups[productPopupKey] || false}
                                        onOpenChange={(open) => {
                                          if (open) {
                                            setOpenPopups(prev => ({ ...prev, [productPopupKey]: true }));
                                          } else {
                                            setOpenPopups(prev => ({ ...prev, [productPopupKey]: false }));
                                          }
                                        }}
                                      >
                                        <DialogTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full justify-between"
                                            onClick={() => {
                                              setOpenPopups(prev => ({ ...prev, [productPopupKey]: !prev[productPopupKey] }));
                                            }}
                                          >
                                            <span className="truncate">
                                              {displayText}
                                            </span>
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                          </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                          <DialogHeader>
                                            <DialogTitle>Additional Services for {product?.productName}</DialogTitle>
                                            <DialogDescription>
                                              Select which additional services you need for this product. Admin will add quantities and calculate pricing during approval.
                                            </DialogDescription>
                                          </DialogHeader>
                                          <div className="space-y-4 py-2">
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                              <FormControl>
                                                <Checkbox
                                                  checked={hasBubbleWrap}
                                                  onCheckedChange={(checked) => {
                                                    const current = field.value || [];
                                                    if (checked) {
                                                      field.onChange([...current, "bubbleWrap"]);
                                                    } else {
                                                      field.onChange(current.filter(s => s !== "bubbleWrap"));
                                                    }
                                                  }}
                                                />
                                              </FormControl>
                                              <div className="space-y-1 leading-none">
                                                <FormLabel>Bubble Wrap</FormLabel>
                                                <p className="text-xs text-muted-foreground">
                                                  Admin will add quantity (feet) during approval
                                                </p>
                                              </div>
                                            </FormItem>
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                              <FormControl>
                                                <Checkbox
                                                  checked={hasStickerRemoval}
                                                  onCheckedChange={(checked) => {
                                                    const current = field.value || [];
                                                    if (checked) {
                                                      field.onChange([...current, "stickerRemoval"]);
                                                    } else {
                                                      field.onChange(current.filter(s => s !== "stickerRemoval"));
                                                    }
                                                  }}
                                                />
                                              </FormControl>
                                              <div className="space-y-1 leading-none">
                                                <FormLabel>Sticker Removal</FormLabel>
                                                <p className="text-xs text-muted-foreground">
                                                  Admin will add quantity (items) during approval
                                                </p>
                                              </div>
                                            </FormItem>
                                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                              <FormControl>
                                                <Checkbox
                                                  checked={hasWarningLabels}
                                                  onCheckedChange={(checked) => {
                                                    const current = field.value || [];
                                                    if (checked) {
                                                      field.onChange([...current, "warningLabels"]);
                                                    } else {
                                                      field.onChange(current.filter(s => s !== "warningLabels"));
                                                    }
                                                  }}
                                                />
                                              </FormControl>
                                              <div className="space-y-1 leading-none">
                                                <FormLabel>Warning Labels</FormLabel>
                                                <p className="text-xs text-muted-foreground">
                                                  Admin will add quantity (count) during approval
                                                </p>
                                              </div>
                                            </FormItem>
                                            <div className="flex justify-end gap-2 pt-2">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => {
                                                  field.onChange([]);
                                                  setOpenPopups(prev => ({ ...prev, [productPopupKey]: false }));
                                                }}
                                              >
                                                Clear All
                                              </Button>
                                              <Button type="button" onClick={() => setOpenPopups(prev => ({ ...prev, [productPopupKey]: false }))}>
                                                Done
                                              </Button>
                                            </div>
                                          </div>
                                        </DialogContent>
                                      </Dialog>
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
          </Accordion>

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={isLoading || shipmentGroups.length === 0}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit All Shipment Requests
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

