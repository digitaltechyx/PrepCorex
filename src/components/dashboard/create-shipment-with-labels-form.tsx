"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import { collection, doc, Timestamp, writeBatch } from "firebase/firestore";
import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X, Plus, ChevronDown, Upload } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import type { InventoryItem, ServiceType, ProductType, UserProfile } from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUserPricingCollections } from "@/hooks/use-user-pricing-collections";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
import { catalogFromPricingDoc } from "@/lib/additional-services-catalog";
import imageCompression from "browser-image-compression";
import { ImageIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { OutboundBulkImportDialog } from "@/components/dashboard/outbound-bulk-import-dialog";

const shipmentItemSchema = z.object({
  productId: z.string().min(1, "Select a product."),
  quantity: z.coerce.number().int().positive("Shipped quantity must be a positive number."),
  packOf: z.coerce.number().int().positive("Pack size must be a positive number."),
  // Custom products use placeholder pricing until admin sets final pricing.
  unitPrice: z.coerce.number().nonnegative("Unit price must be a non-negative number."),
  totalPrice: z.coerce.number().nonnegative("Total price must be a non-negative number."),
  // Per-line type/details (product shipments only; validated in group superRefine)
  productType: z.enum(["Standard", "Custom"]).optional(),
  customDimensions: z.string().optional(),
  // Additional Services per product - user only selects which services they want (boolean flags)
  // Admin will add quantities during approval
  selectedAdditionalServices: z.array(z.string()).optional(),
});

const shipmentGroupSchema = z.object({
  shipmentType: z.enum(["product", "box", "pallet"], { required_error: "Shipment type is required." }),
  palletSubType: z.enum(["existing_inventory", "forwarding"]).optional(),
  shipments: z.array(shipmentItemSchema).min(1, "Select at least one item to ship."),
  date: z.date({ required_error: "A shipping date is required." }),
  shipmentPreference: z.enum(["box", "pallet"], {
    required_error: "Select box or pallet shipment preference.",
  }),
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
      if (s.productType && s.productType !== "Custom") {
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
  targetUserProfile?: Pick<UserProfile, "uid" | "pricingProfileId">;
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
  targetUserProfile,
}: CreateShipmentWithLabelsFormProps) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const ownerId = targetUserId ?? user?.uid ?? "";
  const ownerDisplayName =
    (targetUserName ?? userProfile?.name ?? "").trim() || "Unknown User";

  const pricingUser = useMemo(() => {
    if (!ownerId) return null;
    if (targetUserProfile?.uid === ownerId) return targetUserProfile;
    if (userProfile?.uid === ownerId) return userProfile;
    return { uid: ownerId, pricingProfileId: targetUserProfile?.pricingProfileId };
  }, [ownerId, targetUserProfile, userProfile]);

  const {
    pricingRules: effectivePricingRules,
    boxForwardingPricing: effectiveBoxForwardingPricing,
    palletForwardingPricing: effectivePalletForwardingPricing,
    additionalServicesPricing: effectiveAdditionalServicesPricing,
  } = useUserPricingCollections(pricingUser);

  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  
  // Label upload states for each shipment group
  // Stored per shipment line: `${groupIndex}_${shipmentIndex}`
  const [labelStates, setLabelStates] = useState<Record<string, LabelUploadState>>({});

  const getLineKey = (groupIndex: number, shipmentIndex: number) => `${groupIndex}_${shipmentIndex}`;
  
  // Popup states for each group
  const [openPopups, setOpenPopups] = useState<Record<string, boolean>>({});
  
  // Accordion state - only one shipment open at a time
  const [openAccordionValue, setOpenAccordionValue] = useState<string | undefined>(undefined);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  
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

  const latestAdditionalServicesPricingDoc = useMemo(() => {
    if (!effectiveAdditionalServicesPricing || effectiveAdditionalServicesPricing.length === 0) return null;
    const sorted = [...effectiveAdditionalServicesPricing].sort((a, b) => {
      const aUpdated =
        typeof a.updatedAt === "string"
          ? new Date(a.updatedAt).getTime()
          : (a.updatedAt as any)?.seconds
            ? (a.updatedAt as any).seconds * 1000
            : 0;
      const bUpdated =
        typeof b.updatedAt === "string"
          ? new Date(b.updatedAt).getTime()
          : (b.updatedAt as any)?.seconds
            ? (b.updatedAt as any).seconds * 1000
            : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0] ?? null;
  }, [effectiveAdditionalServicesPricing]);

  const additionalServicesCatalog = useMemo(
    () => catalogFromPricingDoc(latestAdditionalServicesPricingDoc as UserAdditionalServicesPricing | null),
    [latestAdditionalServicesPricingDoc]
  );

  // Auto-calculate pricing for all shipment groups
  const watchedGroups = useWatch({
    control: form.control,
    name: "shipmentGroups",
  });
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
        } else if (shipmentType === "product" && service && lineProductType && effectivePricingRules && effectivePricingRules.length > 0) {
          // Use quantity (not totalUnits) to determine unit price
          // This ensures unit price stays consistent regardless of packOf value
          const calculatedPrice = calculatePrepUnitPrice(
            effectivePricingRules,
            service,
            lineProductType,
            quantity
          );
          if (calculatedPrice && calculatedPrice.rate !== undefined && calculatedPrice.rate !== null) {
            finalUnitPrice = calculatedPrice.rate;
          }
        } else if (shipmentType === "box") {
          if (effectiveBoxForwardingPricing && effectiveBoxForwardingPricing.length > 0) {
            const latestBoxPricing = [...effectiveBoxForwardingPricing].sort((a, b) => {
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
            if (effectivePalletForwardingPricing && effectivePalletForwardingPricing.length > 0) {
              const latestPalletForwarding = [...effectivePalletForwardingPricing].sort((a, b) => {
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
          calculatedTotal = parseFloat((finalUnitPrice * quantity).toFixed(2));
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
  }, [watchedGroups, effectivePricingRules, effectiveBoxForwardingPricing, effectivePalletForwardingPricing, form]);

  // Initialize label state when a new group is added
  const handleAddShipmentGroup = () => {
    const newIndex = shipmentGroups.length;
    appendGroup({
      shipmentType: "product",
      palletSubType: undefined,
      shipments: [],
      date: new Date(),
      shipmentPreference: undefined,
      remarks: undefined,
      service: "FBA/WFS/TFS",
    });
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

  const handleLabelSelect = async (lineKey: string, event: React.ChangeEvent<HTMLInputElement>) => {
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
        [lineKey]: {
          ...prev[lineKey],
          items: [...(prev[lineKey]?.items ?? []), ...newItems],
          isUploading: prev[lineKey]?.isUploading ?? false,
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

  const uploadOneLabel = async (lineKey: string, itemIndex: number, file: File): Promise<string | null> => {
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
      const items = [...(prev[lineKey]?.items ?? [])];
      if (items[itemIndex]) items[itemIndex] = { ...items[itemIndex], uploadedUrl: urlToStore };
      return { ...prev, [lineKey]: { ...prev[lineKey], items, isUploading: prev[lineKey]?.isUploading ?? false } };
    });
    return urlToStore;
  };

  const handleLabelUpload = async (lineKey: string): Promise<string[]> => {
    const labelState = labelStates[lineKey];
    const items = labelState?.items ?? [];
    const pending = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => !item.uploadedUrl && item.file);
    if (pending.length === 0) {
      return items.map((i) => i.uploadedUrl).filter(Boolean) as string[];
    }
    try {
      setLabelStates(prev => ({ ...prev, [lineKey]: { items: prev[lineKey]?.items ?? [], isUploading: true } }));
      const urls: string[] = [];
      for (const { item, idx } of pending) {
        if (!item.file) continue;
        const url = await uploadOneLabel(lineKey, idx, item.file);
        if (url) urls.push(url);
      }
      const allUrls = [...items.map((i) => i.uploadedUrl).filter(Boolean), ...urls] as string[];
      if (urls.length > 0) {
        toast({
          title: "Success",
          description: urls.length === 1 ? "Label uploaded successfully!" : `${urls.length} labels uploaded successfully!`,
        });
      }
      setLabelStates(prev => ({
        ...prev,
        [lineKey]: {
          items: prev[lineKey]?.items ?? [],
          isUploading: false,
        }
      }));
      return allUrls;
    } catch (error: any) {
      console.error("Error uploading label:", error);
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message || "Label upload failed. Please try again.",
      });
      setLabelStates(prev => ({ ...prev, [lineKey]: { ...prev[lineKey], isUploading: false } }));
      return items.map((i) => i.uploadedUrl).filter(Boolean) as string[];
    }
  };

  const handleRemoveLabel = (lineKey: string, itemIndex?: number) => {
    setLabelStates(prev => {
      const state = prev[lineKey];
      const items = state?.items ?? [];
      if (itemIndex !== undefined) {
        const item = items[itemIndex];
        if (item?.preview) URL.revokeObjectURL(item.preview);
        const newItems = items.filter((_, i) => i !== itemIndex);
        return { ...prev, [lineKey]: { items: newItems, isUploading: false } };
      }
      items.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
      return { ...prev, [lineKey]: { items: [], isUploading: false } };
    });
  };

  const handleRemoveGroup = (index: number) => {
    removeGroup(index);
    setLabelStates(prev => {
      const next: Record<string, LabelUploadState> = {};
      for (const [key, state] of Object.entries(prev)) {
        const [gStr, sStr] = key.split("_");
        const g = Number(gStr);
        const s = Number(sStr);
        if (!Number.isFinite(g) || !Number.isFinite(s)) continue;
        if (g === index) {
          state.items.forEach((it) => {
            if (it.preview) URL.revokeObjectURL(it.preview);
          });
          continue;
        }
        const newG = g > index ? g - 1 : g;
        next[`${newG}_${s}`] = state;
      }
      return next;
    });
  };

  const handleRemoveShipmentLine = (groupIndex: number, shipmentIndex: number) => {
    const removeKey = getLineKey(groupIndex, shipmentIndex);
    setLabelStates(prev => {
      const next: Record<string, LabelUploadState> = {};
      for (const [key, state] of Object.entries(prev)) {
        const [gStr, sStr] = key.split("_");
        const g = Number(gStr);
        const s = Number(sStr);
        if (!Number.isFinite(g) || !Number.isFinite(s)) continue;
        if (g !== groupIndex) {
          next[key] = state;
          continue;
        }
        if (key === removeKey) {
          state.items.forEach((it) => {
            if (it.preview) URL.revokeObjectURL(it.preview);
          });
          continue;
        }
        if (s > shipmentIndex) {
          next[getLineKey(groupIndex, s - 1)] = state;
        } else {
          next[key] = state;
        }
      }
      return next;
    });
  };

  const clearLabelStatesForGroup = (groupIndex: number) => {
    const prefix = `${groupIndex}_`;
    setLabelStates(prev => {
      const next: Record<string, LabelUploadState> = {};
      for (const [key, state] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) {
          next[key] = state;
          continue;
        }
        state.items.forEach((it) => {
          if (it.preview) URL.revokeObjectURL(it.preview);
        });
      }
      return next;
    });
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
        description: "You must be logged in to create outbound shipment requests.",
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

        const uploadLabelsForShipmentIndices = async (shipmentIndices: number[]) => {
          const urls: string[] = [];
          for (const shipmentIndex of shipmentIndices) {
            const lineKey = getLineKey(i, shipmentIndex);
            const lineUrls = await handleLabelUpload(lineKey);
            urls.push(...lineUrls);
          }
          return urls;
        };

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

        const writeOneRequest = async (
          shipmentsSlice: typeof group.shipments,
          shipmentIndices: number[],
          productType?: ProductType,
          customDimensions?: string
        ) => {
          const labelUrls = await uploadLabelsForShipmentIndices(shipmentIndices);
          const labelUrl = labelUrls.join(",");
          const requestRef = doc(collection(db, `users/${ownerId}/shipmentRequests`));
          const requestData: any = {
            userId: ownerId,
            userName: ownerDisplayName,
            date: dateTimestamp,
            remarks: group.remarks || undefined,
            shipmentType: group.shipmentType,
            shipmentPreference: group.shipmentPreference,
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
            {
              productType: ProductType;
              customDimensions?: string;
              rows: typeof group.shipments;
              shipmentIndices: number[];
            }
          >();
          group.shipments.forEach((row, shipmentIndex) => {
            const pt = row.productType;
            if (!pt) return;
            const key = `${pt}||${(row.customDimensions || "").trim()}`;
            const existing = buckets.get(key);
            if (existing) {
              existing.rows.push(row);
              existing.shipmentIndices.push(shipmentIndex);
            } else {
              buckets.set(key, {
                productType: pt,
                customDimensions: pt === "Custom" ? row.customDimensions : undefined,
                rows: [row],
                shipmentIndices: [shipmentIndex],
              });
            }
          });
          for (const b of buckets.values()) {
            await writeOneRequest(b.rows, b.shipmentIndices, b.productType, b.customDimensions);
          }
        } else {
          const shipmentIndices = group.shipments.map((_, idx) => idx);
          await writeOneRequest(group.shipments, shipmentIndices);
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
            For same day fulfillment please create outbound shipment before 11 am EST.
          </p>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalidSubmit)} className="space-y-6">
          {/* Add Shipment Button */}
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Create Outbound Shipment</h3>
              <p className="text-sm text-muted-foreground">Create multiple shipments, each with its own label</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkImportOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
              <Button
                type="button"
                onClick={handleAddShipmentGroup}
                variant="outline"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Shipment
              </Button>
            </div>
          </div>

          <OutboundBulkImportDialog
            open={bulkImportOpen}
            onOpenChange={setBulkImportOpen}
            ownerId={ownerId}
            ownerDisplayName={ownerDisplayName}
            inventory={inventory}
          />

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
            const groupTotal = (groupShipments || []).reduce(
              (sum: number, s: any) => sum + (Number(s?.totalPrice) || 0),
              0
            );
            
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
            const popupKey = group.id;

            return (
              <AccordionItem key={group.id} value={`shipment-${groupIndex}`} className="border-2 rounded-lg px-4 mb-4">
                <div className="relative">
                  <AccordionTrigger className="hover:no-underline pr-12 [&>svg]:hidden">
                    <div className="flex items-center justify-between w-full gap-3">
                      <div className="text-left">
                        <div className="text-sm font-semibold">
                          Shipment {groupIndex + 1}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            ({groupShipments.length} product{groupShipments.length === 1 ? "" : "s"})
                          </span>
                        </div>
                      </div>
                      <div className="mr-6 shrink-0 rounded-md bg-primary/10 px-3 py-1 text-sm font-semibold tabular-nums text-primary">
                        ${groupTotal.toFixed(2)}
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
                  <div className="pt-3">
                    <div className="border-b pb-2">
                      <div className="mouse-h-scroll pb-2">
                        <div className="min-w-[1050px] space-y-2">
                          <div className="flex flex-nowrap items-start gap-2">
                    {/* Service */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.service`}
                      render={({ field }) => (
                          <FormItem className="order-1 w-[150px] shrink-0 space-y-1">
                            <FormLabel className="text-[11px] text-muted-foreground">Service *</FormLabel>
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
                                  className="h-8 w-full justify-between"
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

                    {/* Select Product */}
                    <FormItem className="order-2 w-[290px] shrink-0 space-y-1">
                      <FormLabel className="text-[11px] text-muted-foreground">Select Product</FormLabel>
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
                            className="h-8 w-full justify-between"
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
                        <DialogContent className="max-h-[85vh] max-w-6xl overflow-hidden">
                          <DialogHeader>
                            <DialogTitle>Select Products And Fill Details</DialogTitle>
                            <DialogDescription>
                              Select products, update line details, and remove rows from one place.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="mouse-both-scroll max-h-[70vh] space-y-4 py-4 pr-2">
                            <Input
                              placeholder="Search products..."
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                            <ScrollArea className="h-[220px] rounded-md border p-2">
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
                                              
                                              if (shipmentType === "box" && effectiveBoxForwardingPricing && effectiveBoxForwardingPricing.length > 0) {
                                                const latestBoxPricing = [...effectiveBoxForwardingPricing].sort((a, b) => {
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
                                                if (palletSubType === "forwarding" && effectivePalletForwardingPricing && effectivePalletForwardingPricing.length > 0) {
                                                  const latestPalletForwarding = [...effectivePalletForwardingPricing].sort((a, b) => {
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
                                              if (shipmentType === "product" && group?.service && effectivePricingRules && effectivePricingRules.length > 0) {
                                                const calculated = calculatePrepUnitPrice(effectivePricingRules, group.service, "Standard", 1);
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

                            <div className="space-y-2">
                              <div className="text-sm font-medium">Selected Product Details</div>
                              <div className="mouse-both-scroll max-h-[44vh] rounded-md border">
                                <div className="min-w-[1100px]">
                                  <div className="grid grid-cols-[220px_90px_90px_120px_250px_180px_120px] gap-2 border-b bg-muted/30 px-2 py-2 text-[11px] font-medium text-muted-foreground">
                                    <div>Product</div>
                                    <div>Qty</div>
                                    <div>Pack</div>
                                    <div>Price ($)</div>
                                    <div>Additional Services</div>
                                    <div>Labels</div>
                                    <div>Remove</div>
                                  </div>
                                  {groupShipments.length === 0 ? (
                                    <div className="px-2 py-4 text-xs text-muted-foreground">
                                      No products selected yet.
                                    </div>
                                  ) : (
                                    groupShipments.map((shipment, shipmentIndex) => {
                                      const selectedProduct = inventory.find((item) => item.id === shipment.productId);
                                      const lineKey = getLineKey(groupIndex, shipmentIndex);
                                      const lineLabelState = labelStates[lineKey] || { items: [], isUploading: false };
                                      const selectedServices =
                                        form.watch(
                                          `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.selectedAdditionalServices`
                                        ) || [];
                                      const labelForServiceKey = (key: string) =>
                                        additionalServicesCatalog.find((r) => r.key === key)?.name ?? key;
                                      const selectedServicesDisplay = selectedServices.map(labelForServiceKey);
                                      const servicesPopupKey = `${popupKey}_line_${shipmentIndex}_additionalServicesInline`;
                                      const updateServices = (key: string, checked: boolean) => {
                                        const current =
                                          form.getValues(
                                            `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.selectedAdditionalServices`
                                          ) || [];
                                        const next = checked
                                          ? Array.from(new Set([...current, key]))
                                          : current.filter((s: string) => s !== key);
                                        form.setValue(
                                          `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.selectedAdditionalServices`,
                                          next,
                                          { shouldValidate: true }
                                        );
                                      };

                                      return (
                                        <div
                                          key={shipment.productId || shipmentIndex}
                                          className="grid grid-cols-[220px_90px_90px_120px_250px_180px_120px] gap-2 border-b px-2 py-2"
                                        >
                                          <div className="truncate text-xs font-medium">
                                            {selectedProduct?.productName || "Unknown"}
                                          </div>
                                          <Input
                                            type="number"
                                            min="1"
                                            className="h-8"
                                            value={form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`) || 1}
                                            onChange={(e) => {
                                              const value = Math.max(1, parseInt(e.target.value || "1", 10) || 1);
                                              form.setValue(
                                                `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`,
                                                value,
                                                { shouldValidate: true }
                                              );
                                            }}
                                          />
                                          <Input
                                            type="number"
                                            min="1"
                                            className="h-8"
                                            value={form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`) || 1}
                                            onChange={(e) => {
                                              const value = Math.max(1, parseInt(e.target.value || "1", 10) || 1);
                                              form.setValue(
                                                `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`,
                                                value,
                                                { shouldValidate: true }
                                              );
                                            }}
                                            disabled={groupShipmentType !== "product"}
                                          />
                                          <Input
                                            className="h-8"
                                            value={Number(
                                              form.watch(
                                                `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.totalPrice`
                                              ) || 0
                                            ).toFixed(2)}
                                            readOnly
                                          />
                                          <Dialog
                                            open={openPopups[servicesPopupKey] || false}
                                            onOpenChange={(open) =>
                                              setOpenPopups((prev) => ({ ...prev, [servicesPopupKey]: open }))
                                            }
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8 w-full justify-between text-xs"
                                              >
                                                <span className="truncate">
                                                  {selectedServicesDisplay.length > 0
                                                    ? selectedServicesDisplay.join(", ")
                                                    : "Select additional services"}
                                                </span>
                                                <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-md">
                                              <DialogHeader>
                                                <DialogTitle>Additional Services</DialogTitle>
                                                <DialogDescription>
                                                  Choose all additional services needed for this selected product.
                                                </DialogDescription>
                                              </DialogHeader>
                                              <div className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto py-1 pr-1">
                                                {additionalServicesCatalog.map((svc) => {
                                                  const checked = selectedServices.includes(svc.key);
                                                  return (
                                                    <label key={svc.key} className="flex items-start gap-2 text-sm">
                                                      <Checkbox
                                                        checked={checked}
                                                        onCheckedChange={(c) => updateServices(svc.key, Boolean(c))}
                                                      />
                                                      <span>
                                                        <span className="font-medium">{svc.name}</span>
                                                        <span className="block text-xs text-muted-foreground">
                                                          {svc.description ||
                                                            "Admin enters quantity when completing this request."}
                                                        </span>
                                                        <span className="block text-xs text-muted-foreground">
                                                          Rate: ${Number(svc.price || 0).toFixed(2)}
                                                        </span>
                                                      </span>
                                                    </label>
                                                  );
                                                })}
                                              </div>
                                            </DialogContent>
                                          </Dialog>
                                          <div className="space-y-1">
                                            <Input
                                              type="file"
                                              accept="image/*,application/pdf"
                                              multiple
                                              className="h-8 text-[11px]"
                                              disabled={lineLabelState.isUploading || isLoading}
                                              onChange={(e) => {
                                                handleLabelSelect(lineKey, e).catch((error) => {
                                                  console.error("Unhandled error in handleLabelSelect:", error);
                                                  toast({
                                                    variant: "destructive",
                                                    title: "Error",
                                                    description: "Failed to process file selection. Please try again.",
                                                  });
                                                });
                                              }}
                                            />
                                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                              <span>{lineLabelState.items?.length ?? 0} file(s)</span>
                                              {(lineLabelState.items?.length ?? 0) > 0 && (
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-6 px-2 text-[11px]"
                                                  onClick={() => handleRemoveLabel(lineKey)}
                                                  disabled={lineLabelState.isUploading || isLoading}
                                                >
                                                  Clear
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-destructive hover:text-destructive"
                                            onClick={() => {
                                              handleRemoveShipmentLine(groupIndex, shipmentIndex);
                                              const currentShipments = form.getValues(
                                                `shipmentGroups.${groupIndex}.shipments`
                                              );
                                              const updated = currentShipments.filter((_, i) => i !== shipmentIndex);
                                              form.setValue(`shipmentGroups.${groupIndex}.shipments`, updated);
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => closePopup(popupKey, 'products')}
                              >
                                Save and Close
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </FormItem>

                    {/* Date */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.date`}
                      render={({ field }) => (
                        <FormItem className="order-3 w-[170px] shrink-0 space-y-1">
                          <FormLabel className="text-[11px] text-muted-foreground">Shipping Date</FormLabel>
                          <div className="w-full">
                            <DatePicker date={field.value} setDate={field.onChange} />
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Shipment Preference */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.shipmentPreference`}
                      render={({ field }) => (
                        <FormItem className="order-4 w-[150px] shrink-0 space-y-1">
                          <FormLabel className="text-[11px] text-muted-foreground">Shipment Preference *</FormLabel>
                          <Dialog
                            open={openPopups[`${popupKey}_shipmentPreference`] || false}
                            onOpenChange={(open) => {
                              if (open) {
                                setOpenPopups((prev) => ({ ...prev, [`${popupKey}_shipmentPreference`]: true }));
                              } else {
                                closePopup(popupKey, "shipmentPreference");
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 w-full justify-between"
                                onClick={() => togglePopup(popupKey, "shipmentPreference")}
                              >
                                <span className="truncate capitalize">{field.value || "Select"}</span>
                                <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-1" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Shipment Preference</DialogTitle>
                                <DialogDescription>
                                  How should this outbound shipment be packed for fulfillment?
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-2 py-4">
                                {(["box", "pallet"] as const).map((pref) => (
                                  <Button
                                    key={pref}
                                    type="button"
                                    variant={field.value === pref ? "default" : "outline"}
                                    className="w-full justify-start capitalize"
                                    onClick={() => {
                                      field.onChange(pref);
                                      closePopup(popupKey, "shipmentPreference");
                                    }}
                                  >
                                    {pref}
                                  </Button>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Remarks */}
                    <FormField
                      control={form.control}
                      name={`shipmentGroups.${groupIndex}.remarks`}
                      render={({ field }) => (
                        <FormItem className="order-5 w-[260px] shrink-0 space-y-1">
                          <FormLabel className="text-[11px] text-muted-foreground flex items-center gap-1">
                            Remarks (Optional)
                            <span
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground"
                              title="Add handling notes for admin. For Custom items, mention any missing size/weight details here."
                            >
                              ?
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Remarks (optional)" {...field} className="h-8 w-full" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                          </div>

                          <div className="rounded-md border bg-muted/20 px-2 py-1">
                            <div className="flex min-w-max items-center gap-1">
                              {groupShipments.length > 0 ? (
                                groupShipments.map((shipment, shipmentIndex) => {
                                  const summaryProduct = inventory.find((item) => item.id === shipment.productId);
                                  const lineEditorPopupKey = `${popupKey}_line_${shipmentIndex}_editor`;
                                  return (
                                    <Button
                                      key={shipment.productId || shipmentIndex}
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 shrink-0 px-2 text-xs"
                                      onClick={() =>
                                        setOpenPopups((prev) => ({
                                          ...prev,
                                          [lineEditorPopupKey]: true,
                                        }))
                                      }
                                    >
                                      {summaryProduct?.productName || "Line item"}
                                    </Button>
                                  );
                                })
                              ) : (
                                <span className="px-1 text-[11px] text-muted-foreground">
                                  No products selected
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  {/* Selected Products Details */}
                  {groupShipments.length > 0 ? (
                    <div className="hidden">
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Selected Products (single-line view)</div>
                      <div className="overflow-x-scroll">
                        <div className="flex min-w-max items-center gap-2 pb-1">
                      {groupShipments.map((shipment, shipmentIndex) => {
                        const product = inventory.find((item) => item.id === shipment.productId);
                        const quantity = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`) || 0;
                        const packOf = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`) || 1;
                        const totalUnits = quantity * packOf;
                        const availableStock = product?.quantity || 0;
                        const lineProductType = form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.productType`);
                        const lineProductTypePopupKey = `${popupKey}_line_${shipmentIndex}_productType`;
                        const lineEditorPopupKey = `${popupKey}_line_${shipmentIndex}_editor`;
                        const lineKey = getLineKey(groupIndex, shipmentIndex);
                        const lineLabelState = labelStates[lineKey] || { items: [], isUploading: false };
                        const lineLabelsCount = lineLabelState.items?.length ?? 0;
                        const lineServicesCount = shipment.selectedAdditionalServices?.length ?? 0;
                        const linePrice = Number(shipment.totalPrice || 0);

                        return (
                          <div
                            key={shipment.productId || shipmentIndex}
                            className="shrink-0 rounded-md border bg-muted/20 px-2 py-1"
                          >
                            <div className="mouse-h-scroll">
                              <div className="flex min-w-max items-center gap-3">
                                <div className="min-w-[180px] shrink-0 text-xs font-medium text-foreground">
                                  {product?.productName}
                                </div>
                                <div className="min-w-[120px] shrink-0 text-xs text-muted-foreground">
                                  Stock: <span className="font-medium text-foreground">{availableStock}</span>
                                </div>
                                <div className="min-w-[180px] shrink-0 text-xs text-muted-foreground">
                                  Type: <span className="font-medium text-foreground">{lineProductType || "N/A"}</span>
                                </div>
                                <div className="min-w-[100px] shrink-0 text-xs text-muted-foreground">
                                  Qty: <span className="font-medium text-foreground">{quantity}</span>
                                </div>
                                {groupShipmentType === "product" && (
                                  <div className="min-w-[110px] shrink-0 text-xs text-muted-foreground">
                                    Pack: <span className="font-medium text-foreground">{packOf}</span>
                                  </div>
                                )}
                                <div className="min-w-[120px] shrink-0 text-xs text-muted-foreground">
                                  Units: <span className="font-medium text-foreground">{totalUnits}</span>
                                </div>
                                <div className="min-w-[130px] shrink-0 text-xs text-muted-foreground">
                                  Price: <span className="font-medium text-foreground">${linePrice.toFixed(2)}</span>
                                </div>
                                <div className="min-w-[130px] shrink-0 text-xs text-muted-foreground">
                                  Labels: <span className="font-medium text-foreground">{lineLabelsCount}</span>
                                </div>
                                <div className="min-w-[140px] shrink-0 text-xs text-muted-foreground">
                                  Services: <span className="font-medium text-foreground">{lineServicesCount}</span>
                                </div>
                                <Dialog
                                  open={openPopups[lineEditorPopupKey] || false}
                                  onOpenChange={(open) => {
                                    setOpenPopups((prev) => ({ ...prev, [lineEditorPopupKey]: open }));
                                  }}
                                >
                                  <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="sm" className="shrink-0">
                                      Edit line details
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-5xl">
                                    <DialogHeader>
                                      <DialogTitle>Line details - {product?.productName}</DialogTitle>
                                      <DialogDescription>
                                        Update quantity, pricing details, labels, and additional services for this line.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <div className="mouse-h-scroll">
                                      <div className="flex min-w-max items-end gap-2 pb-1">
                                {groupShipmentType === "product" && (
                                  <>
                                    <FormField
                                      control={form.control}
                                      name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.productType` as const}
                                      render={({ field }) => (
                                        <FormItem className="w-[320px] shrink-0">
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
                                                    : field.value === "Custom"
                                                      ? "Custom"
                                                      : "Select"}
                                                </span>
                                                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                              <DialogHeader>
                                                <DialogTitle>Product type / dimension</DialogTitle>
                                                <DialogDescription>
                                                  Applies to this line only. Submit splits requests by type.
                                                </DialogDescription>
                                              </DialogHeader>
                                              <div className="space-y-2 py-2">
                                                {(["Standard", "Custom"] as const).map((opt) => (
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
                                                      setOpenPopups((prev) => ({
                                                        ...prev,
                                                        [lineProductTypePopupKey]: false,
                                                      }));
                                                    }}
                                                  >
                                                    {opt === "Standard"
                                                      ? "Standard (6×6×6) - <3lbs"
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
                                          <FormItem className="w-[280px] shrink-0">
                                            <FormLabel className="text-xs flex items-center gap-1">
                                              Custom dimensions (Optional)
                                              <span
                                                className="inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold text-muted-foreground"
                                                title="If dimensions are unknown or approximate, submit anyway. Admin will correct dimensions, set pricing, and guide next step."
                                              >
                                                ?
                                              </span>
                                            </FormLabel>
                                            <FormControl>
                                              <Textarea
                                                placeholder="Length × width × height (in), weight (lbs), etc."
                                                className="min-h-[72px] text-sm"
                                                {...field}
                                              />
                                            </FormControl>
                                            <FormDescription className="text-[10px]">
                                              If unknown, leave blank. Admin can review and add dimensions before final charge.
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    )}
                                  </>
                                )}

                                <FormField
                                  control={form.control}
                                  name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity` as const}
                                  render={({ field }) => (
                                    <FormItem className="w-[120px] shrink-0">
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
                                        <p className="text-xs font-medium text-destructive">Insufficient stock!</p>
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
                                      <FormItem className="w-[120px] shrink-0">
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
                                    if (groupShipmentType === "product" && lineProductType === "Custom") {
                                      return (
                                        <FormItem className="w-[180px] shrink-0">
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
                                            <p className="text-center text-xs font-medium text-blue-700">
                                              Admin can review your request and then charge
                                            </p>
                                          </div>
                                          <FormMessage />
                                        </FormItem>
                                      );
                                    }

                                    const lineQuantity =
                                      form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.quantity`) || 0;
                                    const linePackOf =
                                      groupShipmentType === "product"
                                        ? form.watch(
                                            `shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.packOf`
                                          ) || 1
                                        : 1;
                                    let unitPrice =
                                      form.watch(`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice`) || 0;

                                    if (
                                      groupShipmentType === "product" &&
                                      groupService &&
                                      lineProductType &&
                                      effectivePricingRules &&
                                      effectivePricingRules.length > 0 &&
                                      lineQuantity > 0
                                    ) {
                                      const calculatedPrice = calculatePrepUnitPrice(
                                        effectivePricingRules,
                                        groupService,
                                        lineProductType,
                                        lineQuantity
                                      );

                                      if (
                                        calculatedPrice &&
                                        calculatedPrice.rate !== undefined &&
                                        calculatedPrice.rate !== null
                                      ) {
                                        unitPrice = calculatedPrice.rate;
                                      }
                                    }

                                    let calculatedTotal = 0;
                                    if (groupShipmentType === "product" && unitPrice > 0 && lineQuantity > 0) {
                                      calculatedTotal = parseFloat((unitPrice * lineQuantity).toFixed(2));
                                    } else if (unitPrice > 0 && lineQuantity > 0) {
                                      calculatedTotal = parseFloat((unitPrice * lineQuantity).toFixed(2));
                                    }

                                    const displayValue = calculatedTotal > 0 ? calculatedTotal : field.value || 0;
                                    const formattedValue =
                                      typeof displayValue === "number"
                                        ? displayValue.toFixed(2)
                                        : parseFloat(displayValue || 0).toFixed(2);

                                    return (
                                      <FormItem className="w-[180px] shrink-0">
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

                                <FormField
                                  control={form.control}
                                  name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.unitPrice` as const}
                                  render={({ field }) => (
                                    <input type="hidden" {...field} value={field.value ?? ""} />
                                  )}
                                />

                                <div className="w-[460px] shrink-0">
                                  <FormLabel className="mb-1 block text-xs text-muted-foreground">
                                    Upload Shipping Label(s) (Optional)
                                  </FormLabel>
                                  <div className="mouse-h-scroll">
                                    <div className="flex min-w-max flex-nowrap items-center gap-2 pb-1">
                                      <Input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        multiple
                                        onChange={(e) => {
                                          handleLabelSelect(lineKey, e).catch((error) => {
                                            console.error("Unhandled error in handleLabelSelect:", error);
                                            toast({
                                              variant: "destructive",
                                              title: "Error",
                                              description: "Failed to process file selection. Please try again.",
                                            });
                                          });
                                        }}
                                        className="w-[190px] shrink-0"
                                        disabled={lineLabelState.isUploading || isLoading}
                                      />

                                      {(lineLabelState.items?.length ?? 0) > 0 && (
                                        <>
                                          {lineLabelState.items.map((item, itemIdx) => (
                                            <div
                                              key={itemIdx}
                                              className="flex shrink-0 items-center gap-1.5 rounded border bg-muted/40 px-2 py-1"
                                            >
                                              {item.preview ? (
                                                <img
                                                  src={item.preview}
                                                  alt=""
                                                  className="h-6 w-6 rounded object-cover"
                                                />
                                              ) : (
                                                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                              )}
                                              <span
                                                className="max-w-[100px] truncate text-xs"
                                                title={item.file.name}
                                              >
                                                {item.file.name}
                                              </span>
                                              {item.uploadedUrl ? (
                                                <span className="text-xs text-green-600">Uploaded</span>
                                              ) : null}
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-5 w-5 p-0"
                                                onClick={() => handleRemoveLabel(lineKey, itemIdx)}
                                                disabled={lineLabelState.isUploading || isLoading}
                                              >
                                                <X className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          ))}

                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0 text-xs"
                                            onClick={() => handleRemoveLabel(lineKey)}
                                            disabled={lineLabelState.isUploading || isLoading}
                                          >
                                            Clear all
                                          </Button>
                                        </>
                                      )}

                                      {lineLabelState.isUploading && (
                                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="w-[260px] shrink-0">
                                  <FormField
                                    control={form.control}
                                    name={`shipmentGroups.${groupIndex}.shipments.${shipmentIndex}.selectedAdditionalServices` as const}
                                    render={({ field }) => {
                                      const selectedServices = field.value || [];
                                      const labelForKey = (key: string) =>
                                        additionalServicesCatalog.find((r) => r.key === key)?.name ?? key;
                                      const selectedServicesDisplay = selectedServices.map(labelForKey);
                                      const displayText =
                                        selectedServicesDisplay.length > 0
                                          ? selectedServicesDisplay.join(", ")
                                          : "Select (optional)";
                                      const productPopupKey = `${popupKey}_product_${shipmentIndex}_additionalServices`;

                                      return (
                                        <FormItem>
                                          <FormLabel className="text-xs font-medium">
                                            Additional Services (Optional)
                                          </FormLabel>
                                          <Dialog
                                            open={openPopups[productPopupKey] || false}
                                            onOpenChange={(open) => {
                                              setOpenPopups((prev) => ({
                                                ...prev,
                                                [productPopupKey]: open,
                                              }));
                                            }}
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full justify-between"
                                                onClick={() => {
                                                  setOpenPopups((prev) => ({
                                                    ...prev,
                                                    [productPopupKey]: !prev[productPopupKey],
                                                  }));
                                                }}
                                              >
                                                <span className="truncate">{displayText}</span>
                                                <ChevronDown className="h-4 w-4 opacity-50" />
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                              <DialogHeader>
                                                <DialogTitle>
                                                  Additional Services for {product?.productName}
                                                </DialogTitle>
                                                <DialogDescription>
                                                  Select which additional services you need for this product. Admin will
                                                  add quantities and calculate pricing during approval.
                                                </DialogDescription>
                                              </DialogHeader>
                                              <div className="max-h-[min(60vh,420px)] space-y-4 overflow-y-auto py-2 pr-1">
                                                {additionalServicesCatalog.map((svc) => {
                                                  const checked = selectedServices.includes(svc.key);
                                                  return (
                                                    <FormItem
                                                      key={svc.key}
                                                      className="flex flex-row items-start space-x-3 space-y-0"
                                                    >
                                                      <FormControl>
                                                        <Checkbox
                                                          checked={checked}
                                                          onCheckedChange={(c) => {
                                                            const current = field.value || [];
                                                            if (c) {
                                                              field.onChange(
                                                                Array.from(new Set([...current, svc.key]))
                                                              );
                                                            } else {
                                                              field.onChange(
                                                                current.filter((s: string) => s !== svc.key)
                                                              );
                                                            }
                                                          }}
                                                        />
                                                      </FormControl>
                                                      <div className="space-y-1 leading-none">
                                                        <FormLabel>{svc.name}</FormLabel>
                                                        <p className="text-xs text-muted-foreground">
                                                          {svc.description ||
                                                            "Admin enters quantity when completing this request."}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                          Rate: ${Number(svc.price || 0).toFixed(2)}
                                                        </p>
                                                      </div>
                                                    </FormItem>
                                                  );
                                                })}
                                                <div className="flex justify-end gap-2 pt-2">
                                                  <Button
                                                    type="button"
                                                    variant="ghost"
                                                    onClick={() => {
                                                      field.onChange([]);
                                                      setOpenPopups((prev) => ({
                                                        ...prev,
                                                        [productPopupKey]: false,
                                                      }));
                                                    }}
                                                  >
                                                    Clear All
                                                  </Button>
                                                  <Button
                                                    type="button"
                                                    onClick={() =>
                                                      setOpenPopups((prev) => ({
                                                        ...prev,
                                                        [productPopupKey]: false,
                                                      }))
                                                    }
                                                  >
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
                                    </div>
                                  </DialogContent>
                                </Dialog>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 shrink-0 p-0"
                                  onClick={() => {
                                    handleRemoveShipmentLine(groupIndex, shipmentIndex);
                                    const currentShipments = form.getValues(`shipmentGroups.${groupIndex}.shipments`);
                                    const updated = currentShipments.filter((_, i) => i !== shipmentIndex);
                                    form.setValue(`shipmentGroups.${groupIndex}.shipments`, updated);
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
          </Accordion>

          {shipmentGroups.length > 0 && (() => {
            const allGroups = form.watch("shipmentGroups") as any[] | undefined;
            const groupTotals = (allGroups || []).map((g) =>
              (g?.shipments || []).reduce(
                (sum: number, s: any) => sum + (Number(s?.totalPrice) || 0),
                0
              )
            );
            const grandTotal = groupTotals.reduce((a: number, b: number) => a + b, 0);
            return (
              <Card className="border-2 border-primary/30 bg-primary/5">
                <CardContent className="p-4 sm:p-5">
                  <div className="space-y-2">
                    {groupTotals.map((t, idx) => {
                      const productsCount = (allGroups?.[idx]?.shipments || []).length as number;
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-muted-foreground">
                            Shipment {idx + 1}
                            <span className="ml-2 text-xs">
                              ({productsCount} product{productsCount === 1 ? "" : "s"})
                            </span>
                          </span>
                          <span className="font-medium tabular-nums">${t.toFixed(2)}</span>
                        </div>
                      );
                    })}
                    <div className="border-t border-primary/30 pt-2 flex items-center justify-between">
                      <span className="text-base font-semibold">Grand Total</span>
                      <span className="text-lg font-bold tabular-nums text-primary">
                        ${grandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

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

