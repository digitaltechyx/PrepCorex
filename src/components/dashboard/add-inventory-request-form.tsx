"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { addDoc, collection, query, where, getDocs } from "firebase/firestore";
import { useState, useEffect, useMemo, type ChangeEvent } from "react";
import { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { db, storage } from "@/lib/firebase";
import { Archive, Boxes, CircleHelp, ImagePlus, Loader2, Package, Plus, Truck } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import type { InventoryType, ContainerSize, UserContainerHandlingPricing } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem } from "@/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type VariantRowState = {
  id: string;
  color: string;
  size: string;
  sku: string;
  quantity: number;
  /** Optional photo for this variant only (not shared across variants). */
  imageFile?: File;
  imagePreviewUrl?: string;
};

function optionalExpiryTimestampFromParts(
  expiryDateStr?: string,
  expiryDateObj?: Date
): Timestamp | undefined {
  if (expiryDateObj && !Number.isNaN(expiryDateObj.getTime())) {
    return Timestamp.fromDate(expiryDateObj);
  }
  if (expiryDateStr?.trim()) {
    const d = new Date(`${expiryDateStr.trim()}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return undefined;
}

const inventoryRequestSchema = z.object({
  inventoryType: z.enum(["product", "box", "pallet", "container"], {
    required_error: "Please select an inventory type.",
  }),
  productSubType: z.enum(["new", "restock"]).optional(),
  productEntryMode: z.enum(["single", "variants"]).optional(),
  productId: z.string().optional(), // For restock - selected product ID
  productName: z.string().optional(),
  sku: z.string().optional(),
  containerSize: z.enum(["20 feet", "40 feet"]).optional(), // For container type
  quantity: z.coerce.number().int().positive("Quantity must be a positive number."),
  remarks: z.string().optional(), // Optional remarks field
  retailIdentifier: z.string().optional(),
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
  openSignal = 0,
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
  /** Increase this number to programmatically open the dialog mode. */
  openSignal?: number;
} = {}) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(mode === "inline");
  useEffect(() => {
    if (mode !== "dialog") return;
    if (openSignal > 0) {
      setOpen(true);
    }
  }, [mode, openSignal]);

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
      productEntryMode: "single",
      productId: "",
      productName: "",
      sku: "",
      containerSize: undefined,
      quantity: 1,
      remarks: "",
      retailIdentifier: "",
    },
  });

  const inventoryType = form.watch("inventoryType");
  const productSubType = form.watch("productSubType");
  const productEntryMode = form.watch("productEntryMode");
  const containerSize = form.watch("containerSize");
  const [variantColorInput, setVariantColorInput] = useState("");
  const [variantSizeInput, setVariantSizeInput] = useState("");
  const [variantRows, setVariantRows] = useState<VariantRowState[]>([]);
  const [singleExpiryDate, setSingleExpiryDate] = useState<Date | undefined>(undefined);

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

  const revokeVariantRowPreviews = (rows: VariantRowState[]) => {
    for (const r of rows) {
      if (r.imagePreviewUrl) URL.revokeObjectURL(r.imagePreviewUrl);
    }
  };

  const clearAllVariantRows = () => {
    setVariantRows((prev) => {
      revokeVariantRowPreviews(prev);
      return [];
    });
  };

  const resetImageStates = () => {
    setSelectedProductImageFile(null);
    setSelectedProductImagePreview("");
    setRestockImageUrls([]);
  };

  const parseCsvLikeValues = (raw: string): string[] =>
    raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const buildVariantSku = (baseSku: string, color: string, size: string) => {
    const sanitize = (v: string) =>
      v
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "-")
        .replace(/[^A-Z0-9-]/g, "");
    return `${sanitize(baseSku)}-${sanitize(color)}-${sanitize(size)}`;
  };

  const regenerateVariantRows = () => {
    const colors = parseCsvLikeValues(variantColorInput);
    const sizes = parseCsvLikeValues(variantSizeInput);
    const baseSku = (form.getValues("sku") || "").trim();
    if (!baseSku) {
      toast({
        variant: "destructive",
        title: "SKU required",
        description: "Enter a base SKU before generating variants.",
      });
      return;
    }
    if (colors.length === 0 || sizes.length === 0) {
      toast({
        variant: "destructive",
        title: "Color/Size required",
        description: "Enter at least one color and one size.",
      });
      return;
    }

    const existingByKey = new Map(
      variantRows.map((row) => [`${row.color}__${row.size}`, row] as const)
    );

    const nextRows: VariantRowState[] = [];
    for (const color of colors) {
      for (const size of sizes) {
        const key = `${color}__${size}`;
        const prev = existingByKey.get(key);
        nextRows.push({
          id: prev?.id ?? `${color}-${size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          color,
          size,
          sku: prev?.sku ?? buildVariantSku(baseSku, color, size),
          quantity: prev?.quantity ?? 1,
          imageFile: prev?.imageFile,
          imagePreviewUrl: prev?.imagePreviewUrl,
        });
      }
    }
    setVariantRows((prev) => {
      const nextKeys = new Set(nextRows.map((r) => `${r.color}__${r.size}`));
      for (const r of prev) {
        if (!nextKeys.has(`${r.color}__${r.size}`) && r.imagePreviewUrl) {
          URL.revokeObjectURL(r.imagePreviewUrl);
        }
      }
      return nextRows;
    });
  };

  const updateVariantRow = (
    id: string,
    patch: Partial<{ sku: string; quantity: number }>
  ) => {
    setVariantRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
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

  const uploadInventoryImageFile = async (ownerUid: string, file: File): Promise<string[]> => {
    const cleanName = file.name.replace(/\s+/g, "_");
    const path = `inventory-images/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);
    return [downloadUrl];
  };

  const uploadProductImage = async (ownerUid: string): Promise<string[]> => {
    if (!selectedProductImageFile) return [];
    return uploadInventoryImageFile(ownerUid, selectedProductImageFile);
  };

  const clearVariantRowImage = (rowId: string) => {
    setVariantRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        if (r.imagePreviewUrl) URL.revokeObjectURL(r.imagePreviewUrl);
        return { ...r, imageFile: undefined, imagePreviewUrl: undefined };
      })
    );
  };

  const handleVariantImageSelect = (rowId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please select an image file.",
      });
      return;
    }
    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Please upload an image smaller than 5 MB.",
      });
      return;
    }
    setVariantRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        if (r.imagePreviewUrl) URL.revokeObjectURL(r.imagePreviewUrl);
        return {
          ...r,
          imageFile: file,
          imagePreviewUrl: URL.createObjectURL(file),
        };
      })
    );
  };

  const checkSkusAndIdentifiersInFirestore = async (
    items: Array<{ sku: string; retailIdentifier?: string }>
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!ownerId) return { ok: false, message: "Missing account." };
    const invRef = collection(db, `users/${ownerId}/inventory`);
    const reqRef = collection(db, `users/${ownerId}/inventoryRequests`);
    const uniqueSkus = [...new Set(items.map((c) => c.sku.trim()).filter(Boolean))];
    const uniqueRetail = [
      ...new Set(
        items
          .map((c) => c.retailIdentifier?.trim())
          .filter((x): x is string => Boolean(x && x.length > 0))
      ),
    ];
    for (const sku of uniqueSkus) {
      const [inv, req] = await Promise.all([
        getDocs(query(invRef, where("sku", "==", sku))),
        getDocs(query(reqRef, where("sku", "==", sku))),
      ]);
      if (!inv.empty) {
        return { ok: false, message: `SKU "${sku}" already exists in your inventory.` };
      }
      const pending = req.docs.some((d) => (d.data().status ?? "pending") === "pending");
      if (pending) {
        return { ok: false, message: `SKU "${sku}" is already used in a pending request.` };
      }
    }
    for (const rid of uniqueRetail) {
      const [inv, req] = await Promise.all([
        getDocs(query(invRef, where("retailIdentifier", "==", rid))),
        getDocs(query(reqRef, where("retailIdentifier", "==", rid))),
      ]);
      if (!inv.empty) {
        return {
          ok: false,
          message: `Identifier "${rid}" already exists in your inventory.`,
        };
      }
      const pending = req.docs.some((d) => (d.data().status ?? "pending") === "pending");
      if (pending) {
        return {
          ok: false,
          message: `Identifier "${rid}" is already used in a pending request.`,
        };
      }
    }
    return { ok: true };
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

      const isVariantsNewProduct =
        values.inventoryType === "product" &&
        values.productSubType === "new" &&
        values.productEntryMode === "variants";

      let finalImageUrls: string[] = [];
      if (
        (values.inventoryType === "product" && values.productSubType === "new" && !isVariantsNewProduct) ||
        values.inventoryType === "box" ||
        values.inventoryType === "pallet"
      ) {
        finalImageUrls = await uploadProductImage(ownerId);
      } else if (values.inventoryType === "product" && values.productSubType === "restock" && values.productId) {
        const selectedProduct = availableProductsForRestock.find(p => p.id === values.productId);
        if (selectedProduct) {
          finalImageUrls = extractImageUrls(selectedProduct as any);
        }
      }

      const baseRequestData: any = {
        userId: ownerId,
        userName: ownerName || "Unknown User",
        inventoryType: values.inventoryType,
        addDate,
        status: "pending",
        requestedBy: ownerId,
        requestedAt,
      };

      // Only include productSubType and productId for product type requests
      if (values.inventoryType === "product") {
        if (values.productSubType) {
          baseRequestData.productSubType = values.productSubType;
        }
        if (values.productId) {
          baseRequestData.productId = values.productId;
        }
      }

      // Only include containerSize for container type requests
      if (values.inventoryType === "container" && values.containerSize) {
        baseRequestData.containerSize = values.containerSize;
      }

      // Include remarks if provided (trim whitespace)
      if (values.remarks && values.remarks.trim()) {
        baseRequestData.remarks = values.remarks.trim();
      }

      if (finalImageUrls.length > 0) {
        baseRequestData.imageUrls = finalImageUrls;
        baseRequestData.imageUrl = finalImageUrls[0];
      }

      if (isVariantsNewProduct) {
        if (variantRows.length === 0) {
          toast({
            variant: "destructive",
            title: "Variants required",
            description: "Generate at least one color/size variant.",
          });
          setIsLoading(false);
          return;
        }
        const invalidRow = variantRows.find((row) => !row.sku.trim() || row.quantity <= 0);
        if (invalidRow) {
          toast({
            variant: "destructive",
            title: "Invalid variants",
            description: "Each variant requires a SKU and quantity greater than 0.",
          });
          setIsLoading(false);
          return;
        }

        const seenSkus = new Set<string>();
        for (const row of variantRows) {
          const normalizedSku = row.sku.trim().toLowerCase();
          if (seenSkus.has(normalizedSku)) {
            toast({
              variant: "destructive",
              title: "Duplicate variant SKU",
              description: `SKU "${row.sku}" appears more than once.`,
            });
            setIsLoading(false);
            return;
          }
          seenSkus.add(normalizedSku);
        }

        const variantDup = await checkSkusAndIdentifiersInFirestore(
          variantRows.map((row) => ({
            sku: row.sku,
            retailIdentifier: values.retailIdentifier?.trim(),
          }))
        );
        if (!variantDup.ok) {
          toast({
            variant: "destructive",
            title: "Already exists",
            description: variantDup.message,
          });
          setIsLoading(false);
          return;
        }

        const requests = variantRows.map(async (row) => {
          const doc: Record<string, unknown> = {
            ...baseRequestData,
            productName: finalProductName,
            sku: row.sku.trim(),
            quantity: row.quantity,
            color: row.color,
            size: row.size,
            variantLabel: `${row.color} / ${row.size}`,
            parentProductName: finalProductName,
            productEntryMode: "variants",
          };
          if (values.retailIdentifier?.trim()) {
            doc.retailIdentifier = values.retailIdentifier.trim();
          }
          const productExpiry = optionalExpiryTimestampFromParts(undefined, singleExpiryDate);
          if (productExpiry) doc.expiryDate = productExpiry;
          if (row.imageFile) {
            const urls = await uploadInventoryImageFile(ownerId, row.imageFile);
            doc.imageUrls = urls;
            doc.imageUrl = urls[0];
          }
          return addDoc(collection(db, `users/${ownerId}/inventoryRequests`), doc);
        });
        await Promise.all(requests);
      } else {
        if (
          values.inventoryType === "product" &&
          values.productSubType === "new" &&
          values.productEntryMode === "single" &&
          values.sku?.trim()
        ) {
          const singleDup = await checkSkusAndIdentifiersInFirestore([
            {
              sku: values.sku.trim(),
              retailIdentifier: values.retailIdentifier?.trim(),
            },
          ]);
          if (!singleDup.ok) {
            toast({
              variant: "destructive",
              title: "Already exists",
              description: singleDup.message,
            });
            setIsLoading(false);
            return;
          }
        }

        const requestData: any = {
          ...baseRequestData,
          productName: finalProductName,
          quantity: values.quantity,
        };
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
        if (values.retailIdentifier?.trim()) {
          requestData.retailIdentifier = values.retailIdentifier.trim();
        }
        const singleEx = optionalExpiryTimestampFromParts(undefined, singleExpiryDate);
        if (singleEx) {
          requestData.expiryDate = singleEx;
        }
        await addDoc(collection(db, `users/${ownerId}/inventoryRequests`), requestData);
      }

      toast({
        title: "Success",
        description: "Inventory request submitted successfully. Waiting for admin approval.",
      });

      form.reset({
        inventoryType: "product",
        productSubType: "new",
        productEntryMode: "single",
        productId: "",
        productName: "",
        sku: "",
        containerSize: undefined,
        quantity: 1,
        remarks: "",
        retailIdentifier: "",
      });
      resetImageStates();
      setVariantColorInput("");
      setVariantSizeInput("");
      clearAllVariantRows();
      setSingleExpiryDate(undefined);
      if (mode === "dialog") setOpen(false);
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

  const formBody = (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-background to-muted/20"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="space-y-5">
            <FormField
              control={form.control}
              name="inventoryType"
              render={({ field }) => (
                <FormItem className="space-y-3 rounded-xl border bg-card/90 p-4 shadow-sm">
                  <FormLabel className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Package className="h-3.5 w-3.5 text-primary" />
                    Inventory Type
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="product" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Package className="h-4 w-4 text-primary" />
                          Product
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="box" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Archive className="h-4 w-4 text-amber-600" />
                          Box
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="pallet" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Boxes className="h-4 w-4 text-violet-600" />
                          Pallet
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
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
                  <FormItem className="space-y-3 rounded-xl border bg-card/90 p-4 shadow-sm">
                    <FormLabel className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Boxes className="h-3.5 w-3.5 text-violet-600" />
                      Product Type
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={(value) => {
                          field.onChange(value);
                          // Reset fields when switching between new/restock
                          if (value === "new") {
                            form.setValue("productId", "");
                            form.setValue("productName", "");
                            form.setValue("sku", "");
                            form.setValue("retailIdentifier", "");
                            setSingleExpiryDate(undefined);
                          } else {
                            form.setValue("productName", "");
                            form.setValue("sku", "");
                            form.setValue("retailIdentifier", "");
                            setSingleExpiryDate(undefined);
                          }
                        }}
                        value={field.value}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="new" />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer">
                            New Product
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
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

            {inventoryType === "product" && productSubType === "new" && (
              <FormField
                control={form.control}
                name="productEntryMode"
                render={({ field }) => (
                  <FormItem className="space-y-3 rounded-xl border bg-card/90 p-4 shadow-sm">
                    <FormLabel className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Archive className="h-3.5 w-3.5 text-amber-600" />
                      Entry Mode
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value === "single") {
                            clearAllVariantRows();
                          } else {
                            setSelectedProductImageFile(null);
                            setSelectedProductImagePreview("");
                          }
                        }}
                        value={field.value}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="single" />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer">
                            Single Product
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="variants" />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer">
                            Product With Variants (Color / Size)
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
                        <SelectTrigger className="h-11 rounded-lg">
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
                        <SelectTrigger className="h-11 rounded-lg">
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
                        className={`h-11 rounded-lg ${inventoryType === "box" || inventoryType === "pallet" || inventoryType === "container" ? "bg-muted" : ""}`}
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
                        className="h-11 rounded-lg"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {inventoryType === "product" && productSubType === "new" && (
              <>
                <FormField
                  control={form.control}
                  name="retailIdentifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>UPC / EAN / FNSKU / ASIN (optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Enter one identifier if applicable"
                          {...field}
                          className="h-11 rounded-lg"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <Label>Expiry date (optional, if applicable)</Label>
                  <DatePicker date={singleExpiryDate} setDate={setSingleExpiryDate} />
                  <p className="text-xs text-muted-foreground">
                    {productEntryMode === "variants"
                      ? "Applies to the whole product; each variant request will include the same expiry when applicable."
                      : "Use when the product has a shelf life or lot expiry."}
                  </p>
                </div>
              </>
            )}

            {inventoryType === "product" && productSubType === "new" && productEntryMode === "variants" && (
              <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-sm font-medium">Variant Builder</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label>Colors (comma separated)</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5">
                              <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Add color names separated by commas. Example: Black, White, Red
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      placeholder="Black, White, Red"
                      value={variantColorInput}
                      onChange={(e) => setVariantColorInput(e.target.value)}
                      className="h-11 rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label>Sizes (comma separated)</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5">
                              <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Add sizes separated by commas. Example: S, M, L, XL
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      placeholder="S, M, L, XL"
                      value={variantSizeInput}
                      onChange={(e) => setVariantSizeInput(e.target.value)}
                      className="h-11 rounded-lg"
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={regenerateVariantRows}>
                  Generate Variants
                </Button>
                {variantRows.length > 0 && (
                  <div className="space-y-2">
                    {variantRows.map((row) => (
                      <div key={row.id} className="space-y-3 rounded-lg border bg-background p-3">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="text-sm">
                            <p className="text-muted-foreground">Color</p>
                            <p className="font-medium">{row.color}</p>
                          </div>
                          <div className="text-sm">
                            <p className="text-muted-foreground">Size</p>
                            <p className="font-medium">{row.size}</p>
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <Label>Variant SKU</Label>
                            <Input
                              value={row.sku}
                              onChange={(e) => updateVariantRow(row.id, { sku: e.target.value })}
                              className="h-10 rounded-lg"
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-1">
                            <Label>Qty</Label>
                            <Input
                              type="number"
                              min="1"
                              value={row.quantity}
                              onChange={(e) =>
                                updateVariantRow(row.id, {
                                  quantity: Math.max(1, Number.parseInt(e.target.value || "1", 10)),
                                })
                              }
                              className="h-10 rounded-lg"
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label className="flex items-center gap-2 text-foreground">
                              <ImagePlus className="h-4 w-4" />
                              Picture for this variant (optional)
                            </Label>
                            <Input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleVariantImageSelect(row.id, e)}
                              className="rounded-lg"
                            />
                            <p className="text-xs text-muted-foreground">
                              Each variant can use a different photo. Max 5 MB, same as the main product upload.
                            </p>
                            {row.imagePreviewUrl && (
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="rounded-lg border bg-muted/20 p-2">
                                  <img
                                    src={row.imagePreviewUrl}
                                    alt={`${row.color} / ${row.size} preview`}
                                    className="h-20 w-20 rounded-md border object-cover"
                                  />
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-muted-foreground"
                                  onClick={() => clearVariantRowImage(row.id)}
                                >
                                  Remove picture
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {((inventoryType === "product" &&
              productSubType === "new" &&
              productEntryMode !== "variants") ||
              inventoryType === "box" ||
              inventoryType === "pallet") && (
              <div className="space-y-2">
                <Label htmlFor="productImage" className="flex items-center gap-2">
                  <ImagePlus className="h-4 w-4" />
                  {inventoryType === "box"
                    ? "Box Picture (Optional)"
                    : inventoryType === "pallet"
                      ? "Pallet Picture (Optional)"
                      : "Product Picture (Optional)"}
                </Label>
                <Input
                  id="productImage"
                  type="file"
                  accept="image/*"
                  onChange={handleProductImageSelect}
                  className="rounded-lg"
                />
                <p className="text-xs text-muted-foreground">
                  {inventoryType === "box"
                    ? "Upload if available. A default placeholder will be shown when no image is provided."
                    : inventoryType === "pallet"
                      ? "Upload if available. A default placeholder will be shown when no image is provided."
                      : "Upload if available. A default placeholder will be shown when no image is provided."}
                </p>
                {selectedProductImagePreview && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <img
                      src={selectedProductImagePreview}
                      alt="Selected preview"
                      className="h-24 w-24 rounded-md border object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            {!(
              inventoryType === "product" &&
              productSubType === "new" &&
              productEntryMode === "variants"
            ) && (
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
                        className="h-11 rounded-lg"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                      className="min-h-[110px] rounded-lg"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <div className="mt-auto flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg px-5"
            onClick={() => {
              if (mode === "dialog") {
                setOpen(false);
                resetImageStates();
                setVariantColorInput("");
                setVariantSizeInput("");
                clearAllVariantRows();
                setSingleExpiryDate(undefined);
              } else {
                form.reset({
                  inventoryType: "product",
                  productSubType: "new",
                  productEntryMode: "single",
                  productId: "",
                  productName: "",
                  sku: "",
                  containerSize: undefined,
                  quantity: 1,
                  remarks: "",
                  retailIdentifier: "",
                });
                resetImageStates();
                setVariantColorInput("");
                setVariantSizeInput("");
                clearAllVariantRows();
                setSingleExpiryDate(undefined);
              }
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" className="h-10 rounded-lg px-5 shadow-sm" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Request
          </Button>
        </div>
      </form>
    </Form>
  );

  if (mode === "inline") {
    return (
      <div className="flex max-h-[min(85vh,900px)] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="shrink-0 space-y-1 border-b px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Add Inventory Request</h2>
          <p className="text-sm text-muted-foreground">
            Submit an inventory request. Admin will review and approve it.
          </p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{formBody}</div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Inventory
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex h-full max-h-[100dvh] w-full flex-col gap-0 border-l p-0 sm:max-w-xl md:max-w-[50vw]"
      >
        <SheetHeader className="space-y-2 border-b bg-gradient-to-r from-background via-background to-primary/5 px-6 pb-4 pt-6 pr-14 text-left">
          <p className="inline-flex w-fit items-center rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-primary">
            Request Workspace
          </p>
          <SheetTitle className="text-[1.55rem] tracking-tight">Add Inventory Request</SheetTitle>
          <SheetDescription>
            Submit an inventory request. Admin will review and approve it.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">{formBody}</div>
      </SheetContent>
    </Sheet>
  );
}

