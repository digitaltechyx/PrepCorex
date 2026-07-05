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
import { Archive, Boxes, CircleHelp, ImagePlus, Loader2, Package, Plus, Trash2, Truck, Upload } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import type { InventoryType, UserContainerHandlingPricing } from "@/types";
import { CONTAINER_SIZE_OPTIONS } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem } from "@/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InboundBulkImportDialog } from "@/components/dashboard/inbound-bulk-import-dialog";
import { InboundBulkRestockDialog } from "@/components/dashboard/inbound-bulk-restock-dialog";
import { filterRestockEligibleProducts } from "@/lib/inbound-bulk-restock";
import {
  InboundBatchDraftReview,
  type InboundDraftLine,
} from "@/components/dashboard/inbound-batch-draft-review";
import {
  bulkRowToLineInput,
  INBOUND_LOAD_CONTENTS_OPTIONS,
  INBOUND_SHIPMENT_TYPES,
  submitInboundBatch,
  type InboundBatchLineInput,
} from "@/lib/inbound-batch";
import {
  INBOUND_BACKGROUND_IMPORT_THRESHOLD,
  processInboundImportJob,
  startInboundImportJob,
} from "@/lib/inbound-import-job";
import type { InboundBulkValidatedRow } from "@/lib/inbound-bulk-import";
import type { InboundLoadContents, InboundShipmentType } from "@/types";
import {
  EMPTY_INBOUND_TRACKING,
  InboundTrackingFields,
  type InboundTrackingInput,
} from "@/components/inventory/inbound-tracking-fields";
import { addInboundTrackingToRequests } from "@/lib/inbound-tracking-client";

type VariantRowState = {
  id: string;
  color: string;
  size: string;
  sku: string;
  quantity: number;
  trackingNumber: string;
  carrier: string;
  /** Optional photo for this variant only (not shared across variants). */
  imageFile?: File;
  imagePreviewUrl?: string;
};

type NewProductRowState = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  retailIdentifier: string;
  remarks: string;
  trackingNumber: string;
  carrier: string;
  expiryDate?: Date;
  imageFile?: File;
  imagePreviewUrl?: string;
};

