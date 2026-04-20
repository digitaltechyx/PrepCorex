"use client";

import { useState, useMemo, useEffect } from "react";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, UserPricing, ServiceType, PackageType, QuantityRange, ProductType, UserStoragePricing, StorageType, UserBoxForwardingPricing, UserPalletForwardingPricing, UserContainerHandlingPricing, ContainerSize, UserAdditionalServicesPricing } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { collection, addDoc, updateDoc, doc, Timestamp, writeBatch } from "firebase/firestore";
import type { AdditionalServiceCatalogItem } from "@/lib/additional-services-catalog";
import { DEFAULT_ADDITIONAL_SERVICES, catalogFromPricingDoc } from "@/lib/additional-services-catalog";
import { Users, ChevronsUpDown, Search, X, Loader2, Save } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";

interface PricingManagementProps {
  users: UserProfile[];
}

type AdditionalServiceItem = AdditionalServiceCatalogItem;

type FbaPackAddOnPricingDoc = {
  id: string;
  userId?: string;
  pack2to3?: number;
  pack4to12?: number;
  updatedAt?: any;
  createdAt?: any;
};

// Pre-defined combinations for pricing
// FBA/WFS/TFS: 6 rows (3 monthly-volume tiers x 2 product types)
const FBA_PACKAGES = [
  { package: "Starter" as PackageType, quantityRange: "1-999" as QuantityRange },
  { package: "Standard" as PackageType, quantityRange: "1000-2499" as QuantityRange },
  { package: "Premium" as PackageType, quantityRange: "2500+" as QuantityRange },
];
// FBM: 8 rows (4 packages Ã— 2 product types)
// Premium (101+), Small Business (50+), Standard (25+), Starter (<25)
const FBM_PACKAGES = [
  { package: "Tier 1" as PackageType, quantityRange: "1-10" as QuantityRange },
  { package: "Tier 2" as PackageType, quantityRange: "11-24" as QuantityRange },
  { package: "Tier 3" as PackageType, quantityRange: "25-49" as QuantityRange },
  { package: "Tier 4" as PackageType, quantityRange: "50+" as QuantityRange },
];
const PRODUCT_TYPES: ProductType[] = ["Standard", "Large"]; // Removed Custom

const DEFAULT_FBA_RATES: Record<string, number> = {
  "1-999|Standard": 0.65,
  "1000-2499|Standard": 0.45,
  "2500+|Standard": 0.35,
  "1-999|Large": 0.85,
  "1000-2499|Large": 0.65,
  "2500+|Large": 0.5,
};
const DEFAULT_FBM_RATES: Record<string, number> = {
  "1-10|Standard": 2.25,
  "11-24|Standard": 2.0,
  "25-49|Standard": 1.75,
  "50+|Standard": 1.5,
  "1-10|Large": 2.5,
  "11-24|Large": 2.25,
  "25-49|Large": 2.0,
  "50+|Large": 1.75,
};

interface PricingRow {
  service: ServiceType;
  package: PackageType;
  quantityRange: QuantityRange;
  productType: ProductType;
  rate: string;
  packOf: string;
  pricingId?: string; // For existing pricing rules
}

