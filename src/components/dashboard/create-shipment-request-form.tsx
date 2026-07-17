"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { useMemo, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown, ChevronDown, Loader2, X, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import type { ServiceType, ProductType, UserPricing, UserBoxForwardingPricing, UserPalletForwardingPricing, UserPalletExistingInventoryPricing, UserAdditionalServicesPricing } from "@/types";
import { DTC_FBM_SERVICE, isDtcFbmService } from "@/types";

// Define InventoryItem locally since it's not exported from @/types
interface InventoryItem {
  id: string;
  productName: string;
  quantity: number;
  status: string;
  inventoryType?: string;
  [key: string]: any;
}
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollection } from "@/hooks/use-collection";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
import { getUserPricingProfilePaths } from "@/lib/pricing-profiles";

const shipmentItemSchema = z.object({
  productId: z.string().min(1, "Select a product."),
  quantity: z.coerce.number().int().positive("Shipped quantity must be a positive number."),
  packOf: z.coerce.number().int().positive("Pack size must be a positive number."),
  unitPrice: z.coerce.number().nonnegative("Unit price must be a non-negative number."), // Allow 0 for custom products
  totalPrice: z.coerce.number().nonnegative("Total price must be a non-negative number."), // Total price (unitPrice × quantity)
});

const formSchema = z.object({
  shipmentType: z.enum(["product", "box", "pallet"], { required_error: "Shipment type is required." }),
  palletSubType: z.enum(["existing_inventory", "forwarding"]).optional(),
  shipments: z.array(shipmentItemSchema).min(1, "Select at least one item to ship."),
  date: z.date({ required_error: "A shipping date is required." }),
  remarks: z.string().optional(),
  service: z.enum(["FBA/WFS/TFS", "DTC/FBM", "Box Forwarding"]).optional(),
  productType: z.enum(["Standard", "Custom"]).optional(),
  customDimensions: z.string().optional(),
  labelUrl: z.string().optional(),
  // Additional Services
  bubbleWrapFeet: z.coerce.number().int().min(0, "Bubble wrap feet must be a non-negative number.").optional(),
  stickerRemovalItems: z.coerce.number().int().min(0, "Sticker removal items must be a non-negative number.").optional(),
  warningLabels: z.coerce.number().int().min(0, "Warning labels must be a non-negative number.").optional(),
}).refine((data) => {
  // Service is required for product and box types
  if (data.shipmentType === "product") {
    return data.service && data.productType;
  }
  if (data.shipmentType === "box") {
    return data.service === "Box Forwarding";
  }
  return true;
}, {
  message: "Service is required for product and box shipments.",
  path: ["service"],
}).refine((data) => {
  // palletSubType is required for pallet type
  if (data.shipmentType === "pallet") {
    return data.palletSubType;
  }
  return true;
}, {
  message: "Please select pallet sub-type.",
  path: ["palletSubType"],
}).refine((data) => {
  // For non-custom products, unitPrice must be positive
  // For custom products, unitPrice can be 0
  if (data.shipmentType === "product" && data.productType !== "Custom") {
    return data.shipments.every(shipment => shipment.unitPrice > 0);
  }
  return true;
}, {
  message: "Unit price must be greater than 0 for non-custom products.",
  path: ["shipments"],
});

interface CreateShipmentRequestFormProps {
  inventory: InventoryItem[];
}