function createEmptyNewProductRow(): NewProductRowState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productName: "",
    sku: "",
    quantity: 1,
    retailIdentifier: "",
    remarks: "",
    trackingNumber: "",
    carrier: "usps",
  };
}

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
  containerSize: z.enum(CONTAINER_SIZE_OPTIONS).optional(), // For container type (optional)
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
  // For new product, productName required except single mode (validated per product row on submit)
  if (data.inventoryType === "product" && data.productSubType === "new") {
    if (data.productEntryMode === "single" || data.productEntryMode === "variants") {
      return true;
    }
    if (!data.productName || data.productName.trim() === "") {
      return false;
    }
    if (!data.sku || data.sku.trim() === "") {
      return false;
    }
  }
  return true;
}, {
  message: "Product name is required for new products.",
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
  const [newProductRows, setNewProductRows] = useState<NewProductRowState[]>([createEmptyNewProductRow()]);
  const [singleExpiryDate, setSingleExpiryDate] = useState<Date | undefined>(undefined);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkRestockImportOpen, setBulkRestockImportOpen] = useState(false);
  const [shipmentType, setShipmentType] = useState<InboundShipmentType | "">("");
  const [loadContents, setLoadContents] = useState<InboundLoadContents | "">("");
  const [productNotes, setProductNotes] = useState("");
  const [draftLines, setDraftLines] = useState<InboundDraftLine[]>([]);
  const [inboundTrackingMode, setInboundTrackingMode] = useState<"shared" | "per_item">("shared");
  const [sharedInboundTracking, setSharedInboundTracking] =
    useState<InboundTrackingInput>(EMPTY_INBOUND_TRACKING);

  // Fetch existing inventory for restock dropdown
  const { data: existingInventory } = useCollection<InventoryItem>(
    ownerId ? `users/${ownerId}/inventory` : ""
  );

  const availableProductsForRestock = useMemo(
    () => filterRestockEligibleProducts(existingInventory),
    [existingInventory]
  );

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

  const clearAllNewProductRows = () => {
    setNewProductRows((prev) => {
      for (const row of prev) {
        if (row.imagePreviewUrl) URL.revokeObjectURL(row.imagePreviewUrl);
      }
      return [createEmptyNewProductRow()];
    });
  };

  const resetInboundTrackingState = () => {
    setInboundTrackingMode("shared");
    setSharedInboundTracking(EMPTY_INBOUND_TRACKING);
  };

  const addNewProductRow = () => {
    setNewProductRows((prev) => [...prev, createEmptyNewProductRow()]);
  };

  const updateNewProductRow = (
    id: string,
    patch: Partial<Omit<NewProductRowState, "id">>
  ) => {
    setNewProductRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeNewProductRow = (id: string) => {
    setNewProductRows((prev) => {
      if (prev.length <= 1) return prev;
      const removed = prev.find((row) => row.id === id);
      if (removed?.imagePreviewUrl) URL.revokeObjectURL(removed.imagePreviewUrl);
      return prev.filter((row) => row.id !== id);
    });
  };

  const handleNewProductImageSelect = (rowId: string, event: ChangeEvent<HTMLInputElement>) => {
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
    setNewProductRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        if (row.imagePreviewUrl) URL.revokeObjectURL(row.imagePreviewUrl);
        return {
          ...row,
          imageFile: file,
          imagePreviewUrl: URL.createObjectURL(file),
        };
      })
    );
  };

  useEffect(() => {
    if (
      inventoryType === "product" &&
      productSubType === "new" &&
      productEntryMode === "single" &&
      newProductRows.length === 0
    ) {
      setNewProductRows([createEmptyNewProductRow()]);
    }
  }, [inventoryType, productSubType, productEntryMode, newProductRows.length]);

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
          trackingNumber: prev?.trackingNumber ?? "",
          carrier: prev?.carrier ?? "usps",
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
    patch: Partial<Omit<VariantRowState, "id">>
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

  async function submitDraftBatch() {
    if (!user || !ownerId || draftLines.length === 0) return;
    setIsLoading(true);
    try {
      const lines = draftLines.map(({ draftId: _draftId, ...line }) => line);
      if (lines.length >= INBOUND_BACKGROUND_IMPORT_THRESHOLD) {
        const idToken = await user.getIdToken();
        const jobId = await startInboundImportJob({
          userId: ownerId,
          userName: ownerName,
          requestedBy: user.uid,
          shipmentType: shipmentType || undefined,
          loadContents: isContainerOnlyDraft ? loadContents || undefined : undefined,
          productNotes: isContainerOnlyDraft ? productNotes.trim() || undefined : undefined,
          lines,
          idToken,
        });
        void processInboundImportJob({ userId: ownerId, jobId, idToken }).catch(() => undefined);
        toast({
          title: "Import started",
          description: `Processing ${lines.length} rows in the background. Progress is shown on the inventory page.`,
        });
      } else {
        await submitInboundBatch({
          userId: ownerId,
          userName: ownerName,
          shipmentType: shipmentType || undefined,
          loadContents: isContainerOnlyDraft ? loadContents || undefined : undefined,
          productNotes: isContainerOnlyDraft ? productNotes.trim() || undefined : undefined,
          lines,
        });
        toast({
          title: "Success",
          description: `Inbound batch submitted (${draftLines.length} items). Waiting for admin approval.`,
        });
      }
      setDraftLines([]);
      setShipmentType("");
      setLoadContents("");
      setProductNotes("");
      resetInboundTrackingState();
      if (mode === "dialog") setOpen(false);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit inbound batch.",
      });
    } finally {
      setIsLoading(false);
    }
  }

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

      const isMultiNewProductSingle =
        values.inventoryType === "product" &&
        values.productSubType === "new" &&
        values.productEntryMode === "single";

      const createsMultipleRequests =
        (isVariantsNewProduct && variantRows.length > 1) ||
        (isMultiNewProductSingle && newProductRows.length > 1);
      const usePerItemTracking = createsMultipleRequests && inboundTrackingMode === "per_item";

      let finalImageUrls: string[] = [];
      if (
        (values.inventoryType === "product" &&
          values.productSubType === "new" &&
          !isVariantsNewProduct &&
          !isMultiNewProductSingle) ||
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

      const batchLines: InboundBatchLineInput[] = [];

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

        for (const row of variantRows) {
          const line: InboundBatchLineInput = {
            inventoryType: values.inventoryType,
            productSubType: "new",
            productEntryMode: "variants",
            productName: finalProductName,
            sku: row.sku.trim(),
            quantity: row.quantity,
            requestedQuantity: row.quantity,
            color: row.color,
            size: row.size,
            variantLabel: `${row.color} / ${row.size}`,
            parentProductName: finalProductName,
          };
          if (values.retailIdentifier?.trim()) {
            line.retailIdentifier = values.retailIdentifier.trim();
          }
          const productExpiry = optionalExpiryTimestampFromParts(undefined, singleExpiryDate);
          if (productExpiry) line.expiryDate = productExpiry;
          if (row.imageFile) {
            const urls = await uploadInventoryImageFile(ownerId, row.imageFile);
            line.imageUrls = urls;
            line.imageUrl = urls[0];
          }
          if (usePerItemTracking && row.trackingNumber.trim()) {
            line.trackingNumber = row.trackingNumber.trim();
            line.carrier = row.carrier;
          } else if (!usePerItemTracking && sharedInboundTracking.trackingNumber.trim()) {
            line.trackingNumber = sharedInboundTracking.trackingNumber.trim();
            line.carrier = sharedInboundTracking.carrier;
          }
          batchLines.push(line);
        }
      } else if (isMultiNewProductSingle) {
        const invalidRow = newProductRows.find(
          (row) => !row.productName.trim() || !row.sku.trim() || row.quantity <= 0
        );
        if (invalidRow) {
          toast({
            variant: "destructive",
            title: "Invalid products",
            description: "Each product requires a name, SKU, and quantity greater than 0.",
          });
          setIsLoading(false);
          return;
        }

        const seenSkus = new Set<string>();
        for (const row of newProductRows) {
          const normalizedSku = row.sku.trim().toLowerCase();
          if (seenSkus.has(normalizedSku)) {
            toast({
              variant: "destructive",
              title: "Duplicate SKU",
              description: `SKU "${row.sku}" appears more than once.`,
            });
            setIsLoading(false);
            return;
          }
          seenSkus.add(normalizedSku);
        }

        const dupCheck = await checkSkusAndIdentifiersInFirestore(
          newProductRows.map((row) => ({
            sku: row.sku,
            retailIdentifier: row.retailIdentifier?.trim(),
          }))
        );
        if (!dupCheck.ok) {
          toast({
            variant: "destructive",
            title: "Already exists",
            description: dupCheck.message,
          });
          setIsLoading(false);
          return;
        }

        for (const row of newProductRows) {
          const rowImageUrls = row.imageFile
            ? await uploadInventoryImageFile(ownerId, row.imageFile)
            : [];
          const rowExpiry = optionalExpiryTimestampFromParts(undefined, row.expiryDate);
          const line: InboundBatchLineInput = {
            inventoryType: values.inventoryType,
            productSubType: "new",
            productEntryMode: "single",
            productName: row.productName.trim(),
            sku: row.sku.trim(),
            quantity: row.quantity,
            requestedQuantity: row.quantity,
          };
          if (row.retailIdentifier?.trim()) line.retailIdentifier = row.retailIdentifier.trim();
          if (row.remarks?.trim()) line.remarks = row.remarks.trim();
          if (rowExpiry) line.expiryDate = rowExpiry;
          if (rowImageUrls.length > 0) {
            line.imageUrls = rowImageUrls;
            line.imageUrl = rowImageUrls[0];
          }
          if (usePerItemTracking && row.trackingNumber.trim()) {
            line.trackingNumber = row.trackingNumber.trim();
            line.carrier = row.carrier;
          } else if (!usePerItemTracking && sharedInboundTracking.trackingNumber.trim()) {
            line.trackingNumber = sharedInboundTracking.trackingNumber.trim();
            line.carrier = sharedInboundTracking.carrier;
          }
          batchLines.push(line);
        }
      } else {
        const line: InboundBatchLineInput = {
          inventoryType: values.inventoryType,
          productName: finalProductName,
          quantity: values.quantity,
          requestedQuantity: values.quantity,
        };
        if (values.inventoryType === "product" && values.productSubType) {
          line.productSubType = values.productSubType;
        }
        if (values.productId) line.productId = values.productId;
        if (values.inventoryType === "product" && values.productSubType === "new" && values.sku) {
          line.sku = values.sku;
        } else if (values.inventoryType === "product" && values.productSubType === "restock" && values.productId) {
          const selectedProduct = availableProductsForRestock.find((p) => p.id === values.productId);
          if (selectedProduct && (selectedProduct as InventoryItem & { sku?: string }).sku) {
            line.sku = (selectedProduct as InventoryItem & { sku?: string }).sku;
          }
        }
        if (values.retailIdentifier?.trim()) line.retailIdentifier = values.retailIdentifier.trim();
        if (values.remarks?.trim()) line.remarks = values.remarks.trim();
        if (values.containerSize) line.containerSize = values.containerSize;
        const singleEx = optionalExpiryTimestampFromParts(undefined, singleExpiryDate);
        if (singleEx) line.expiryDate = singleEx;
        if (finalImageUrls.length > 0) {
          line.imageUrls = finalImageUrls;
          line.imageUrl = finalImageUrls[0];
        }
        if (sharedInboundTracking.trackingNumber.trim()) {
          line.trackingNumber = sharedInboundTracking.trackingNumber.trim();
          line.carrier = sharedInboundTracking.carrier;
        }
        batchLines.push(line);
      }

      const isContainerBatch = batchLines.every((line) => line.inventoryType === "container");

      await submitInboundBatch({
        userId: ownerId,
        userName: ownerName,
        shipmentType: shipmentType || undefined,
        loadContents: isContainerBatch ? loadContents || undefined : undefined,
        productNotes: isContainerBatch ? productNotes.trim() || undefined : undefined,
        lines: batchLines,
      });

      const submittedCount = batchLines.length;

      toast({
        title: "Success",
        description:
          submittedCount > 1
            ? `Inbound batch submitted (${submittedCount} items). Waiting for admin approval.`
            : "Inbound batch submitted. Waiting for admin approval.",
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
      clearAllNewProductRows();
      setSingleExpiryDate(undefined);
      setShipmentType("");
      setLoadContents("");
      setProductNotes("");
      resetInboundTrackingState();
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
        return "Carton forwarding (Cross-Dock)";
      case "pallet":
        return "Pallet forwarding (Crossdock)";
      case "container":
        return "Container handling (receiving)";
      default:
        return type;
    }
  };

  const getNameLabel = (type: InventoryType) => {
    switch (type) {
      case "product":
        return "Product Name";
      case "box":
        return "Carton Name/ID";
      case "pallet":
        return "Pallet Name/ID";
      case "container":
        return "Container ID";
      default:
        return "Name";
    }
  };

  const handleBulkRowsImported = async (
    rows: InboundBulkValidatedRow[],
    onProgress?: (progress: { processed: number; total: number }) => void
  ) => {
    const chunkSize = 1000;
    const importId = Date.now();
    onProgress?.({ processed: 0, total: rows.length });

    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      setDraftLines((prev) => [
        ...prev,
        ...chunk.map((row) => ({
          draftId: `draft-${row.rowNumber}-${importId}-${Math.random().toString(36).slice(2, 7)}`,
          ...bulkRowToLineInput(row),
        })),
      ]);

      const processed = Math.min(start + chunk.length, rows.length);
      onProgress?.({ processed, total: rows.length });

      // Yield between chunks so the browser can paint progress and stay responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };

  const createsMultipleInboundRequests =
    (inventoryType === "product" &&
      productSubType === "new" &&
      productEntryMode === "variants" &&
      variantRows.length > 1) ||
    (inventoryType === "product" &&
      productSubType === "new" &&
      productEntryMode === "single" &&
      newProductRows.length > 1);

  const isContainerOnlyDraft = useMemo(
    () => draftLines.length > 0 && draftLines.every((line) => line.inventoryType === "container"),
    [draftLines]
  );

  useEffect(() => {
    if (inventoryType !== "container" && !isContainerOnlyDraft) {
      setLoadContents("");
      setProductNotes("");
    }
  }, [inventoryType, isContainerOnlyDraft]);

  const containerHandlingFields = (
    <div className="space-y-4 rounded-xl border bg-card/90 p-4 shadow-sm">
      <div className="space-y-2">
        <Label className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          What&apos;s inside? <span className="font-normal normal-case">(optional)</span>
        </Label>
        <p className="text-xs text-muted-foreground">Cartons, pallets, or both in this container.</p>
        <Select
          value={loadContents || "none"}
          onValueChange={(v) => setLoadContents(v === "none" ? "" : (v as InboundLoadContents))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select contents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not specified</SelectItem>
            {INBOUND_LOAD_CONTENTS_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "both" ? "Carton & pallet" : option.charAt(0).toUpperCase() + option.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Description <span className="font-normal normal-case">(recommended)</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          Tell us what you are sending — product types, mix of SKUs, quantities, or anything we should know.
        </p>
        <Textarea
          value={productNotes}
          onChange={(e) => setProductNotes(e.target.value)}
          placeholder="e.g. 200 units restock across 15 SKUs, fragile items, mixed cartons and pallets…"
          rows={3}
          className="resize-y min-h-[80px]"
        />
      </div>
    </div>
  );

  const formBody = (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-background to-muted/20"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="space-y-5">
            <div className="space-y-2 rounded-xl border bg-card/90 p-4 shadow-sm">
              <Label className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                Shipment type <span className="font-normal normal-case">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">How is your inventory coming?</p>
              <Select
                value={shipmentType || "none"}
                onValueChange={(v) => setShipmentType(v === "none" ? "" : (v as InboundShipmentType))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select shipment type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {INBOUND_SHIPMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <InboundBatchDraftReview
              lines={draftLines}
              onRemove={(draftId) => setDraftLines((prev) => prev.filter((l) => l.draftId !== draftId))}
              onClear={() => setDraftLines([])}
            />

            {isContainerOnlyDraft && draftLines.length > 0 ? containerHandlingFields : null}

            {draftLines.length === 0 ? (
            <>
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
                          Carton forwarding (Cross-Dock)
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="pallet" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Boxes className="h-4 w-4 text-violet-600" />
                          Pallet forwarding (Crossdock)
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center rounded-lg border bg-background px-3 py-2 space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="container" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer flex items-center gap-2">
                          <Truck className="h-4 w-4 text-cyan-600" />
                          Container handling (receiving)
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
                            Restock
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
                            clearAllNewProductRows();
                          } else {
                            setSelectedProductImageFile(null);
                            setSelectedProductImagePreview("");
                            clearAllNewProductRows();
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
                            Product without variant
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
              <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/20 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Bulk restock</p>
                  <p className="text-xs text-muted-foreground">
                    Download a CSV with your SKUs, fill quantities, and add multiple restock lines at once.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setBulkRestockImportOpen(true)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Bulk restock import
                </Button>
              </div>
            )}
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
              <>
              <FormField
                control={form.control}
                name="containerSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Container Size <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
                    <Select 
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="h-11 rounded-lg">
                          <SelectValue placeholder="Select container size (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONTAINER_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={size}>
                            {size.replace(" feet", " Feet")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {draftLines.length === 0 ? containerHandlingFields : null}
              </>
            )}

            {/* Product Name - hidden in single new product mode (use product rows instead) */}
            {(inventoryType !== "product" || productSubType === "new") &&
              !(inventoryType === "product" && productSubType === "new" && productEntryMode === "single") && (
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

            {/* New products (single mode) — add multiple products one by one */}
            {inventoryType === "product" && productSubType === "new" && productEntryMode === "single" && (
              <div className="space-y-3 rounded-xl border bg-card/90 p-4 shadow-sm">
                <Label className="text-sm font-medium">Products *</Label>
                <div className="space-y-3">
                  {newProductRows.map((row, index) => (
                    <div key={row.id} className="space-y-3 rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">Product {index + 1}</span>
                        {newProductRows.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => removeNewProductRow(row.id)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Remove
                          </Button>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">Product Name *</Label>
                          <Input
                            placeholder="Enter product name"
                            value={row.productName}
                            onChange={(e) => updateNewProductRow(row.id, { productName: e.target.value })}
                            className="h-11 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">SKU *</Label>
                          <Input
                            placeholder="Enter SKU"
                            value={row.sku}
                            onChange={(e) => updateNewProductRow(row.id, { sku: e.target.value })}
                            className="h-11 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Quantity *</Label>
                          <Input
                            type="number"
                            min="1"
                            value={row.quantity}
                            onChange={(e) =>
                              updateNewProductRow(row.id, {
                                quantity: Math.max(1, Number.parseInt(e.target.value || "1", 10)),
                              })
                            }
                            className="h-11 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            UPC / EAN / FNSKU / ASIN (optional)
                          </Label>
                          <Input
                            placeholder="Enter one identifier if applicable"
                            value={row.retailIdentifier}
                            onChange={(e) =>
                              updateNewProductRow(row.id, { retailIdentifier: e.target.value })
                            }
                            className="h-11 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">
                            Expiry date (optional)
                          </Label>
                          <DatePicker
                            date={row.expiryDate}
                            setDate={(date) => updateNewProductRow(row.id, { expiryDate: date })}
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-xs text-muted-foreground">Remarks (optional)</Label>
                          <Textarea
                            placeholder="Notes for this product only"
                            value={row.remarks}
                            onChange={(e) => updateNewProductRow(row.id, { remarks: e.target.value })}
                            className="min-h-[72px] rounded-lg text-sm"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <ImagePlus className="h-4 w-4" />
                            Product picture (optional)
                          </Label>
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleNewProductImageSelect(row.id, e)}
                            className="rounded-lg"
                          />
                          {row.imagePreviewUrl && (
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <img
                                src={row.imagePreviewUrl}
                                alt={`${row.productName || "Product"} preview`}
                                className="h-24 w-24 rounded-md border object-cover"
                              />
                            </div>
                          )}
                        </div>
                        {createsMultipleInboundRequests && inboundTrackingMode === "per_item" && (
                          <div className="space-y-1 border-t pt-3">
                            <Label className="text-xs font-medium text-muted-foreground">
                              Shipment tracking (optional)
                            </Label>
                            <InboundTrackingFields
                              compact
                              idPrefix={`product-trk-${row.id}`}
                              value={{
                                trackingNumber: row.trackingNumber,
                                carrier: row.carrier,
                              }}
                              onChange={(next) =>
                                updateNewProductRow(row.id, {
                                  trackingNumber: next.trackingNumber,
                                  carrier: next.carrier,
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Each product has its own expiry, picture, and remarks. Use Add Product for another item.
                </p>
                <div className="flex justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={addNewProductRow}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add Product
                  </Button>
                </div>
              </div>
            )}

            {inventoryType === "product" && productSubType === "new" && productEntryMode !== "single" && (
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
                        {createsMultipleInboundRequests && inboundTrackingMode === "per_item" && (
                          <div className="space-y-1 border-t pt-3">
                            <Label className="text-xs font-medium text-muted-foreground">
                              Shipment tracking (optional)
                            </Label>
                            <InboundTrackingFields
                              compact
                              idPrefix={`variant-trk-${row.id}`}
                              value={{
                                trackingNumber: row.trackingNumber,
                                carrier: row.carrier,
                              }}
                              onChange={(next) =>
                                updateVariantRow(row.id, {
                                  trackingNumber: next.trackingNumber,
                                  carrier: next.carrier,
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {((inventoryType === "product" &&
              productSubType === "new" &&
              productEntryMode !== "variants" &&
              productEntryMode !== "single") ||
              inventoryType === "box" ||
              inventoryType === "pallet") && (
              <div className="space-y-2">
                <Label htmlFor="productImage" className="flex items-center gap-2">
                  <ImagePlus className="h-4 w-4" />
                  {inventoryType === "box"
                    ? "Carton Picture (Optional)"
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
              (productEntryMode === "variants" || productEntryMode === "single")
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

            <div className="space-y-3 rounded-xl border bg-card/90 p-4 shadow-sm">
              <div>
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Truck className="h-4 w-4" />
                  Inbound shipment tracking (optional)
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uses the same tracking as the inventory table. Carrier status refreshes every 6 hours.
                </p>
              </div>

              {createsMultipleInboundRequests && (
                <RadioGroup
                  value={inboundTrackingMode}
                  onValueChange={(v) => setInboundTrackingMode(v as "shared" | "per_item")}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="shared" id="inbound-trk-shared" />
                    <Label htmlFor="inbound-trk-shared" className="font-normal">
                      One tracking number for all items in this submission
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="per_item" id="inbound-trk-per-item" />
                    <Label htmlFor="inbound-trk-per-item" className="font-normal">
                      Separate tracking per item
                    </Label>
                  </div>
                </RadioGroup>
              )}

              {(!createsMultipleInboundRequests || inboundTrackingMode === "shared") && (
                <InboundTrackingFields
                  idPrefix="inbound-trk-shared"
                  value={sharedInboundTracking}
                  onChange={setSharedInboundTracking}
                />
              )}

              {createsMultipleInboundRequests && inboundTrackingMode === "per_item" && (
                <p className="text-xs text-muted-foreground">
                  Enter tracking on each product or variant card above.
                </p>
              )}
            </div>

            {!(
              inventoryType === "product" &&
              productSubType === "new" &&
              productEntryMode === "single"
            ) && (
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
            )}
            </>
            ) : (
              <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Your imported items are listed above. Review them, then submit one inbound batch to admin.
              </p>
            )}
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
                clearAllNewProductRows();
                setSingleExpiryDate(undefined);
                resetInboundTrackingState();
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
                clearAllNewProductRows();
                setSingleExpiryDate(undefined);
                resetInboundTrackingState();
              }
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type={draftLines.length > 0 ? "button" : "submit"}
            className="h-10 rounded-lg px-5 shadow-sm"
            disabled={isLoading}
            onClick={draftLines.length > 0 ? () => void submitDraftBatch() : undefined}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {draftLines.length > 0
              ? `Submit batch (${draftLines.length})`
              : "Submit Request"}
          </Button>
        </div>
      </form>
    </Form>
  );

  if (mode === "inline") {
    return (
      <>
        <div className="flex max-h-[min(85vh,900px)] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="shrink-0 space-y-1 border-b px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">Add Inventory Request</h2>
                <p className="text-sm text-muted-foreground">
                  Submit an inventory request. Admin will review and approve it.
                </p>
              </div>
              {!(inventoryType === "product" && productSubType === "restock") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setBulkImportOpen(true)}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  Import
                </Button>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{formBody}</div>
        </div>
        <InboundBulkImportDialog
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
          ownerId={ownerId}
          ownerName={ownerName}
          onRowsImported={handleBulkRowsImported}
        />
        <InboundBulkRestockDialog
          open={bulkRestockImportOpen}
          onOpenChange={setBulkRestockImportOpen}
          inventory={existingInventory}
          onRowsImported={handleBulkRowsImported}
        />
      </>
    );
  }

  return (
    <>
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
          <div className="flex items-start justify-between gap-3 pr-2">
            <p className="inline-flex w-fit items-center rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-primary">
              Request Workspace
            </p>
            {!(inventoryType === "product" && productSubType === "restock") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 -mt-0.5"
                onClick={() => setBulkImportOpen(true)}
              >
                <Upload className="mr-1.5 h-4 w-4" />
                Import
              </Button>
            )}
          </div>
          <SheetTitle className="text-[1.55rem] tracking-tight">Add Inventory Request</SheetTitle>
          <SheetDescription>
            Submit an inventory request. Admin will review and approve it.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">{formBody}</div>
      </SheetContent>
    </Sheet>
    <InboundBulkImportDialog
      open={bulkImportOpen}
      onOpenChange={setBulkImportOpen}
      ownerId={ownerId}
      ownerName={ownerName}
      onRowsImported={handleBulkRowsImported}
    />
    <InboundBulkRestockDialog
      open={bulkRestockImportOpen}
      onOpenChange={setBulkRestockImportOpen}
      inventory={existingInventory}
      onRowsImported={handleBulkRowsImported}
    />
    </>
  );
}