export function PricingManagement({ users }: PricingManagementProps) {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pricingRows, setPricingRows] = useState<PricingRow[]>([]);
  const [activeTab, setActiveTab] = useState<string>("FBA/WFS/TFS");
  const [storagePrice, setStoragePrice] = useState<string>("");
  const [palletCount, setPalletCount] = useState<string>("");
  const [storagePricingId, setStoragePricingId] = useState<string | null>(null);
  const [adminSelectedStorageType, setAdminSelectedStorageType] = useState<StorageType | "">("");
  const [isSavingStorageType, setIsSavingStorageType] = useState(false);
  
  // Box Forwarding Pricing
  const [boxForwardingPrice, setBoxForwardingPrice] = useState<string>("");
  const [boxForwardingPricingId, setBoxForwardingPricingId] = useState<string | null>(null);
  
  // Pallet Forwarding Pricing
  const [palletForwardingPrice, setPalletForwardingPrice] = useState<string>("");
  const [palletForwardingPricingId, setPalletForwardingPricingId] = useState<string | null>(null);
  
  // Container Handling Pricing
  const [container20ftPrice, setContainer20ftPrice] = useState<string>("");
  const [container20ftPricingId, setContainer20ftPricingId] = useState<string | null>(null);
  const [container40ftPrice, setContainer40ftPrice] = useState<string>("");
  const [container40ftPricingId, setContainer40ftPricingId] = useState<string | null>(null);
  
  // Additional Services Pricing (single catalog; legacy bubble/sticker/warning prices sync from catalog on save)
  const [additionalServicesPricingId, setAdditionalServicesPricingId] = useState<string | null>(null);
  const [additionalServiceItems, setAdditionalServiceItems] = useState<AdditionalServiceItem[]>(DEFAULT_ADDITIONAL_SERVICES);
  const [fbaPack2to3, setFbaPack2to3] = useState<string>("0.35");
  const [fbaPack4to12, setFbaPack4to12] = useState<string>("0.75");
  const [fbaPackPricingId, setFbaPackPricingId] = useState<string | null>(null);

  // Filter approved users (excluding admins and deleted users)
  const selectableUsers = useMemo(() => {
    return users
      .filter((user) => user.status !== "deleted")
      .filter((user) => user.status === "approved" || !user.status)
      .filter((user) => user.role !== "admin" && !user.roles?.includes("admin"))
      .sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [users]);

  const selectedUser = selectableUsers.find((u) => u.uid === selectedUserId) || selectableUsers[0];

  // Fetch pricing for selected user
  const { data: pricingList, loading: pricingLoading } = useCollection<UserPricing>(
    selectedUser ? `users/${selectedUser.uid}/pricing` : ""
  );

  // Fetch storage pricing for selected user
  const { data: storagePricingList, loading: storagePricingLoading } = useCollection<UserStoragePricing>(
    selectedUser ? `users/${selectedUser.uid}/storagePricing` : ""
  );
  
  // Fetch box forwarding pricing
  const { data: boxForwardingPricingList, loading: boxForwardingPricingLoading } = useCollection<UserBoxForwardingPricing>(
    selectedUser ? `users/${selectedUser.uid}/boxForwardingPricing` : ""
  );
  
  // Fetch pallet forwarding pricing
  const { data: palletForwardingPricingList, loading: palletForwardingPricingLoading } = useCollection<UserPalletForwardingPricing>(
    selectedUser ? `users/${selectedUser.uid}/palletForwardingPricing` : ""
  );
  
  // Fetch container handling pricing
  const { data: containerHandlingPricingList, loading: containerHandlingPricingLoading } = useCollection<UserContainerHandlingPricing>(
    selectedUser ? `users/${selectedUser.uid}/containerHandlingPricing` : ""
  );
  
  // Fetch additional services pricing
  const { data: additionalServicesPricingList, loading: additionalServicesPricingLoading } = useCollection<UserAdditionalServicesPricing>(
    selectedUser ? `users/${selectedUser.uid}/additionalServicesPricing` : ""
  );
  const { data: fbaPackAddOnPricingList } = useCollection<FbaPackAddOnPricingDoc>(
    selectedUser ? `users/${selectedUser.uid}/fbaPackAddOnPricing` : ""
  );
  
  // Get the most recent storage pricing document
  const latestStoragePricing = useMemo(() => {
    if (!storagePricingList || storagePricingList.length === 0) return null;
    // Sort by updatedAt descending to get the most recent
    const sorted = [...storagePricingList].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' 
        ? new Date(a.updatedAt).getTime() 
        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' 
        ? new Date(b.updatedAt).getTime() 
        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0];
  }, [storagePricingList]);

  // Initialize pricing rows with all combinations
  useEffect(() => {
    if (!selectedUser) return;

    // Generate all combinations
    const allCombinations: PricingRow[] = [];
    
    // FBA/WFS/TFS service: 6 rows (3 tiers x 2 product types)
    FBA_PACKAGES.forEach((pkgInfo) => {
      PRODUCT_TYPES.forEach((productType) => {
        allCombinations.push({
          service: "FBA/WFS/TFS",
          package: pkgInfo.package,
          quantityRange: pkgInfo.quantityRange,
          productType,
          rate: (
            DEFAULT_FBA_RATES[`${pkgInfo.quantityRange}|${productType}`] ?? 0
          ).toFixed(2),
          packOf: "",
        });
      });
    });
    
    // FBM service: 8 rows (4 packages Ã— 2 product types)
    FBM_PACKAGES.forEach((pkgInfo) => {
      PRODUCT_TYPES.forEach((productType) => {
        allCombinations.push({
          service: "FBM",
          package: pkgInfo.package,
          quantityRange: pkgInfo.quantityRange,
          productType,
          rate: (
            DEFAULT_FBM_RATES[`${pkgInfo.quantityRange}|${productType}`] ?? 0
          ).toFixed(2),
          packOf: "",
        });
      });
    });

    // If we have existing pricing, populate the rows
    if (pricingList && pricingList.length > 0) {
      allCombinations.forEach((row) => {
        const existing = pricingList.find(
          (p) =>
            p.service === row.service &&
            p.package === row.package &&
            p.quantityRange === row.quantityRange &&
            p.productType === row.productType
        );
        if (existing) {
          row.rate = existing.rate.toString();
          row.packOf = existing.packOf.toString();
          row.pricingId = existing.id;
        }
      });
    }

    setPricingRows(allCombinations);
  }, [selectedUser, pricingList]);

  // Initialize storage pricing when user changes
  useEffect(() => {
    if (!selectedUser) return;
    
    // Set admin selected storage type from user profile
    const userStorageType = (selectedUser as any).storageType as StorageType | undefined;
    setAdminSelectedStorageType(userStorageType || "");
    
    if (latestStoragePricing) {
      setStoragePrice(latestStoragePricing.price.toString());
      setPalletCount(latestStoragePricing.palletCount?.toString() || "1");
      setStoragePricingId(latestStoragePricing.id);
    } else {
      setStoragePrice("");
      setPalletCount("1");
      setStoragePricingId(null);
    }
  }, [selectedUser, latestStoragePricing]);

  // Get the most recent box forwarding pricing document
  const latestBoxForwardingPricing = useMemo(() => {
    if (!boxForwardingPricingList || boxForwardingPricingList.length === 0) return null;
    const sorted = [...boxForwardingPricingList].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' 
        ? new Date(a.updatedAt).getTime() 
        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' 
        ? new Date(b.updatedAt).getTime() 
        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0];
  }, [boxForwardingPricingList]);

  // Get the most recent pallet forwarding pricing document
  const latestPalletForwardingPricing = useMemo(() => {
    if (!palletForwardingPricingList || palletForwardingPricingList.length === 0) return null;
    const sorted = [...palletForwardingPricingList].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' 
        ? new Date(a.updatedAt).getTime() 
        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' 
        ? new Date(b.updatedAt).getTime() 
        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0];
  }, [palletForwardingPricingList]);

  // Initialize box forwarding pricing when user changes or data loads
  useEffect(() => {
    if (!selectedUser) {
      setBoxForwardingPrice("");
      setBoxForwardingPricingId(null);
      return;
    }
    
    // Wait for data to load - don't reset if still loading
    if (boxForwardingPricingLoading) {
      return;
    }
    
    // Only update if we have pricing data
    if (latestBoxForwardingPricing) {
      const priceValue = latestBoxForwardingPricing.price;
      // Ensure price is properly formatted as string with 2 decimal places
      const priceString = typeof priceValue === 'number' 
        ? priceValue.toFixed(2) 
        : (typeof priceValue === 'string' ? parseFloat(priceValue).toFixed(2) : '0.00');
      
      setBoxForwardingPrice(priceString);
      setBoxForwardingPricingId(latestBoxForwardingPricing.id);
    } else {
      // Only clear if there's no data
      setBoxForwardingPrice("");
      setBoxForwardingPricingId(null);
    }
  }, [selectedUser?.uid, latestBoxForwardingPricing, boxForwardingPricingLoading]);

  // Initialize pallet forwarding pricing when user changes or data loads
  useEffect(() => {
    if (!selectedUser) {
      setPalletForwardingPrice("");
      setPalletForwardingPricingId(null);
      return;
    }
    
    // Wait for data to load
    if (palletForwardingPricingLoading) return;
    
    if (latestPalletForwardingPricing) {
      setPalletForwardingPrice(latestPalletForwardingPricing.price.toString());
      setPalletForwardingPricingId(latestPalletForwardingPricing.id);
    } else {
      setPalletForwardingPrice("");
      setPalletForwardingPricingId(null);
    }
  }, [selectedUser, latestPalletForwardingPricing, palletForwardingPricingLoading]);

  // Get container handling pricing for 20ft and 40ft
  const container20ftPricing = useMemo(() => {
    if (!containerHandlingPricingList || containerHandlingPricingList.length === 0) return null;
    return containerHandlingPricingList.find(p => p.containerSize === '20 feet');
  }, [containerHandlingPricingList]);

  const container40ftPricing = useMemo(() => {
    if (!containerHandlingPricingList || containerHandlingPricingList.length === 0) return null;
    return containerHandlingPricingList.find(p => p.containerSize === '40 feet');
  }, [containerHandlingPricingList]);

  // Initialize container handling pricing when user changes
  useEffect(() => {
    if (!selectedUser) return;
    
    if (container20ftPricing) {
      setContainer20ftPrice(container20ftPricing.price.toString());
      setContainer20ftPricingId(container20ftPricing.id);
    } else {
      setContainer20ftPrice("");
      setContainer20ftPricingId(null);
    }
    
    if (container40ftPricing) {
      setContainer40ftPrice(container40ftPricing.price.toString());
      setContainer40ftPricingId(container40ftPricing.id);
    } else {
      setContainer40ftPrice("");
      setContainer40ftPricingId(null);
    }
  }, [selectedUser, container20ftPricing, container40ftPricing]);

  // Get the most recent additional services pricing
  const latestAdditionalServicesPricing = useMemo(() => {
    if (!additionalServicesPricingList || additionalServicesPricingList.length === 0) return null;
    const sorted = [...additionalServicesPricingList].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' 
        ? new Date(a.updatedAt).getTime() 
        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === 'string' 
        ? new Date(b.updatedAt).getTime() 
        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0];
  }, [additionalServicesPricingList]);
  const latestFbaPackPricing = useMemo(() => {
    if (!fbaPackAddOnPricingList || fbaPackAddOnPricingList.length === 0) return null;
    const sorted = [...fbaPackAddOnPricingList].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === "string"
        ? new Date(a.updatedAt).getTime()
        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === "string"
        ? new Date(b.updatedAt).getTime()
        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    });
    return sorted[0];
  }, [fbaPackAddOnPricingList]);

  // Initialize additional services pricing when user changes
  useEffect(() => {
    if (!selectedUser) return;
    
    if (latestAdditionalServicesPricing) {
      setAdditionalServicesPricingId(latestAdditionalServicesPricing.id);
      setAdditionalServiceItems(catalogFromPricingDoc(latestAdditionalServicesPricing as any));
    } else {
      setAdditionalServicesPricingId(null);
      setAdditionalServiceItems(catalogFromPricingDoc(null));
    }
  }, [selectedUser, latestAdditionalServicesPricing]);

  useEffect(() => {
    if (!selectedUser) return;
    if (latestFbaPackPricing) {
      setFbaPack2to3(
        typeof latestFbaPackPricing.pack2to3 === "number"
          ? latestFbaPackPricing.pack2to3.toFixed(2)
          : "0.35"
      );
      setFbaPack4to12(
        typeof latestFbaPackPricing.pack4to12 === "number"
          ? latestFbaPackPricing.pack4to12.toFixed(2)
          : "0.75"
      );
      setFbaPackPricingId(latestFbaPackPricing.id);
    } else {
      setFbaPack2to3("0.35");
      setFbaPack4to12("0.75");
      setFbaPackPricingId(null);
    }
  }, [selectedUser, latestFbaPackPricing]);

  const handleUserSelect = (user: UserProfile) => {
    setSelectedUserId(user.uid);
    setUserDialogOpen(false);
    setUserSearchQuery("");
  };

  const handleRateChange = (index: number, field: "rate" | "packOf", value: string) => {
    const updated = [...pricingRows];
    updated[index] = { ...updated[index], [field]: value };
    setPricingRows(updated);
  };

  const handleSave = async () => {
    if (!selectedUser) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();

      // Process all rows
      for (const row of pricingRows) {
        // Skip rows with no rate entered
        if (!row.rate || row.rate.trim() === "") continue;

        const rate = parseFloat(row.rate);
        const packOf = parseFloat(row.packOf || "0");

        if (isNaN(rate) || rate < 0) continue;

        const pricingData: any = {
          userId: selectedUser.uid,
          service: row.service,
          package: row.package,
          quantityRange: row.quantityRange,
          productType: row.productType,
          rate,
          packOf: isNaN(packOf) ? 0 : packOf,
          updatedAt: now,
        };
        
        // Remove any undefined values
        Object.keys(pricingData).forEach(key => {
          if (pricingData[key] === undefined) {
            delete pricingData[key];
          }
        });

        if (row.pricingId) {
          // Update existing
          const pricingRef = doc(db, `users/${selectedUser.uid}/pricing`, row.pricingId);
          batch.update(pricingRef, pricingData);
        } else {
          // Create new
          const pricingRef = doc(collection(db, `users/${selectedUser.uid}/pricing`));
          batch.set(pricingRef, {
            ...pricingData,
            createdAt: now,
          });
        }
      }

      await batch.commit();

      const pack2to3 = parseFloat(fbaPack2to3);
      const pack4to12 = parseFloat(fbaPack4to12);
      if (!isNaN(pack2to3) && !isNaN(pack4to12) && pack2to3 >= 0 && pack4to12 >= 0) {
        const packPayload = {
          userId: selectedUser.uid,
          pack2to3,
          pack4to12,
          updatedAt: now,
        };
        if (fbaPackPricingId) {
          await updateDoc(doc(db, `users/${selectedUser.uid}/fbaPackAddOnPricing`, fbaPackPricingId), packPayload);
        } else {
          const created = await addDoc(collection(db, `users/${selectedUser.uid}/fbaPackAddOnPricing`), {
            ...packPayload,
            createdAt: now,
          });
          setFbaPackPricingId(created.id);
        }
      }

      toast({
        title: "Success",
        description: "Pricing rates saved successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save pricing rates.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStorageType = async () => {
    if (!selectedUser || !adminSelectedStorageType) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a storage type.",
      });
      return;
    }

    setIsSavingStorageType(true);
    try {
      const userRef = doc(db, "users", selectedUser.uid);
      await updateDoc(userRef, {
        storageType: adminSelectedStorageType,
      });

      toast({
        title: "Success",
        description: "Storage type updated successfully.",
      });

      // Refresh selected user data by updating the state
      setSelectedUserId(selectedUser.uid);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update storage type.",
      });
    } finally {
      setIsSavingStorageType(false);
    }
  };

  const handleSaveBoxForwarding = async () => {
    if (!selectedUser) return;

    if (!boxForwardingPrice || boxForwardingPrice.trim() === "") {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a box forwarding price.",
      });
      return;
    }

    const price = parseFloat(boxForwardingPrice);
    if (isNaN(price) || price < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid price.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const pricingData = {
        userId: selectedUser.uid,
        price,
        updatedAt: now,
      };

      if (boxForwardingPricingId) {
        const pricingRef = doc(db, `users/${selectedUser.uid}/boxForwardingPricing`, boxForwardingPricingId);
        await updateDoc(pricingRef, pricingData);
        // Ensure state reflects the saved value (format with 2 decimal places)
        setBoxForwardingPrice(price.toFixed(2));
      } else {
        const docRef = await addDoc(collection(db, `users/${selectedUser.uid}/boxForwardingPricing`), {
          ...pricingData,
          createdAt: now,
        });
        // Update state with the new document ID so future saves will update instead of creating
        setBoxForwardingPricingId(docRef.id);
        // Ensure state reflects the saved value (format with 2 decimal places)
        setBoxForwardingPrice(price.toFixed(2));
      }

      toast({
        title: "Success",
        description: "Box forwarding pricing saved successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save box forwarding pricing.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePalletForwarding = async () => {
    if (!selectedUser) return;

    if (!palletForwardingPrice || palletForwardingPrice.trim() === "") {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a pallet forwarding price.",
      });
      return;
    }

    const price = parseFloat(palletForwardingPrice);
    if (isNaN(price) || price < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid price.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const pricingData = {
        userId: selectedUser.uid,
        price,
        updatedAt: now,
      };

      if (palletForwardingPricingId) {
        const pricingRef = doc(db, `users/${selectedUser.uid}/palletForwardingPricing`, palletForwardingPricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        const docRef = await addDoc(collection(db, `users/${selectedUser.uid}/palletForwardingPricing`), {
          ...pricingData,
          createdAt: now,
        });
        // Update state with the new document ID so future saves will update instead of creating
        setPalletForwardingPricingId(docRef.id);
      }

      toast({
        title: "Success",
        description: "Pallet forwarding pricing saved successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save pallet forwarding pricing.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveContainerHandling = async (containerSize: ContainerSize, priceStr: string, pricingId: string | null) => {
    if (!selectedUser) return;

    if (!priceStr || priceStr.trim() === "") {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Please enter a price for ${containerSize} container.`,
      });
      return;
    }

    const price = parseFloat(priceStr);
    if (isNaN(price) || price < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid price.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const pricingData = {
        userId: selectedUser.uid,
        containerSize,
        price,
        updatedAt: now,
      };

      if (pricingId) {
        const pricingRef = doc(db, `users/${selectedUser.uid}/containerHandlingPricing`, pricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        await addDoc(collection(db, `users/${selectedUser.uid}/containerHandlingPricing`), {
          ...pricingData,
          createdAt: now,
        });
      }

      toast({
        title: "Success",
        description: `${containerSize} container handling pricing saved successfully.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || `Failed to save ${containerSize} container handling pricing.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAdditionalServices = async () => {
    if (!selectedUser) return;

    const invalidRow = additionalServiceItems.some(
      (svc) =>
        !String(svc.key || "").trim() ||
        !String(svc.name || "").trim() ||
        !Number.isFinite(Number(svc.price)) ||
        Number(svc.price) < 0
    );
    if (invalidRow) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Each service needs a name, key, and a valid non-negative price.",
      });
      return;
    }

    const priceForKey = (key: string, fallback: number) => {
      const row = additionalServiceItems.find((s) => s.key === key);
      const p = row != null ? Number(row.price) : NaN;
      return Number.isFinite(p) && p >= 0 ? p : fallback;
    };
    const bubbleWrap = priceForKey("bubbleWrap", 0.35);
    const stickerRemoval = priceForKey("stickerRemoval", 0.15);
    const warningLabel = priceForKey("warningLabels", 0.15);

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const cleanedExtraServices = additionalServiceItems
        .filter((svc) => svc.key && svc.name)
        .map((svc) => ({
          key: svc.key,
          name: svc.name,
          price: Number.isFinite(Number(svc.price)) ? Number(svc.price) : 0,
          description: svc.description || "",
          isDefault: !!svc.isDefault,
        }));
      const pricingData = {
        userId: selectedUser.uid,
        bubbleWrapPrice: bubbleWrap,
        stickerRemovalPrice: stickerRemoval,
        warningLabelPrice: warningLabel,
        extraServices: cleanedExtraServices,
        updatedAt: now,
      };

      if (additionalServicesPricingId) {
        const pricingRef = doc(db, `users/${selectedUser.uid}/additionalServicesPricing`, additionalServicesPricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        await addDoc(collection(db, `users/${selectedUser.uid}/additionalServicesPricing`), {
          ...pricingData,
          createdAt: now,
        });
      }

      toast({
        title: "Success",
        description: "Additional services pricing saved successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save additional services pricing.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStorage = async () => {
    if (!selectedUser) return;

    // Use admin selected storage type if user doesn't have one, otherwise use user's
    const userStorageType = (selectedUser as any).storageType as StorageType | undefined;
    const storageTypeToUse = userStorageType || (adminSelectedStorageType as StorageType);
    
    if (!storageTypeToUse) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please assign a storage type first.",
      });
      return;
    }

    if (!storagePrice || storagePrice.trim() === "") {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a storage price.",
      });
      return;
    }

    const price = parseFloat(storagePrice);
    if (isNaN(price) || price < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid price.",
      });
      return;
    }

    // Validate pallet count for pallet_base storage
    if (storageTypeToUse === "pallet_base") {
      const palletCountNum = parseFloat(palletCount || "1");
      if (isNaN(palletCountNum) || palletCountNum < 1) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Please enter a valid number of pallets (minimum 1).",
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const storagePricingData: any = {
        userId: selectedUser.uid,
        storageType: storageTypeToUse,
        price,
        updatedAt: now,
      };

      // Add palletCount only for pallet_base storage
      if (storageTypeToUse === "pallet_base") {
        const palletCountNum = parseFloat(palletCount || "1");
        storagePricingData.palletCount = palletCountNum;
      }

      if (storagePricingId) {
        // Update existing
        const storagePricingRef = doc(db, `users/${selectedUser.uid}/storagePricing`, storagePricingId);
        await updateDoc(storagePricingRef, storagePricingData);
      } else {
        // Create new
        await addDoc(collection(db, `users/${selectedUser.uid}/storagePricing`), {
          ...storagePricingData,
          createdAt: now,
        });
      }

      toast({
        title: "Success",
        description: "Storage pricing saved successfully.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save storage pricing.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter users based on search
  const filteredUsers = useMemo(() => {
    if (!userSearchQuery.trim()) return selectableUsers;
    const query = userSearchQuery.toLowerCase();
    return selectableUsers.filter(
      (user) =>
        user.name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.clientId?.toLowerCase().includes(query)
    );
  }, [selectableUsers, userSearchQuery]);

  // Set default selected user
  useEffect(() => {
    if (!selectedUserId && selectableUsers.length > 0) {
      setSelectedUserId(selectableUsers[0].uid);
    }
  }, [selectableUsers, selectedUserId]);

  return (
    <div className="space-y-6">
      {/* User Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            User Pricing Management
          </CardTitle>
          <CardDescription>
            Enter pricing rates for users. Leave empty to skip a combination.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label className="text-sm font-medium mb-2 block">Select User</Label>
              <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Select User</DialogTitle>
                    <DialogDescription>Choose a user to manage their pricing</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                      {userSearchQuery && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                          onClick={() => setUserSearchQuery("")}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto space-y-1">
                      {filteredUsers.map((user) => (
                        <Button
                          key={user.uid}
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => handleUserSelect(user)}
                        >
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{formatUserDisplayName(user, { showEmail: false })}</span>
                            <span className="text-xs text-muted-foreground">{user.email}</span>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => setUserDialogOpen(true)}
              >
                <span>
                  {selectedUser
                    ? formatUserDisplayName(selectedUser, { showEmail: true })
                    : "Select a user"}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Form */}
      {selectedUser && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Pricing Rates for {selectedUser.name}</CardTitle>
                <CardDescription>
                  Enter rates for each combination. Only filled rates will be saved.
                </CardDescription>
              </div>
              <Button onClick={handleSave} disabled={isSaving || pricingLoading}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save All Rates
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {pricingLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value)} className="w-full">
                <div className="overflow-x-auto mb-4">
                  <TabsList className="inline-flex min-w-full w-auto h-auto p-1 bg-muted rounded-lg">
                    <TabsTrigger 
                      value="FBA/WFS/TFS" 
                      className="data-[state=active]:bg-blue-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      FBA/WFS/TFS
                    </TabsTrigger>
                    <TabsTrigger 
                      value="FBM" 
                      className="data-[state=active]:bg-purple-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      FBM
                    </TabsTrigger>
                    <TabsTrigger 
                      value="Storage" 
                      className="data-[state=active]:bg-green-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      Storage
                    </TabsTrigger>
                    <TabsTrigger 
                      value="Box Forwarding" 
                      className="data-[state=active]:bg-orange-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      Box Forwarding
                    </TabsTrigger>
                    <TabsTrigger 
                      value="Pallet Forwarding" 
                      className="data-[state=active]:bg-red-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      Pallet Forwarding
                    </TabsTrigger>
                    <TabsTrigger 
                      value="Container Handling" 
                      className="data-[state=active]:bg-teal-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      Container Handling
                    </TabsTrigger>
                    <TabsTrigger 
                      value="Additional Services" 
                      className="data-[state=active]:bg-pink-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2"
                    >
                      Additional Services
                    </TabsTrigger>
                  </TabsList>
                </div>
                
                <TabsContent value="FBA/WFS/TFS" className="mt-4">
                  <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                    <div className="mb-2 font-semibold">Pack add-on pricing (applies to shipment calculations)</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-blue-800">Pack 2-3 ($)</Label>
                        <Input
                          type="text"
                          value={fbaPack2to3}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || /^\d*\.?\d*$/.test(value)) setFbaPack2to3(value);
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (value && !isNaN(parseFloat(value))) setFbaPack2to3(parseFloat(value).toFixed(2));
                          }}
                          className="h-8 w-28 bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-blue-800">Pack 4-12 ($)</Label>
                        <Input
                          type="text"
                          value={fbaPack4to12}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === "" || /^\d*\.?\d*$/.test(value)) setFbaPack4to12(value);
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (value && !isNaN(parseFloat(value))) setFbaPack4to12(parseFloat(value).toFixed(2));
                          }}
                          className="h-8 w-28 bg-white"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    {([
                      { title: "Standard Units", productType: "Standard" as const },
                      { title: "Large/Heavy Units", productType: "Large" as const },
                    ]).map((plan) => (
                      <Card
                        key={plan.title}
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 pb-3">
                          <CardTitle className="text-xl text-blue-700">{plan.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5 p-5 text-sm">
                          <div className="grid grid-cols-2 gap-3 border-b pb-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly Volume</div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Price</div>
                            {([
                              { pkg: "Starter", range: "1-999", label: "1-999 units" },
                              { pkg: "Standard", range: "1000-2499", label: "1,000-2,499 units" },
                              { pkg: "Premium", range: "2500+", label: "2,500+ units" },
                            ]).map((tier) => {
                              const globalIndex = pricingRows.findIndex(
                                (r) =>
                                  r.service === "FBA/WFS/TFS" &&
                                  r.package === tier.pkg &&
                                  r.quantityRange === tier.range &&
                                  r.productType === plan.productType
                              );
                              const row = globalIndex >= 0 ? pricingRows[globalIndex] : null;
                              return (
                                <div key={`${plan.productType}-${tier.range}`} className="contents">
                                  <div className="text-[15px]">{tier.label}</div>
                                  <div>
                                    <Input
                                      type="text"
                                      placeholder="0.00"
                                      value={row?.rate ?? ""}
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        if (globalIndex >= 0 && (value === "" || /^\d*\.?\d*$/.test(value))) {
                                          handleRateChange(globalIndex, "rate", value);
                                        }
                                      }}
                                      onBlur={(e) => {
                                        if (globalIndex < 0) return;
                                        const value = e.target.value;
                                        if (value && !isNaN(parseFloat(value))) {
                                          handleRateChange(globalIndex, "rate", parseFloat(value).toFixed(2));
                                        } else if (value === "") {
                                          handleRateChange(globalIndex, "rate", "");
                                        }
                                      }}
                                      className="h-8 w-28"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                            <div className="mb-2 text-sm font-semibold text-emerald-800">Pack Add-on Pricing</div>
                            <div className="text-sm text-emerald-900">${(parseFloat(fbaPack2to3 || "0") || 0).toFixed(2)} for pack 2-3</div>
                            <div className="text-sm text-emerald-900">${(parseFloat(fbaPack4to12 || "0") || 0).toFixed(2)} for pack 4-12</div>
                          </div>

                          <div>
                            <div className="mb-2 text-sm font-semibold">What's Included</div>
                            <div className="space-y-1.5 text-[15px]">
                              {[
                                "Receiving & inspection",
                                "Labeling & standard prep",
                                "Packaging & forwarding",
                                "24-72 hour turnaround",
                              ].map((item) => (
                                <div key={item} className="flex items-start gap-2">
                                  <span className="mt-0.5 text-emerald-600">{"\u2713"}</span>
                                  <span>{item}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="FBM" className="mt-4">
                  <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                    <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-indigo-50 pb-3">
                      <CardTitle className="text-xl text-violet-700">FBM Fulfillment Plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5 p-5 text-sm">
                      <div className="relative overflow-hidden rounded-lg border border-amber-300/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 px-3 py-2.5 text-sm text-amber-900 shadow-sm">
                        <div className="pointer-events-none absolute -left-10 top-0 h-full w-1/3 -skew-x-12 bg-white/40 blur-sm animate-pulse" />
                        <div className="relative flex items-start gap-2">
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 animate-pulse" />
                          <div className="space-y-0.5">
                            <div className="font-medium">
                              Example notice: You are currently in <span className="font-semibold">25-49 orders/day</span>{" "}
                              {"->"}
                              <span className="font-semibold"> $1.75 </span> (Standard)
                            </div>
                            <div>
                              Reach <span className="font-semibold">50+ orders/day</span> to unlock:
                              <span className="font-semibold"> $1.50 </span> pricing.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 border-b pb-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Volume (Daily)</div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Price (Standard)</div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Large Items</div>
                        {([
                          { pkg: "Tier 1", range: "1-10", label: "1-10" },
                          { pkg: "Tier 2", range: "11-24", label: "11-24" },
                          { pkg: "Tier 3", range: "25-49", label: "25-49" },
                          { pkg: "Tier 4", range: "50+", label: "50+" },
                        ]).map((tier) => {
                          const standardIndex = pricingRows.findIndex(
                            (r) =>
                              r.service === "FBM" &&
                              r.package === tier.pkg &&
                              r.quantityRange === tier.range &&
                              r.productType === "Standard"
                          );
                          const largeIndex = pricingRows.findIndex(
                            (r) =>
                              r.service === "FBM" &&
                              r.package === tier.pkg &&
                              r.quantityRange === tier.range &&
                              r.productType === "Large"
                          );
                          const standardRow = standardIndex >= 0 ? pricingRows[standardIndex] : null;
                          const largeRow = largeIndex >= 0 ? pricingRows[largeIndex] : null;
                          return (
                            <div key={tier.range} className="contents">
                              <div className="text-[15px]">{tier.label}</div>
                              <div>
                                <Input
                                  type="text"
                                  placeholder="0.00"
                                  value={standardRow?.rate ?? ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (standardIndex >= 0 && (value === "" || /^\d*\.?\d*$/.test(value))) {
                                      handleRateChange(standardIndex, "rate", value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (standardIndex < 0) return;
                                    const value = e.target.value;
                                    if (value && !isNaN(parseFloat(value))) {
                                      handleRateChange(standardIndex, "rate", parseFloat(value).toFixed(2));
                                    } else if (value === "") {
                                      handleRateChange(standardIndex, "rate", "");
                                    }
                                  }}
                                  className="h-8 w-28"
                                />
                              </div>
                              <div>
                                <Input
                                  type="text"
                                  placeholder="0.00"
                                  value={largeRow?.rate ?? ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (largeIndex >= 0 && (value === "" || /^\d*\.?\d*$/.test(value))) {
                                      handleRateChange(largeIndex, "rate", value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (largeIndex < 0) return;
                                    const value = e.target.value;
                                    if (value && !isNaN(parseFloat(value))) {
                                      handleRateChange(largeIndex, "rate", parseFloat(value).toFixed(2));
                                    } else if (value === "") {
                                      handleRateChange(largeIndex, "rate", "");
                                    }
                                  }}
                                  className="h-8 w-28"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div>
                        <div className="mb-2 text-sm font-semibold">What's Included</div>
                        <div className="space-y-1.5 text-[15px]">
                          {[
                            "Pick, pack, packaging, labeling",
                            "Same-day shipping (before cutoff)",
                            "24-48 hr guaranteed turnaround",
                          ].map((item) => (
                            <div key={item} className="flex items-start gap-2">
                              <span className="mt-0.5 text-emerald-600">{"\u2713"}</span>
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="Storage" className="mt-4">
                  {storagePricingLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 border rounded-lg bg-muted/50">
                        <div className="space-y-4">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">
                              Storage Type *
                            </Label>
                            <div className="flex items-center gap-2">
                              <Select
                                value={adminSelectedStorageType}
                                onValueChange={(value) => setAdminSelectedStorageType(value as StorageType)}
                              >
                                <SelectTrigger className="w-64">
                                  <SelectValue placeholder="Select storage type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="product_base">Product Base Storage</SelectItem>
                                  <SelectItem value="pallet_base">Pallet Base Storage</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                onClick={handleSaveStorageType}
                                disabled={isSavingStorageType || !adminSelectedStorageType}
                                size="sm"
                                variant="outline"
                              >
                                {isSavingStorageType ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  "Save Type"
                                )}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {adminSelectedStorageType === "product_base"
                                ? "Product Base: Charged per item in inventory (first month free for new items)"
                                : adminSelectedStorageType === "pallet_base"
                                ? "Pallet Base: Monthly charge = Number of Pallets × Price per Pallet"
                                : "Assign a storage type to this user"}
                            </p>
                          </div>
                          
                          {adminSelectedStorageType && (
                            <>
                              <div className="pt-2 border-t">
                                <Label className="text-sm font-medium mb-2 block">
                                  Storage Type
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  {adminSelectedStorageType === "product_base" 
                                    ? "Product Base Storage - Charged per item in inventory"
                                    : "Pallet Base Storage - Monthly charge = Number of Pallets × Price per Pallet"}
                                </p>
                              </div>
                              <div>
                                <Label className="text-sm font-medium mb-2 block">
                                  {adminSelectedStorageType === "product_base" 
                                    ? "Price per Product ($)"
                                    : "Price per Pallet ($)"}
                                </Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={storagePrice}
                                  onChange={(e) => setStoragePrice(e.target.value)}
                                  className="w-48"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {adminSelectedStorageType === "product_base"
                                    ? "This amount will be charged per item in inventory each month (first month free for new items)."
                                    : "Price per individual pallet."}
                                </p>
                              </div>
                              
                              {adminSelectedStorageType === "pallet_base" && (
                                <div>
                                  <Label className="text-sm font-medium mb-2 block">
                                    Number of Pallets *
                                  </Label>
                                  <Input
                                    type="number"
                                    step="1"
                                    min="1"
                                    placeholder="1"
                                    value={palletCount}
                                    onChange={(e) => setPalletCount(e.target.value)}
                                    className="w-48"
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Number of pallets assigned to this user. Monthly invoice will be: (Number of Pallets × Price per Pallet).
                                  </p>
                                </div>
                              )}
                              
                              <Button 
                                onClick={handleSaveStorage} 
                                disabled={isSaving || storagePricingLoading || !adminSelectedStorageType}
                                className="w-48"
                              >
                                {isSaving ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save Storage Pricing
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="Box Forwarding" className="mt-4">
                  {boxForwardingPricingLoading ? (
                    <div className="space-y-4">
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 border rounded-lg bg-muted/50">
                        <div className="space-y-4">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">
                              Price per Box ($)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={boxForwardingPrice}
                              onChange={(e) => setBoxForwardingPrice(e.target.value)}
                              className="w-48"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              This amount will be charged per box when user ships boxes.
                            </p>
                          </div>
                          <Button 
                            onClick={handleSaveBoxForwarding} 
                            disabled={isSaving || boxForwardingPricingLoading}
                            className="w-auto min-w-fit whitespace-nowrap"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Box Forwarding Pricing
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="Pallet Forwarding" className="mt-4">
                  <div className="space-y-6">
                    {/* Pallet Forwarding Section */}
                    <div className="p-4 border rounded-lg bg-muted/50">
                      <h3 className="text-lg font-semibold mb-4">Pallet Forwarding</h3>
                      {palletForwardingPricingLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">
                              Price per Pallet ($)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={palletForwardingPrice}
                              onChange={(e) => setPalletForwardingPrice(e.target.value)}
                              className="w-48"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              This amount will be charged per pallet when user ships pallets (forwarding).
                            </p>
                          </div>
                          <Button 
                            onClick={handleSavePalletForwarding} 
                            disabled={isSaving || palletForwardingPricingLoading}
                            className="w-auto min-w-fit whitespace-nowrap"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Pallet Forwarding Pricing
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>

                  </div>
                </TabsContent>

                <TabsContent value="Container Handling" className="mt-4">
                  <div className="space-y-6">
                    {/* 20 Feet Container Section */}
                    <div className="p-4 border rounded-lg bg-muted/50">
                      <h3 className="text-lg font-semibold mb-4">20 Feet Container</h3>
                      {containerHandlingPricingLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">
                              Price per 20 Feet Container ($)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={container20ftPrice}
                              onChange={(e) => setContainer20ftPrice(e.target.value)}
                              className="w-48"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              This amount will be charged per 20 feet container when user adds container handling inventory.
                            </p>
                          </div>
                          <Button 
                            onClick={() => handleSaveContainerHandling('20 feet', container20ftPrice, container20ftPricingId)} 
                            disabled={isSaving || containerHandlingPricingLoading}
                            className="w-48"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save 20ft Pricing
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* 40 Feet Container Section */}
                    <div className="p-4 border rounded-lg bg-muted/50">
                      <h3 className="text-lg font-semibold mb-4">40 Feet Container</h3>
                      {containerHandlingPricingLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <Label className="text-sm font-medium mb-2 block">
                              Price per 40 Feet Container ($)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={container40ftPrice}
                              onChange={(e) => setContainer40ftPrice(e.target.value)}
                              className="w-48"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              This amount will be charged per 40 feet container when user adds container handling inventory.
                            </p>
                          </div>
                          <Button 
                            onClick={() => handleSaveContainerHandling('40 feet', container40ftPrice, container40ftPricingId)} 
                            disabled={isSaving || containerHandlingPricingLoading}
                            className="w-48"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save 40ft Pricing
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="Additional Services" className="mt-4">
                  <div className="space-y-6">
                    {additionalServicesPricingLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : (
                      <div className="p-4 border rounded-lg bg-muted/50">
                        <div className="space-y-4">
                          <p className="text-xs text-muted-foreground">
                            Edit all rates in the catalog. Bubble Wrap, Sticker Removal, and Warning Labels stay aligned
                            with legacy billing fields when you save.
                          </p>
                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-semibold">Service Catalog (Shipment Dropdown)</h4>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const next = additionalServiceItems.length + 1;
                                  setAdditionalServiceItems((prev) => [
                                    ...prev,
                                    {
                                      key: `customService${next}`,
                                      name: `Custom Service ${next}`,
                                      price: 0,
                                      description: "Per item",
                                      isDefault: false,
                                    },
                                  ]);
                                }}
                              >
                                Add Service
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {additionalServiceItems.map((svc, index) => (
                                <div key={`${svc.key}-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
                                  <Input
                                    value={svc.name}
                                    onChange={(e) =>
                                      setAdditionalServiceItems((prev) =>
                                        prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item))
                                      )
                                    }
                                    placeholder="Service name"
                                    disabled={svc.isDefault}
                                  />
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={svc.price}
                                    onChange={(e) =>
                                      setAdditionalServiceItems((prev) =>
                                        prev.map((item, i) =>
                                          i === index ? { ...item, price: parseFloat(e.target.value || "0") || 0 } : item
                                        )
                                      )
                                    }
                                    placeholder="0.00"
                                  />
                                  <Input
                                    value={svc.description || ""}
                                    onChange={(e) =>
                                      setAdditionalServiceItems((prev) =>
                                        prev.map((item, i) => (i === index ? { ...item, description: e.target.value } : item))
                                      )
                                    }
                                    placeholder="Description"
                                  />
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">{svc.isDefault ? "Default" : "Custom"}</span>
                                    {!svc.isDefault && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive"
                                        onClick={() =>
                                          setAdditionalServiceItems((prev) => prev.filter((_, i) => i !== index))
                                        }
                                      >
                                        Remove
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <Button 
                            onClick={handleSaveAdditionalServices} 
                            disabled={isSaving || additionalServicesPricingLoading}
                            className="w-auto min-w-fit whitespace-nowrap"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Additional Services Pricing
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