export function CreateShipmentRequestForm({ inventory }: CreateShipmentRequestFormProps) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [additionalServicesDialogOpen, setAdditionalServicesDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
      defaultValues: {
        shipmentType: "product",
        palletSubType: undefined,
        shipments: [],
        remarks: undefined,
        service: "FBA/WFS/TFS",
        productType: "Standard",
        customDimensions: undefined,
      },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "shipments",
  });

  // Fetch user's pricing rules
  const { data: pricingRules } = useCollection<UserPricing>(
    userProfile ? getUserPricingProfilePaths(userProfile).prep : ""
  );
  
  // Fetch forwarding pricing
  const { data: boxForwardingPricing, loading: boxForwardingPricingLoading } = useCollection<UserBoxForwardingPricing>(
    userProfile ? getUserPricingProfilePaths(userProfile).boxForwarding : ""
  );
  
  const { data: palletForwardingPricing } = useCollection<UserPalletForwardingPricing>(
    userProfile ? getUserPricingProfilePaths(userProfile).palletForwarding : ""
  );
  
  const { data: palletExistingInventoryPricing } = useCollection<UserPalletExistingInventoryPricing>(
    userProfile ? `users/${userProfile.uid}/palletExistingInventoryPricing` : ""
  );
  
  // Fetch additional services pricing
  const { data: additionalServicesPricing } = useCollection<UserAdditionalServicesPricing>(
    userProfile ? getUserPricingProfilePaths(userProfile).additionalServices : ""
  );

  // Watch form values for auto-calculation
  const shipmentType = form.watch("shipmentType");
  const palletSubType = form.watch("palletSubType");
  const service = form.watch("service");
  const productType = form.watch("productType");
  const shipments = form.watch("shipments");
  
  // Calculate if this is a custom product - calculate at component level for proper reactivity
  const isCustomProduct = shipmentType === "product" && productType === "Custom";

  // Get box forwarding price - calculate once and reuse
  const boxForwardingPrice = useMemo(() => {
    if (shipmentType !== "box") {
      return null;
    }
    
    console.log("[PRICING DEBUG] Box Forwarding Pricing Data:", boxForwardingPricing);
    console.log("[PRICING DEBUG] Loading:", boxForwardingPricingLoading);
    console.log("[PRICING DEBUG] User Profile UID:", userProfile?.uid);
    
    // Wait for data to load
    if (boxForwardingPricingLoading) {
      console.log("[PRICING DEBUG] Still loading, returning null");
      return null;
    }
    
    if (!boxForwardingPricing || boxForwardingPricing.length === 0) {
      console.log("[PRICING DEBUG] No pricing data found");
      return null;
    }
    
    console.log("[PRICING DEBUG] Pricing array length:", boxForwardingPricing.length);
    
    const latestBoxPricing = [...boxForwardingPricing].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    })[0];
    
    console.log("[PRICING DEBUG] Latest box pricing:", latestBoxPricing);
    
    if (latestBoxPricing && latestBoxPricing.price !== undefined && latestBoxPricing.price !== null) {
      const priceValue = typeof latestBoxPricing.price === 'string' 
        ? parseFloat(latestBoxPricing.price) 
        : latestBoxPricing.price;
      console.log("[PRICING DEBUG] Price value:", priceValue, "Type:", typeof priceValue);
      if (!isNaN(priceValue) && priceValue > 0) {
        console.log("[PRICING DEBUG] ✅ Returning box forwarding price:", priceValue);
        return priceValue;
      }
    }
    console.log("[PRICING DEBUG] ❌ No valid price found");
    return null;
  }, [shipmentType, boxForwardingPricing, boxForwardingPricingLoading, userProfile]);

  // Auto-calculate unit price based on shipment type
  useEffect(() => {
    if (shipments.length === 0) return;

    shipments.forEach((shipment, index) => {
      const quantity = shipment.quantity || 0;
      let finalUnitPrice = 0;
      
      // For box shipments, always use box forwarding pricing from pricing page
      if (shipmentType === "box") {
        console.log("[PRICING CALC] Box shipment - boxForwardingPrice:", boxForwardingPrice);
        if (boxForwardingPrice !== null && boxForwardingPrice > 0) {
          finalUnitPrice = boxForwardingPrice;
          console.log("[PRICING CALC] Setting finalUnitPrice to:", finalUnitPrice);
        } else {
          // If no pricing found, set to 0 to clear any incorrect values
          finalUnitPrice = 0;
          console.log("[PRICING CALC] No pricing found, setting to 0");
        }
      } else if (shipmentType === "product") {
        // Product: Use prep pricing
        // For custom products, set price to 1 (placeholder) and skip pricing calculation
        if (productType === "Custom") {
          finalUnitPrice = 1;
          // Set totalPrice to quantity for custom products (1 * quantity)
          const quantity = shipment.quantity || 0;
          form.setValue(`shipments.${index}.unitPrice`, 1);
          form.setValue(`shipments.${index}.totalPrice`, quantity);
          return;
        }
        
        if (!service || !productType || pricingRules.length === 0) return;
        
        const packOf = shipment.packOf || 1;
        const totalUnits = quantity * packOf;

        if (totalUnits > 0 && service && (service === "FBA/WFS/TFS" || isDtcFbmService(service))) {
          const calculatedPrice = calculatePrepUnitPrice(
            pricingRules,
            service as ServiceType,
            productType,
            totalUnits
          );

          if (calculatedPrice) {
            const { rate } = calculatedPrice;
            // Base unit price (without pack charge)
            finalUnitPrice = rate;
          }
        }
      } else if (shipmentType === "pallet") {
        // Pallet: Use pallet forwarding or existing inventory pricing
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
          if (palletExistingInventoryPricing && palletExistingInventoryPricing.length > 0) {
            const latestPalletExisting = [...palletExistingInventoryPricing].sort((a, b) => {
              const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
              const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
              return bUpdated - aUpdated;
            })[0];
            if (latestPalletExisting && latestPalletExisting.price !== undefined && latestPalletExisting.price !== null) {
              // Ensure price is a number
              const priceValue = typeof latestPalletExisting.price === 'string' 
                ? parseFloat(latestPalletExisting.price) 
                : latestPalletExisting.price;
              if (!isNaN(priceValue) && priceValue > 0) {
                finalUnitPrice = priceValue;
              }
            }
          }
        }
        // If no pricing found, keep finalUnitPrice at 0 to clear incorrect values
      }

      // Calculate total price
      let totalPrice = 0;
      // For custom products, always set total price to quantity (1 * quantity)
      if (shipmentType === "product" && productType === "Custom") {
        const quantity = shipment.quantity || 0;
        totalPrice = quantity;
        // Ensure prices are set to 1 for unitPrice and quantity for totalPrice
        form.setValue(`shipments.${index}.unitPrice`, 1);
        form.setValue(`shipments.${index}.totalPrice`, quantity);
        return; // Skip further processing for custom products
      } else if (shipmentType === "product" && finalUnitPrice > 0 && quantity > 0) {
        const packOf = shipment.packOf || 1;
        const totalUnits = quantity * packOf;
        
        // Base total = prep unit price × total units
        const baseTotal = finalUnitPrice * totalUnits;
        
        totalPrice = parseFloat(baseTotal.toFixed(2));
      } else if (finalUnitPrice > 0 && quantity > 0) {
        // For box/pallet: simple multiplication
        totalPrice = parseFloat((finalUnitPrice * quantity).toFixed(2));
      }

      // Only update if the current value is different to avoid infinite loops
      const currentUnitPrice = form.getValues(`shipments.${index}.unitPrice`);
      const currentTotalPrice = form.getValues(`shipments.${index}.totalPrice`);
      
      // Update unit price if it changed (allow 0 to clear incorrect values when switching types)
      if (currentUnitPrice !== finalUnitPrice) {
        // For box/pallet, always update (even if 0) to clear wrong values when switching types
        // For product, only update if we have a valid price (> 0)
        if (shipmentType === "box" || shipmentType === "pallet" || finalUnitPrice > 0) {
          form.setValue(`shipments.${index}.unitPrice`, finalUnitPrice);
        }
      }
      
      if (currentTotalPrice !== totalPrice && (totalPrice > 0 || quantity === 0)) {
        form.setValue(`shipments.${index}.totalPrice`, totalPrice);
      }
    });
  }, [shipmentType, palletSubType, service, productType, shipments, pricingRules, boxForwardingPricing, palletForwardingPricing, palletExistingInventoryPricing, boxForwardingPrice, form]);

  // Apply box forwarding price immediately when it becomes available
  useEffect(() => {
    console.log("[PRICING APPLY] Effect triggered - shipmentType:", shipmentType, "boxForwardingPrice:", boxForwardingPrice, "shipments.length:", shipments.length);
    
    // Only proceed if shipment type is "box"
    if (shipmentType !== "box") {
      console.log("[PRICING APPLY] Not a box shipment, skipping");
      return;
    }
    
    // If no shipments, nothing to update
    if (shipments.length === 0) {
      console.log("[PRICING APPLY] No shipments, skipping");
      return;
    }
    
    // If pricing hasn't loaded yet, wait
    if (boxForwardingPricingLoading) {
      console.log("[PRICING APPLY] Pricing still loading, waiting...");
      return;
    }
    
    // If no valid price, log and return (but don't update)
    if (!boxForwardingPrice || boxForwardingPrice <= 0) {
      console.log("[PRICING APPLY] ⚠️ No valid box forwarding price found. Pricing data:", boxForwardingPricing);
      return;
    }
    
    console.log("[PRICING APPLY] ✅ Applying price", boxForwardingPrice, "to all shipments");
    const priceToSet = parseFloat(boxForwardingPrice.toFixed(2));
    
    shipments.forEach((shipment, index) => {
      const currentPrice = form.getValues(`shipments.${index}.unitPrice`) || 0;
      console.log("[PRICING APPLY] Shipment", index, "- currentPrice:", currentPrice, "targetPrice:", priceToSet);
      
      // Always update if price is different (or if current price is 0 or 1, which are likely defaults)
      if (Math.abs(currentPrice - priceToSet) > 0.01 || currentPrice === 0 || currentPrice === 1) {
        console.log("[PRICING APPLY] 🔄 Updating shipment", index, "from", currentPrice, "to", priceToSet);
        form.setValue(`shipments.${index}.unitPrice`, priceToSet, { shouldValidate: true, shouldDirty: true });
        const quantity = shipment.quantity || 1;
        const totalPrice = parseFloat((priceToSet * quantity).toFixed(2));
        form.setValue(`shipments.${index}.totalPrice`, totalPrice, { shouldValidate: true, shouldDirty: true });
        console.log("[PRICING APPLY] ✅ Updated shipment", index, "- unitPrice:", priceToSet, "totalPrice:", totalPrice);
      } else {
        console.log("[PRICING APPLY] ✓ Price already correct for shipment", index);
      }
    });
  }, [boxForwardingPrice, shipmentType, shipments, form, boxForwardingPricingLoading, boxForwardingPricing]);

  // Apply pallet forwarding price immediately when it becomes available
  useEffect(() => {
    if (shipmentType !== "pallet" || palletSubType !== "forwarding" || shipments.length === 0) return;
    if (!palletForwardingPricing || palletForwardingPricing.length === 0) return;
    
    const latestPalletForwarding = [...palletForwardingPricing].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    })[0];
    
    if (!latestPalletForwarding || !latestPalletForwarding.price) return;
    
    const priceValue = typeof latestPalletForwarding.price === 'string' 
      ? parseFloat(latestPalletForwarding.price) 
      : latestPalletForwarding.price;
    
    if (isNaN(priceValue) || priceValue <= 0) return;
    
    shipments.forEach((shipment, index) => {
      const currentPrice = form.getValues(`shipments.${index}.unitPrice`);
      if (currentPrice !== priceValue) {
        form.setValue(`shipments.${index}.unitPrice`, priceValue);
        const quantity = shipment.quantity || 1;
        const totalPrice = parseFloat((priceValue * quantity).toFixed(2));
        form.setValue(`shipments.${index}.totalPrice`, totalPrice);
      }
    });
  }, [shipmentType, palletSubType, palletForwardingPricing, shipments, form]);

  // Apply pallet existing inventory price immediately when it becomes available
  useEffect(() => {
    if (shipmentType !== "pallet" || palletSubType !== "existing_inventory" || shipments.length === 0) return;
    if (!palletExistingInventoryPricing || palletExistingInventoryPricing.length === 0) return;
    
    const latestPalletExisting = [...palletExistingInventoryPricing].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    })[0];
    
    if (!latestPalletExisting || !latestPalletExisting.price) return;
    
    const priceValue = typeof latestPalletExisting.price === 'string' 
      ? parseFloat(latestPalletExisting.price) 
      : latestPalletExisting.price;
    
    if (isNaN(priceValue) || priceValue <= 0) return;
    
    shipments.forEach((shipment, index) => {
      const currentPrice = form.getValues(`shipments.${index}.unitPrice`);
      if (currentPrice !== priceValue) {
        form.setValue(`shipments.${index}.unitPrice`, priceValue);
        const quantity = shipment.quantity || 1;
        const totalPrice = parseFloat((priceValue * quantity).toFixed(2));
        form.setValue(`shipments.${index}.totalPrice`, totalPrice);
      }
    });
  }, [shipmentType, palletSubType, palletExistingInventoryPricing, shipments, form]);

  // Set prices to 1 (unitPrice) and quantity (totalPrice) when Custom product type is selected
  // Also update when quantity changes
  useEffect(() => {
    if (shipmentType === "product" && productType === "Custom" && shipments.length > 0) {
      shipments.forEach((shipment, index) => {
        const quantity = shipment.quantity || 0;
        form.setValue(`shipments.${index}.unitPrice`, 1, { shouldValidate: false, shouldDirty: false });
        form.setValue(`shipments.${index}.totalPrice`, quantity, { shouldValidate: false, shouldDirty: false });
      });
    }
  }, [shipmentType, productType, shipments, form]);

  const availableInventory = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return inventory
      .filter((item) => item.quantity > 0)
      .filter((item) => {
        const inventoryType = (item as any).inventoryType;
        // Filter by shipment type
        if (shipmentType === "box") {
          return inventoryType === "box";
        } else if (shipmentType === "pallet") {
          if (palletSubType === "forwarding") {
            return inventoryType === "pallet";
          } else if (palletSubType === "existing_inventory") {
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
  }, [inventory, query, shipmentType, palletSubType]);

  const shipmentErrors = form.formState.errors.shipments;
  const shipmentsErrorMessage = Array.isArray(shipmentErrors)
    ? undefined
    : shipmentErrors?.message;


  const handleToggleProduct = (productId: string, checked: boolean) => {
    const currentShipments = form.getValues("shipments");
    const existingIndex = currentShipments.findIndex((shipment) => shipment.productId === productId);

    if (checked && existingIndex === -1) {
      // Calculate initial price based on shipment type
      let initialUnitPrice = 0;
      let initialTotalPrice = 0;
      
      if (shipmentType === "box" && boxForwardingPrice !== null && boxForwardingPrice > 0) {
        initialUnitPrice = boxForwardingPrice;
        initialTotalPrice = boxForwardingPrice; // quantity is 1 by default
      } else if (shipmentType === "pallet") {
        // Calculate pallet pricing based on palletSubType
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
        } else if (palletSubType === "existing_inventory" && palletExistingInventoryPricing && palletExistingInventoryPricing.length > 0) {
          const latestPalletExisting = [...palletExistingInventoryPricing].sort((a, b) => {
            const aUpdated = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
            const bUpdated = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
            return bUpdated - aUpdated;
          })[0];
          if (latestPalletExisting && latestPalletExisting.price) {
            const priceValue = typeof latestPalletExisting.price === 'string' 
              ? parseFloat(latestPalletExisting.price) 
              : latestPalletExisting.price;
            if (!isNaN(priceValue) && priceValue > 0) {
              initialUnitPrice = priceValue;
              initialTotalPrice = priceValue;
            }
          }
        }
      } else {
        // For product, default to 0 and let the useEffect calculate
        initialUnitPrice = 0;
        initialTotalPrice = 0;
      }
      
      append({
        productId,
        quantity: 1,
        packOf: 1,
        unitPrice: initialUnitPrice,
        totalPrice: initialTotalPrice,
      });
      return;
    }

    if (!checked && existingIndex !== -1) {
      remove(existingIndex);
    }
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
    if (!user || !userProfile) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create a shipment request.",
      });
      return;
    }


    // Validate stock availability
    const stockErrors: string[] = [];
    values.shipments.forEach((shipment, index) => {
      const product = inventory.find(item => item.id === shipment.productId);
      if (product) {
        const packOf = values.shipmentType === "product" ? (shipment.packOf || 1) : 1;
        const totalUnits = shipment.quantity * packOf;
        if (totalUnits > product.quantity) {
          const unitType = values.shipmentType === "box" ? "boxes" : values.shipmentType === "pallet" ? "pallets" : "units";
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
        description: stockErrors.join(" "),
      });
      return;
    }

    setIsLoading(true);
    try {
      const requestedAt = Timestamp.now();
      const dateTimestamp = Timestamp.fromDate(values.date);

      // Include selected additional services (user only selects which services, admin adds quantities)
      const selectedAdditionalServices: string[] = [];
      if (values.bubbleWrapFeet !== undefined && values.bubbleWrapFeet > 0) {
        selectedAdditionalServices.push("bubbleWrap");
      }
      if (values.stickerRemovalItems !== undefined && values.stickerRemovalItems > 0) {
        selectedAdditionalServices.push("stickerRemoval");
      }
      if (values.warningLabels !== undefined && values.warningLabels > 0) {
        selectedAdditionalServices.push("warningLabels");
      }

      const requestData: any = {
        userId: user.uid,
        userName: userProfile.name || "Unknown User",
        shipments: values.shipments,
        date: dateTimestamp,
        remarks: values.remarks || undefined,
        shipmentType: values.shipmentType,
        status: "pending",
        requestedBy: user.uid,
        requestedAt,
      };

      // Set service based on shipment type
      if (values.shipmentType === "box") {
        requestData.service = "Box Forwarding";
      } else if (values.shipmentType === "pallet") {
        if (values.palletSubType === "forwarding") {
          requestData.service = "Pallet Forwarding";
        } else if (values.palletSubType === "existing_inventory") {
          requestData.service = "Pallet Existing Inventory";
        }
      } else if (values.service) {
        // For product shipments, use the selected service
        requestData.service = values.service;
      }
      
      // Only include optional fields if they have values (avoid undefined)
      if (values.palletSubType) {
        requestData.palletSubType = values.palletSubType;
      }
      if (values.productType) {
        requestData.productType = values.productType;
      }
      if (values.customDimensions && values.customDimensions.trim().length > 0) {
        requestData.customDimensions = values.customDimensions.trim();
      }
      // Labels are uploaded separately via Upload Labels page, so we set empty string
      requestData.labelUrl = "";

      if (selectedAdditionalServices.length > 0) {
        requestData.selectedAdditionalServices = selectedAdditionalServices;
      }

      // Clean shipments array to remove undefined values
      requestData.shipments = values.shipments.map((shipment: any) => {
        const cleaned: any = {
          productId: shipment.productId,
          quantity: shipment.quantity,
          packOf: shipment.packOf || 1,
          unitPrice: shipment.unitPrice || 0,
        };
        // Only include optional fields
        if (shipment.selectedAdditionalServices && shipment.selectedAdditionalServices.length > 0) {
          cleaned.selectedAdditionalServices = shipment.selectedAdditionalServices;
        }
        return cleaned;
      });

      // Remove all undefined values before saving to Firestore
      const cleanedRequestData = removeUndefined(requestData);

      await addDoc(collection(db, `users/${user.uid}/shipmentRequests`), cleanedRequestData);

      toast({
        title: "Success",
        description: "Shipment request submitted successfully. Waiting for admin confirmation.",
      });

      form.reset({
        shipmentType: "product",
        palletSubType: undefined,
        shipments: [],
        remarks: undefined,
        service: "FBA/WFS/TFS",
        productType: "Standard",
        customDimensions: undefined,
        labelUrl: undefined,
        bubbleWrapFeet: undefined,
        stickerRemovalItems: undefined,
        warningLabels: undefined,
      });
      setQuery("");
      setOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to submit shipment request.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Outbound Shipment Request
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Outbound Shipment Request</DialogTitle>
          <DialogDescription>
            Select products to ship. Admin will review and confirm your shipment.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Shipment Type Selection */}
            <FormField
              control={form.control}
              name="shipmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shipment Type *</FormLabel>
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      // Reset pallet sub-type when changing shipment type
                      if (value !== "pallet") {
                        form.setValue("palletSubType", undefined);
                      }
                      // Clear shipments when changing type
                      form.setValue("shipments", []);
                      // Auto-set service based on shipment type
                      if (value === "box") {
                        // Set service to "Box Forwarding" for box shipments
                        form.setValue("service", "Box Forwarding");
                      } else if (value === "pallet") {
                        // Service will be set based on palletSubType in the request data
                        form.setValue("service", undefined);
                      } else {
                        // For product, service is required and user must select it
                        form.setValue("service", "FBA/WFS/TFS");
                      }
                    }} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select shipment type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="product">Product</SelectItem>
                      <SelectItem value="box">Box Forwarding</SelectItem>
                      <SelectItem value="pallet">Pallet Forwarding</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Pallet Sub-Type (only for pallet shipments) */}
            {shipmentType === "pallet" && (
              <FormField
                control={form.control}
                name="palletSubType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pallet Type *</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        // Clear shipments when changing pallet sub-type
                        form.setValue("shipments", []);
                      }} 
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select pallet type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="existing_inventory">Existing Inventory</SelectItem>
                        <SelectItem value="forwarding">Pallet Forwarding</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Service - Only for box shipments */}
            {shipmentType === "box" && (
              <FormField
                control={form.control}
                name="service"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service *</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value);
                        // Clear shipments when changing service to recalculate pricing
                        form.setValue("shipments", []);
                      }} 
                      defaultValue={field.value || "Box Forwarding"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select service" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Box Forwarding">Box Forwarding</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Price per box: ${boxForwardingPrice ? boxForwardingPrice.toFixed(2) : '0.00'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Products Field - First */}
            <div className="space-y-2">
              <FormLabel>Products</FormLabel>
              <Dialog open={false}>
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={inventory.length === 0}
                    onClick={(e) => {
                      e.preventDefault();
                      // This will be handled by the product selection dialog
                    }}
                  >
                    {fields.length
                      ? `${fields.length} product${fields.length > 1 ? "s" : ""} selected`
                      : "Select products to ship..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DialogTrigger>
              </Dialog>
              <div className="border rounded-lg p-3 max-h-60 overflow-y-auto">
                <Input
                  placeholder="Search products..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="mb-3"
                />
                <div className="space-y-2">
                  {availableInventory.map((item) => {
                    const isSelected = fields.some((field) => field.productId === item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer border rounded"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) =>
                            handleToggleProduct(item.id, checked === true)
                          }
                        />
                        <div className="flex flex-col flex-1">
                          <span className="font-medium">{item.productName}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.sku && <span className="mr-2">SKU: {item.sku}</span>}
                            In Stock: {item.quantity}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                  {availableInventory.length === 0 && (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      {inventory.length === 0
                        ? "No inventory available."
                        : "No products match your search."}
                    </div>
                  )}
                </div>
              </div>
              {shipmentsErrorMessage && (
                <p className="text-sm font-medium text-destructive">{shipmentsErrorMessage}</p>
              )}
            </div>

            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground text-center">
                No products selected yet. Use the search above to choose products to ship.
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
                          {(() => {
                            const quantity = form.watch(`shipments.${index}.quantity`) || 0;
                            const packOf = shipmentType === "product" ? (form.watch(`shipments.${index}.packOf`) || 1) : 1;
                            const totalUnits = quantity * packOf;
                            const availableStock = productMeta?.quantity || 0;
                            const isInsufficient = totalUnits > availableStock && totalUnits > 0;
                            
                            if (isInsufficient) {
                              return (
                                <p className="text-xs font-medium text-destructive mt-1">
                                  ⚠️ Insufficient stock! You're requesting {totalUnits} {shipmentType === "box" ? "boxes" : shipmentType === "pallet" ? "pallets" : "units"} but only {availableStock} available.
                                </p>
                              );
                            }
                            if (totalUnits > 0) {
                              return (
                                <p className="text-xs text-green-600 mt-1">
                                  ✓ Total {shipmentType === "box" ? "boxes" : shipmentType === "pallet" ? "pallets" : "units"}: {totalUnits} (Available: {availableStock})
                                </p>
                              );
                            }
                            return null;
                          })()}
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

                      {/* Product fields - use component-level isCustomProduct for proper reactivity */}
                      <div key={`product-fields-${index}-${String(productType)}-${String(shipmentType)}-${fields.length}`}>
                        <div className={`grid gap-4 ${isCustomProduct ? "md:grid-cols-2" : shipmentType === "product" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                              <FormField
                                control={form.control}
                                name={`shipments.${index}.quantity` as const}
                                render={({ field }) => {
                                  const quantity = field.value || 0;
                                  const packOf = shipmentType === "product" ? (form.watch(`shipments.${index}.packOf`) || 1) : 1;
                                  const totalUnits = quantity * packOf;
                                  const availableStock = productMeta?.quantity || 0;
                                  const isInsufficient = totalUnits > availableStock && totalUnits > 0;
                                  
                                  return (
                                    <FormItem>
                                      <FormLabel>Shipped Units</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          min="1"
                                          className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isInsufficient ? 'border-destructive' : ''}`}
                                          {...field}
                                        />
                                      </FormControl>
                                      {isInsufficient && (
                                        <p className="text-xs font-medium text-destructive">
                                          Insufficient stock! Available: {availableStock}, Requested: {totalUnits}
                                        </p>
                                      )}
                                      <FormMessage />
                                    </FormItem>
                                  );
                                }}
                              />
                              {/* Pack Of - Only for product shipments, hide for custom */}
                              {shipmentType === "product" && productType !== "Custom" && (
                                <FormField
                                  control={form.control}
                                  name={`shipments.${index}.packOf` as const}
                                  render={({ field }) => {
                                    const packOf = field.value || 1;
                                    const quantity = form.watch(`shipments.${index}.quantity`) || 0;
                                    const totalUnits = quantity * packOf;
                                    const availableStock = productMeta?.quantity || 0;
                                    const isInsufficient = totalUnits > availableStock && totalUnits > 0;
                                    
                                    return (
                                      <FormItem>
                                        <FormLabel>Pack Of</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min="1"
                                            placeholder="Enter pack size"
                                            className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isInsufficient ? 'border-destructive' : ''}`}
                                            {...field}
                                          />
                                        </FormControl>
                                        {isInsufficient && (
                                          <p className="text-xs font-medium text-destructive">
                                            Insufficient stock! Available: {availableStock}, Requested: {totalUnits}
                                          </p>
                                        )}
                                        <FormMessage />
                                      </FormItem>
                                    );
                                  }}
                                />
                              )}
                              {/* Show price section for custom products - always show $1 as placeholder */}
                              {shipmentType === "product" && productType === "Custom" ? (
                                <FormField
                                  control={form.control}
                                  name={`shipments.${index}.totalPrice` as const}
                                  render={({ field }) => {
                                    // Always display $1 for custom products (placeholder price)
                                    const displayValue = 1;
                                    return (
                                      <FormItem>
                                        <FormLabel>Price ($)</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={displayValue}
                                            readOnly
                                            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-muted"
                                          />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Placeholder price. Admin will set final pricing after review.
                                        </p>
                                        {/* Admin message directly below price field */}
                                        <div className="p-3 bg-blue-50 rounded-md border-2 border-blue-200 border-dashed mt-2">
                                          <p className="text-sm text-blue-700 font-medium text-center">
                                            Admin can review your request and then charge
                                          </p>
                                        </div>
                                        <FormMessage />
                                      </FormItem>
                                    );
                                  }}
                                />
                              ) : (
                                <FormField
                                  control={form.control}
                                  name={`shipments.${index}.totalPrice` as const}
                                  render={({ field }) => {
                                    const quantity = form.watch(`shipments.${index}.quantity`) || 0;
                                    const packOf = shipmentType === "product" ? (form.watch(`shipments.${index}.packOf`) || 1) : 1;
                                    const totalUnits = quantity * packOf;
                                    const unitPrice = form.watch(`shipments.${index}.unitPrice`) || 0;
                                    
                                    const hasPricing = shipmentType === "product" 
                                      ? (service && productType && totalUnits > 0 && pricingRules.length > 0)
                                      : (shipmentType === "box" && boxForwardingPricing && boxForwardingPricing.length > 0) ||
                                        (shipmentType === "pallet" && palletSubType === "forwarding" && palletForwardingPricing && palletForwardingPricing.length > 0) ||
                                        (shipmentType === "pallet" && palletSubType === "existing_inventory" && palletExistingInventoryPricing && palletExistingInventoryPricing.length > 0);
                                    
                                    // Calculate total price
                                    const calculatedTotal = unitPrice > 0 && quantity > 0 ? parseFloat((unitPrice * quantity).toFixed(2)) : 0;
                                    
                                    const priceLabel = shipmentType === "product" 
                                      ? "Total Prep Price ($)"
                                      : shipmentType === "box"
                                      ? "Total Box Forwarding Price ($)"
                                      : palletSubType === "forwarding"
                                      ? "Total Pallet Forwarding Price ($)"
                                      : "Total Pallet Existing Inventory Price ($)";
                                    
                                    return (
                                      <FormItem>
                                        <FormLabel>{priceLabel}</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            placeholder={hasPricing ? "Auto-calculated" : "Enter total price"}
                                            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            readOnly={hasPricing}
                                            value={field.value || calculatedTotal}
                                            onChange={(e) => {
                                              const value = parseFloat(e.target.value) || 0;
                                              field.onChange(value);
                                            }}
                                          />
                                        </FormControl>
                                        {hasPricing && shipmentType === "product" && unitPrice > 0 && quantity > 0 && (
                                          <p className="text-xs text-muted-foreground">
                                            {(() => {
                                              const packOfValue = form.watch(`shipments.${index}.packOf`) || 1;
                                              const totalUnitsCalc = quantity * packOfValue;
                                              const baseTotal = unitPrice * totalUnitsCalc;
                                              return `Auto-calculated: $${unitPrice.toFixed(2)} × ${totalUnitsCalc} units = $${baseTotal.toFixed(2)}`;
                                            })()}
                                          </p>
                                        )}
                                        {hasPricing && shipmentType !== "product" && unitPrice > 0 && quantity > 0 && (
                                          <p className="text-xs text-muted-foreground">
                                            Auto-calculated: ${unitPrice.toFixed(2)} × {quantity} = ${calculatedTotal.toFixed(2)}
                                          </p>
                                        )}
                                        <FormMessage />
                                      </FormItem>
                                    );
                                  }}
                                />
                              )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Service and Product Type - Only for product shipments - After Products */}
            {shipmentType === "product" && (
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="service"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="FBA/WFS/TFS">FBA/WFS/TFS</SelectItem>
                          <SelectItem value="DTC/FBM">DTC/FBM</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="productType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Type / Dimension *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select product type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Standard">Standard (6x6x6) - &lt;3lbs</SelectItem>
                          <SelectItem value="Custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Custom Dimensions Field - Only show when Custom is selected */}
            {shipmentType === "product" && productType === "Custom" && (
              <FormField
                control={form.control}
                name="customDimensions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom Dimensions *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter your custom dimensions (e.g., Length x Width x Height in inches, Weight in lbs)"
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Please provide detailed dimensions and weight for your custom product.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any additional remarks or notes..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Additional Services - Dropdown (optional) */}
            <FormField
              control={form.control}
              name="bubbleWrapFeet"
              render={() => {
                const bubbleWrapFeet = form.watch("bubbleWrapFeet");
                const stickerRemovalItems = form.watch("stickerRemovalItems");
                const warningLabels = form.watch("warningLabels");
                const hasBubbleWrap = bubbleWrapFeet !== undefined && bubbleWrapFeet > 0;
                const hasStickerRemoval = stickerRemovalItems !== undefined && stickerRemovalItems > 0;
                const hasWarningLabels = warningLabels !== undefined && warningLabels > 0;
                const selectedServices: string[] = [];
                if (hasBubbleWrap) selectedServices.push("Bubble Wrap");
                if (hasStickerRemoval) selectedServices.push("Sticker Removal");
                if (hasWarningLabels) selectedServices.push("Warning Labels");
                const displayText = selectedServices.length > 0 
                  ? selectedServices.join(", ")
                  : "Select (optional)";

                return (
                  <FormItem>
                    <FormLabel>Additional Services (Optional)</FormLabel>
                    <Dialog open={additionalServicesDialogOpen} onOpenChange={setAdditionalServicesDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between"
                        >
                          <span className="truncate">
                            {displayText}
                          </span>
                          <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Additional Services</DialogTitle>
                          <DialogDescription>
                            Select which additional services you need. Admin will add quantities and calculate pricing during approval.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <FormField
                            control={form.control}
                            name="bubbleWrapFeet"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value !== undefined && field.value > 0}
                                    onCheckedChange={(checked) => {
                                      field.onChange(checked ? 1 : undefined);
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
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="stickerRemovalItems"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value !== undefined && field.value > 0}
                                    onCheckedChange={(checked) => {
                                      field.onChange(checked ? 1 : undefined);
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
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="warningLabels"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value !== undefined && field.value > 0}
                                    onCheckedChange={(checked) => {
                                      field.onChange(checked ? 1 : undefined);
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
                            )}
                          />
                          <div className="flex justify-end gap-2 pt-2">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                form.setValue("bubbleWrapFeet", undefined);
                                form.setValue("stickerRemovalItems", undefined);
                                form.setValue("warningLabels", undefined);
                                setAdditionalServicesDialogOpen(false);
                              }}
                            >
                              Clear All
                            </Button>
                            <Button type="button" onClick={() => setAdditionalServicesDialogOpen(false)}>
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

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={(() => {
                  if (isLoading || inventory.length === 0 || fields.length === 0) {
                    return true;
                  }
                  // Check if any shipment has insufficient stock
                  return fields.some((field, index) => {
                    const product = inventory.find(item => item.id === field.productId);
                    if (!product) return true;
                    const quantity = form.watch(`shipments.${index}.quantity`) || 0;
                    const packOf = form.watch(`shipments.${index}.packOf`) || 1;
                    const totalUnits = quantity * packOf;
                    return totalUnits > product.quantity;
                  });
                })()}
              >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Request
                {(() => {
                  const hasInsufficientStock = fields.some((field, index) => {
                    const product = inventory.find(item => item.id === field.productId);
                    if (!product) return false;
                    const quantity = form.watch(`shipments.${index}.quantity`) || 0;
                    const packOf = form.watch(`shipments.${index}.packOf`) || 1;
                    const totalUnits = quantity * packOf;
                    return totalUnits > product.quantity;
                  });
                  return hasInsufficientStock && (
                    <span className="ml-2 text-xs">(Insufficient Stock)</span>
                  );
                })()}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
