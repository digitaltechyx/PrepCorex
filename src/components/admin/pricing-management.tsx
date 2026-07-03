"use client";

import { useState, useMemo, useEffect } from "react";
import { useCollection } from "@/hooks/use-collection";
import { usePricingProfileSettings } from "@/hooks/use-pricing-profile-settings";
import type { UserProfile, UserPricing, ServiceType, PackageType, QuantityRange, ProductType, UserStoragePricing, StorageType, UserBoxForwardingPricing, UserPalletForwardingPricing, UserContainerHandlingPricing, ContainerSize, UserAdditionalServicesPricing } from "@/types";
import { CONTAINER_SIZE_OPTIONS } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import { formatUserDisplayName } from "@/lib/format-user-display";
import {
  CUSTOM_PRICING_PROFILE_OPTION,
  GLOBAL_PRICING_PROFILES,
  customProfileIdForUser,
  getPricingProfileCollectionPath,
  getPricingProfileLabel,
  resolveUserPricingProfileId,
} from "@/lib/pricing-profiles";
import {
  DEFAULT_FBA_INCLUDED_ITEMS,
  DEFAULT_FBM_INCLUDED_ITEMS,
  getPricingProfileSettingsPath,
  includedItemsToText,
  parseIncludedItemsText,
} from "@/lib/pricing-profile-settings";
import { collection, addDoc, updateDoc, doc, Timestamp, writeBatch, setDoc } from "firebase/firestore";
import type { AdditionalServiceCatalogItem } from "@/lib/additional-services-catalog";
import { DEFAULT_ADDITIONAL_SERVICES, catalogFromPricingDoc } from "@/lib/additional-services-catalog";
import { Users, ChevronsUpDown, Search, X, Loader2, Save, UserPlus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";

interface PricingManagementProps {
  users: UserProfile[];
}

type AdditionalServiceItem = AdditionalServiceCatalogItem;

type PalletStorageCycleLite = {
  id: string;
  status?: string;
  source?: string;
  assignedAt?: any;
  createdAt?: any;
};

const PALLET_CYCLE_THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function cycleTimeMs(v: any): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (typeof v?.seconds === "number") return v.seconds * 1000;
  return 0;
}

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
const PRODUCT_TYPES: ProductType[] = ["Standard"];

type ContainerPriceState = { price: string; pricingId: string | null };

function emptyContainerPrices(): Record<ContainerSize, ContainerPriceState> {
  return {
    "20 feet": { price: "", pricingId: null },
    "40 feet": { price: "", pricingId: null },
    "53 feet": { price: "", pricingId: null },
  };
}

const DEFAULT_FBA_RATES: Record<string, number> = {
  "1-999|Standard": 0.65,
  "1000-2499|Standard": 0.45,
  "2500+|Standard": 0.35,
};
const DEFAULT_FBM_RATES: Record<string, number> = {
  "1-10|Standard": 2.25,
  "11-24|Standard": 2.0,
  "25-49|Standard": 1.75,
  "50+|Standard": 1.5,
};

interface PricingRow {
  service: ServiceType;
  package: PackageType;
  quantityRange: QuantityRange;
  productType: ProductType;
  rate: string;
  pricingId?: string; // For existing pricing rules
}

export function PricingManagement({ users }: PricingManagementProps) {
  const { toast } = useToast();
  const { userProfile: adminUserProfile } = useAuth();
  const [selectedProfileSlug, setSelectedProfileSlug] = useState<string>("standard");
  const [customUserId, setCustomUserId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [pricingRows, setPricingRows] = useState<PricingRow[]>([]);
  const [activeTab, setActiveTab] = useState<string>("FBA/WFS/TFS");
  const [storagePrice, setStoragePrice] = useState<string>("");
  const [storagePricingId, setStoragePricingId] = useState<string | null>(null);
  const [adminSelectedStorageType, setAdminSelectedStorageType] = useState<StorageType | "">("");
  const [isSavingStorageType, setIsSavingStorageType] = useState(false);
  const [manualAssignQty, setManualAssignQty] = useState("1");
  const [manualRemoveQty, setManualRemoveQty] = useState("1");
  const [isMutatingPallets, setIsMutatingPallets] = useState(false);
  
  // Box Forwarding Pricing
  const [boxForwardingPrice, setBoxForwardingPrice] = useState<string>("");
  const [boxForwardingPricingId, setBoxForwardingPricingId] = useState<string | null>(null);
  
  // Pallet Forwarding Pricing
  const [palletForwardingPrice, setPalletForwardingPrice] = useState<string>("");
  const [palletForwardingPricingId, setPalletForwardingPricingId] = useState<string | null>(null);
  
  // Container Handling Pricing
  const [containerPrices, setContainerPrices] = useState<Record<ContainerSize, ContainerPriceState>>(
    emptyContainerPrices
  );
  
  // Additional Services Pricing (single catalog; legacy bubble/sticker/warning prices sync from catalog on save)
  const [additionalServicesPricingId, setAdditionalServicesPricingId] = useState<string | null>(null);
  const [additionalServiceItems, setAdditionalServiceItems] = useState<AdditionalServiceItem[]>(DEFAULT_ADDITIONAL_SERVICES);

  const [isMigratingProfiles, setIsMigratingProfiles] = useState(false);
  const [fbaIncludedText, setFbaIncludedText] = useState(includedItemsToText(undefined, DEFAULT_FBA_INCLUDED_ITEMS));
  const [fbmIncludedText, setFbmIncludedText] = useState(includedItemsToText(undefined, DEFAULT_FBM_INCLUDED_ITEMS));
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignSearchQuery, setAssignSearchQuery] = useState("");
  const [selectedAssignUserIds, setSelectedAssignUserIds] = useState<string[]>([]);
  const [isAssigningProfile, setIsAssigningProfile] = useState(false);

  const runPricingProfileMigration = async () => {
    setIsMigratingProfiles(true);
    try {
      const res = await fetch("/api/admin/pricing-profiles/migrate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Migration failed.");
      }
      toast({
        title: "Pricing profiles migrated",
        description: `Seeded ${data.seededCategories ?? 0} categories; updated ${data.usersUpdated ?? 0} users to Standard.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Migration failed",
        description: e instanceof Error ? e.message : "Could not migrate pricing profiles.",
      });
    } finally {
      setIsMigratingProfiles(false);
    }
  };

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
  const editingCustomProfile = selectedProfileSlug === CUSTOM_PRICING_PROFILE_OPTION.id;
  const effectiveProfileId = editingCustomProfile
    ? customUserId
      ? customProfileIdForUser(customUserId)
      : ""
    : selectedProfileSlug;

  const { settings: profileSettings } = usePricingProfileSettings(effectiveProfileId || undefined);

  const usersOnCurrentProfile = useMemo(() => {
    if (!effectiveProfileId) return [];
    return selectableUsers.filter((u) => resolveUserPricingProfileId(u) === effectiveProfileId);
  }, [selectableUsers, effectiveProfileId]);

  const assignDialogUsers = useMemo(() => {
    if (!assignSearchQuery.trim()) return selectableUsers;
    const q = assignSearchQuery.toLowerCase();
    return selectableUsers.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.clientId?.toLowerCase().includes(q)
    );
  }, [selectableUsers, assignSearchQuery]);

  const targetPricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "prep")
    : "";
  const targetStoragePricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "storage")
    : "";
  const targetBoxPricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "boxForwarding")
    : "";
  const targetPalletPricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "palletForwarding")
    : "";
  const targetContainerPricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "containerHandling")
    : "";
  const targetAdditionalPricingPath = effectiveProfileId
    ? getPricingProfileCollectionPath(effectiveProfileId, "additionalServices")
    : "";
  const palletStorageCyclesPath =
    editingCustomProfile && customUserId ? `users/${customUserId}/palletStorageCycles` : "";

  // Fetch pricing for selected user
  const { data: pricingList, loading: pricingLoading } = useCollection<UserPricing>(
    targetPricingPath
  );

  // Fetch storage pricing for selected user
  const { data: storagePricingList, loading: storagePricingLoading } = useCollection<UserStoragePricing>(
    targetStoragePricingPath
  );
  
  // Fetch box forwarding pricing
  const { data: boxForwardingPricingList, loading: boxForwardingPricingLoading } = useCollection<UserBoxForwardingPricing>(
    targetBoxPricingPath
  );
  
  // Fetch pallet forwarding pricing
  const { data: palletForwardingPricingList, loading: palletForwardingPricingLoading } = useCollection<UserPalletForwardingPricing>(
    targetPalletPricingPath
  );
  
  // Fetch container handling pricing
  const { data: containerHandlingPricingList, loading: containerHandlingPricingLoading } = useCollection<UserContainerHandlingPricing>(
    targetContainerPricingPath
  );
  
  // Fetch additional services pricing
  const { data: additionalServicesPricingList, loading: additionalServicesPricingLoading } = useCollection<UserAdditionalServicesPricing>(
    targetAdditionalPricingPath
  );
  const { data: palletStorageCycles } = useCollection<PalletStorageCycleLite>(palletStorageCyclesPath);

  const palletStats = useMemo(() => {
    const list = palletStorageCycles || [];
    const active = list.filter((c) => c.status !== "closed");
    const manual = active.filter((c) => String(c.source || "") === "admin_manual").length;
    return {
      total: active.length,
      manual,
      fromInventory: active.length - manual,
    };
  }, [palletStorageCycles]);
  
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
    if (!effectiveProfileId) return;

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
          row.pricingId = existing.id;
        }
      });
    }

    setPricingRows(allCombinations);
  }, [effectiveProfileId, pricingList]);

  // Initialize storage pricing when user changes
  useEffect(() => {
    if (!effectiveProfileId) return;
    
    // Set admin selected storage type from user profile
    setAdminSelectedStorageType("pallet_base" as StorageType);
    
    if (latestStoragePricing) {
      setStoragePrice(latestStoragePricing.price.toString());
      setStoragePricingId(latestStoragePricing.id);
    } else {
      setStoragePrice("");
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
    if (!effectiveProfileId) {
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
    if (!effectiveProfileId) {
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

  // Initialize container handling pricing when user changes
  useEffect(() => {
    if (!effectiveProfileId) return;

    const next = emptyContainerPrices();
    for (const pricing of containerHandlingPricingList || []) {
      const size = pricing.containerSize as ContainerSize;
      if (size in next) {
        next[size] = { price: pricing.price.toString(), pricingId: pricing.id };
      }
    }
    setContainerPrices(next);
  }, [selectedUser, containerHandlingPricingList, effectiveProfileId]);

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

  // Initialize additional services pricing when user changes
  useEffect(() => {
    if (!effectiveProfileId) return;
    
    if (latestAdditionalServicesPricing) {
      setAdditionalServicesPricingId(latestAdditionalServicesPricing.id);
      setAdditionalServiceItems(catalogFromPricingDoc(latestAdditionalServicesPricing as any));
    } else {
      setAdditionalServicesPricingId(null);
      setAdditionalServiceItems(catalogFromPricingDoc(null));
    }
  }, [selectedUser, latestAdditionalServicesPricing]);

  useEffect(() => {
    if (!effectiveProfileId) return;
    setFbaIncludedText(
      includedItemsToText(profileSettings?.fbaIncludedItems, DEFAULT_FBA_INCLUDED_ITEMS)
    );
    setFbmIncludedText(
      includedItemsToText(profileSettings?.fbmIncludedItems, DEFAULT_FBM_INCLUDED_ITEMS)
    );
  }, [effectiveProfileId, profileSettings]);

  const assignUsersToProfile = async (userIds: string[], profileId: string) => {
    if (!userIds.length || !profileId) return;
    setIsAssigningProfile(true);
    try {
      const batch = writeBatch(db);
      for (const uid of userIds) {
        batch.update(doc(db, "users", uid), { pricingProfileId: profileId });
      }
      await batch.commit();
      toast({
        title: "Profile assigned",
        description: `Updated ${userIds.length} user(s) to ${getPricingProfileLabel(profileId)}.`,
      });
      setAssignDialogOpen(false);
      setSelectedAssignUserIds([]);
      setAssignSearchQuery("");
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Assignment failed",
        description: error instanceof Error ? error.message : "Could not assign profile.",
      });
    } finally {
      setIsAssigningProfile(false);
    }
  };

  const handleUserSelect = async (user: UserProfile) => {
    setSelectedUserId(user.uid);
    setCustomUserId(user.uid);
    setUserDialogOpen(false);
    setUserSearchQuery("");

    if (editingCustomProfile) {
      try {
        await updateDoc(doc(db, "users", user.uid), {
          pricingProfileId: customProfileIdForUser(user.uid),
        });
        toast({
          title: "Custom profile assigned",
          description: `${formatUserDisplayName(user, { showEmail: false })} is now on the Custom pricing plan.`,
        });
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Could not assign Custom profile",
          description: error instanceof Error ? error.message : "Update failed.",
        });
      }
    }
  };

  const openAssignDialog = () => {
    setSelectedAssignUserIds(usersOnCurrentProfile.map((u) => u.uid));
    setAssignSearchQuery("");
    setAssignDialogOpen(true);
  };

  const handleRateChange = (index: number, value: string) => {
    const updated = [...pricingRows];
    updated[index] = { ...updated[index], rate: value };
    setPricingRows(updated);
  };

  const handleSave = async () => {
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const now = Timestamp.now();

      // Process all rows
      for (const row of pricingRows) {
        // Skip rows with no rate entered
        if (!row.rate || row.rate.trim() === "") continue;

        const rate = parseFloat(row.rate);

        if (isNaN(rate) || rate < 0) continue;

        const pricingData: any = {
          userId: ownerId,
          service: row.service,
          package: row.package,
          quantityRange: row.quantityRange,
          productType: row.productType,
          rate,
          packOf: 0,
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
          const pricingRef = doc(db, targetPricingPath, row.pricingId);
          batch.update(pricingRef, pricingData);
        } else {
          // Create new
          const pricingRef = doc(collection(db, targetPricingPath));
          batch.set(pricingRef, {
            ...pricingData,
            createdAt: now,
          });
        }
      }

      await batch.commit();

      await setDoc(
        doc(db, getPricingProfileSettingsPath(ownerId)),
        {
          profileId: ownerId,
          fbaIncludedItems: parseIncludedItemsText(fbaIncludedText),
          fbmIncludedItems: parseIncludedItemsText(fbmIncludedText),
          updatedAt: now,
        },
        { merge: true }
      );

      toast({
        title: "Success",
        description: "Pricing rates and plan details saved successfully.",
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
    if (!editingCustomProfile || !customUserId) {
      toast({
        variant: "destructive",
        title: "Not supported",
        description: "Storage type is user-specific. Select Custom profile and a user first.",
      });
      return;
    }

    setIsSavingStorageType(true);
    try {
      const userRef = doc(db, "users", customUserId);
      await updateDoc(userRef, {
        storageType: "pallet_base",
      });

      setAdminSelectedStorageType("pallet_base" as StorageType);

      toast({
        title: "Success",
        description: "Pallet base storage assigned successfully.",
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
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

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
        userId: ownerId,
        price,
        updatedAt: now,
      };

      if (boxForwardingPricingId) {
        const pricingRef = doc(db, targetBoxPricingPath, boxForwardingPricingId);
        await updateDoc(pricingRef, pricingData);
        // Ensure state reflects the saved value (format with 2 decimal places)
        setBoxForwardingPrice(price.toFixed(2));
      } else {
        const docRef = await addDoc(collection(db, targetBoxPricingPath), {
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
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

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
        userId: ownerId,
        price,
        updatedAt: now,
      };

      if (palletForwardingPricingId) {
        const pricingRef = doc(db, targetPalletPricingPath, palletForwardingPricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        const docRef = await addDoc(collection(db, targetPalletPricingPath), {
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
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

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
        userId: ownerId,
        containerSize,
        price,
        updatedAt: now,
      };

      if (pricingId) {
        const pricingRef = doc(db, targetContainerPricingPath, pricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        await addDoc(collection(db, targetContainerPricingPath), {
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
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

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
        userId: ownerId,
        bubbleWrapPrice: bubbleWrap,
        stickerRemovalPrice: stickerRemoval,
        warningLabelPrice: warningLabel,
        extraServices: cleanedExtraServices,
        updatedAt: now,
      };

      if (additionalServicesPricingId) {
        const pricingRef = doc(db, targetAdditionalPricingPath, additionalServicesPricingId);
        await updateDoc(pricingRef, pricingData);
      } else {
        await addDoc(collection(db, targetAdditionalPricingPath), {
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

  const handleAssignManualPallets = async () => {
    if (!editingCustomProfile || !customUserId || !adminUserProfile?.uid) {
      toast({
        variant: "destructive",
        title: "Not available",
        description: "Select Custom profile and a user to assign pallets.",
      });
      return;
    }
    const n = parseInt(manualAssignQty, 10);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      toast({
        variant: "destructive",
        title: "Invalid quantity",
        description: "Enter a whole number between 1 and 500.",
      });
      return;
    }

    setIsMutatingPallets(true);
    try {
      const uid = customUserId;
      const now = Timestamp.now();
      const nextInvoice = Timestamp.fromMillis(Date.now() + PALLET_CYCLE_THIRTY_DAYS_MS);
      const col = collection(db, `users/${uid}/palletStorageCycles`);

      for (let i = 0; i < n; i += 1) {
        await addDoc(col, {
          status: "active",
          source: "admin_manual",
          assignedAt: now,
          nextInvoiceDate: nextInvoice,
          createdAt: now,
          updatedAt: now,
          assignedBy: adminUserProfile.uid,
          note: "Admin-assigned pallet (manual)",
        });
      }

      const newTotal = palletStats.total + n;
      if (storagePricingId && targetStoragePricingPath) {
        await updateDoc(doc(db, targetStoragePricingPath, storagePricingId), {
          palletCount: newTotal,
          updatedAt: now,
        });
      }

      toast({
        title: "Pallets assigned",
        description: `Added ${n} manual pallet cycle${n === 1 ? "" : "s"}. Next invoice date is 30 days from now for each.`,
      });
      setManualAssignQty("1");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to assign pallets.",
      });
    } finally {
      setIsMutatingPallets(false);
    }
  };

  const handleRemoveManualPallets = async () => {
    if (!editingCustomProfile || !customUserId) {
      toast({
        variant: "destructive",
        title: "Not available",
        description: "Select Custom profile and a user to remove manual pallets.",
      });
      return;
    }
    const n = parseInt(manualRemoveQty, 10);
    if (!Number.isFinite(n) || n < 1) {
      toast({
        variant: "destructive",
        title: "Invalid quantity",
        description: "Enter a whole number of at least 1.",
      });
      return;
    }

    const activeManual = (palletStorageCycles || [])
      .filter((c) => c.status !== "closed" && String(c.source || "") === "admin_manual")
      .sort((a, b) => cycleTimeMs(b.assignedAt || b.createdAt) - cycleTimeMs(a.assignedAt || a.createdAt));

    if (activeManual.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing to remove",
        description: "This user has no active admin-assigned pallets.",
      });
      return;
    }

    const removeCount = Math.min(n, activeManual.length);
    setIsMutatingPallets(true);
    try {
      const uid = customUserId;
      const now = Timestamp.now();
      for (let i = 0; i < removeCount; i += 1) {
        const c = activeManual[i];
        await updateDoc(doc(db, `users/${uid}/palletStorageCycles`, c.id), {
          status: "closed",
          closedAt: now,
          closeReason: "admin_manual_removed",
          updatedAt: now,
        });
      }

      const newTotal = Math.max(0, palletStats.total - removeCount);
      if (storagePricingId && targetStoragePricingPath) {
        await updateDoc(doc(db, targetStoragePricingPath, storagePricingId), {
          palletCount: newTotal,
          updatedAt: now,
        });
      }

      toast({
        title: "Manual pallets removed",
        description: `Closed ${removeCount} admin-assigned pallet cycle${removeCount === 1 ? "" : "s"} (newest first).`,
      });
      setManualRemoveQty("1");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to remove pallets.",
      });
    } finally {
      setIsMutatingPallets(false);
    }
  };

  const handleSaveStorage = async () => {
    if (!effectiveProfileId) return;
    const ownerId = effectiveProfileId;

    const storageTypeToUse: StorageType = "pallet_base";

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

    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const storagePricingData: any = {
        userId: ownerId,
        storageType: storageTypeToUse,
        price,
        palletCount: editingCustomProfile ? palletStats.total : (latestStoragePricing?.palletCount ?? 0),
        updatedAt: now,
      };

      if (storagePricingId) {
        // Update existing
        const storagePricingRef = doc(db, targetStoragePricingPath, storagePricingId);
        await updateDoc(storagePricingRef, storagePricingData);
      } else {
        // Create new
        await addDoc(collection(db, targetStoragePricingPath), {
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
      {/* Profile selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Pricing Profiles
          </CardTitle>
          <CardDescription>
            Edit rates for each pricing profile. Assign profiles to users from user management.
          </CardDescription>
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isMigratingProfiles}
              onClick={() => void runPricingProfileMigration()}
            >
              {isMigratingProfiles ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Migrating…
                </>
              ) : (
                "Seed profiles from legacy defaults"
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {GLOBAL_PRICING_PROFILES.map((profile) => (
              <Button
                key={profile.id}
                type="button"
                variant={selectedProfileSlug === profile.id ? "default" : "outline"}
                onClick={() => setSelectedProfileSlug(profile.id)}
              >
                {profile.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={editingCustomProfile ? "default" : "outline"}
              onClick={() => setSelectedProfileSlug(CUSTOM_PRICING_PROFILE_OPTION.id)}
            >
              {CUSTOM_PRICING_PROFILE_OPTION.label}
            </Button>
          </div>

          {editingCustomProfile && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label className="text-sm font-medium mb-2 block">User for custom profile</Label>
                <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Select user</DialogTitle>
                      <DialogDescription>
                        Choose the user whose custom pricing table you want to edit.
                      </DialogDescription>
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
                              <span className="font-medium">
                                {formatUserDisplayName(user, { showEmail: false })}
                              </span>
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
          )}

          {!editingCustomProfile && (
            <p className="text-sm text-muted-foreground">
              Editing the <span className="font-medium">{getPricingProfileLabel(selectedProfileSlug)}</span>{" "}
              profile. Changes apply to all users assigned to this profile.
            </p>
          )}
        </CardContent>
      </Card>

      {effectiveProfileId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Assign users to this profile
            </CardTitle>
            <CardDescription>
              {editingCustomProfile
                ? "Select a user above to assign Custom and edit their rates. Assignment happens automatically when you pick a user."
                : `${usersOnCurrentProfile.length} client user(s) currently on ${getPricingProfileLabel(selectedProfileSlug)}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!editingCustomProfile && (
              <>
                {usersOnCurrentProfile.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {usersOnCurrentProfile.slice(0, 8).map((user) => (
                      <span
                        key={user.uid}
                        className="rounded-full border bg-muted px-3 py-1 text-xs"
                      >
                        {formatUserDisplayName(user, { showEmail: false })}
                      </span>
                    ))}
                    {usersOnCurrentProfile.length > 8 && (
                      <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                        +{usersOnCurrentProfile.length - 8} more
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No users assigned yet.</p>
                )}
                <Button type="button" variant="outline" size="sm" onClick={openAssignDialog}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Assign users to {getPricingProfileLabel(selectedProfileSlug)}
                </Button>
              </>
            )}
            {editingCustomProfile && selectedUser && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {formatUserDisplayName(selectedUser, { showEmail: true })}
                </span>{" "}
                is selected for custom pricing. Picking a different user re-assigns Custom to that user.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign {getPricingProfileLabel(selectedProfileSlug)} profile</DialogTitle>
            <DialogDescription>
              Selected users will use this profile&apos;s pricing tables and what&apos;s included text.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={assignSearchQuery}
                onChange={(e) => setAssignSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="max-h-[320px] space-y-1 overflow-y-auto">
              {assignDialogUsers.map((user) => {
                const checked = selectedAssignUserIds.includes(user.uid);
                const currentProfile = getPricingProfileLabel(resolveUserPricingProfileId(user));
                return (
                  <label
                    key={user.uid}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        setSelectedAssignUserIds((prev) =>
                          value
                            ? [...prev, user.uid]
                            : prev.filter((id) => id !== user.uid)
                        );
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">
                        {formatUserDisplayName(user, { showEmail: false })}
                      </div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                      <div className="text-xs text-muted-foreground">Current: {currentProfile}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isAssigningProfile || selectedAssignUserIds.length === 0}
                onClick={() => void assignUsersToProfile(selectedAssignUserIds, selectedProfileSlug)}
              >
                {isAssigningProfile ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  `Assign ${selectedAssignUserIds.length} user(s)`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pricing Form */}
      {effectiveProfileId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {editingCustomProfile
                    ? `Custom pricing — ${selectedUser?.name ?? "select user"}`
                    : `${getPricingProfileLabel(selectedProfileSlug)} profile rates`}
                </CardTitle>
                <CardDescription>
                  {editingCustomProfile
                    ? "Special rates for this user only. Selecting a user assigns the Custom profile automatically."
                    : "Enter rates for each service. Only filled rates will be saved."}
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
                  <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                    <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 pb-3">
                      <CardTitle className="text-xl text-blue-700">Standard units</CardTitle>
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
                              r.productType === "Standard"
                          );
                          const row = globalIndex >= 0 ? pricingRows[globalIndex] : null;
                          return (
                            <div key={`Standard-${tier.range}`} className="contents">
                              <div className="text-[15px]">{tier.label}</div>
                              <div>
                                <Input
                                  type="text"
                                  placeholder="0.00"
                                  value={row?.rate ?? ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (globalIndex >= 0 && (value === "" || /^\d*\.?\d*$/.test(value))) {
                                      handleRateChange(globalIndex, value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (globalIndex < 0) return;
                                    const value = e.target.value;
                                    if (value && !isNaN(parseFloat(value))) {
                                      handleRateChange(globalIndex, parseFloat(value).toFixed(2));
                                    }
                                  }}
                                  className="h-9"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">What&apos;s included</Label>
                        <p className="text-xs text-muted-foreground">
                          One item per line. Shown to clients on the FBA pricing tab.
                        </p>
                        <Textarea
                          value={fbaIncludedText}
                          onChange={(e) => setFbaIncludedText(e.target.value)}
                          rows={5}
                          placeholder={"Receiving & inspection\nLabeling & standard prep"}
                          className="resize-y text-sm"
                        />
                      </div>
                    </CardContent>
                  </Card>
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

                      <div className="grid grid-cols-2 gap-3 border-b pb-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Volume (Daily)</div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Price</div>
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
                          const standardRow = standardIndex >= 0 ? pricingRows[standardIndex] : null;
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
                                      handleRateChange(standardIndex, value);
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (standardIndex < 0) return;
                                    const value = e.target.value;
                                    if (value && !isNaN(parseFloat(value))) {
                                      handleRateChange(standardIndex, parseFloat(value).toFixed(2));
                                    } else if (value === "") {
                                      handleRateChange(standardIndex, "");
                                    }
                                  }}
                                  className="h-8 w-28"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-semibold">What&apos;s included</Label>
                        <p className="text-xs text-muted-foreground">
                          One item per line. Shown to clients on the FBM pricing tab.
                        </p>
                        <Textarea
                          value={fbmIncludedText}
                          onChange={(e) => setFbmIncludedText(e.target.value)}
                          rows={5}
                          placeholder={"Pick, pack, packaging, labeling\nSame-day shipping (before cutoff)"}
                          className="resize-y text-sm"
                        />
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
                              Storage Type
                            </Label>
                            <div className="flex items-center gap-2">
                              <Input
                                value="Pallet Base Storage"
                                readOnly
                                className="w-64 bg-muted"
                              />
                              <Button
                                onClick={handleSaveStorageType}
                                disabled={isSavingStorageType}
                                size="sm"
                                variant="outline"
                              >
                                {isSavingStorageType ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  "Assign To User"
                                )}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              Pallet-only storage: inventory auto-creates cycles from in-stock pallets; you can also assign extra pallets manually below. Each active cycle bills every 30 days from its start date.
                            </p>
                          </div>
                          
                          {adminSelectedStorageType && (
                            <>
                              <div className="pt-2 border-t">
                                <Label className="text-sm font-medium mb-2 block">
                                  Storage Type
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                  Pallet Base Storage - Monthly charge = Number of due pallet cycles × Price per pallet
                                </p>
                              </div>
                              <div>
                                <Label className="text-sm font-medium mb-2 block">
                                  Price per Pallet ($)
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
                                  Price per individual pallet per 30-day cycle.
                                </p>
                              </div>
                              {editingCustomProfile && customUserId && (
                                <div className="pt-2 border-t space-y-3">
                                  <div className="text-sm">
                                    <span className="font-medium">Active pallet cycles: </span>
                                    <span className="tabular-nums">{palletStats.total}</span>
                                    <span className="text-muted-foreground"> · </span>
                                    <span className="text-muted-foreground">
                                      {palletStats.fromInventory} from inventory
                                    </span>
                                    <span className="text-muted-foreground"> · </span>
                                    <span className="text-muted-foreground">
                                      {palletStats.manual} admin-assigned
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-end gap-2">
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">Add manual pallets</Label>
                                      <Input
                                        type="number"
                                        min={1}
                                        max={500}
                                        value={manualAssignQty}
                                        onChange={(e) => setManualAssignQty(e.target.value)}
                                        className="w-24 h-9"
                                      />
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={handleAssignManualPallets}
                                      disabled={isMutatingPallets || !adminUserProfile?.uid}
                                    >
                                      {isMutatingPallets ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        "Assign pallets"
                                      )}
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap items-end gap-2">
                                    <div className="space-y-1">
                                      <Label className="text-xs text-muted-foreground">
                                        Remove admin-assigned (newest first)
                                      </Label>
                                      <Input
                                        type="number"
                                        min={1}
                                        value={manualRemoveQty}
                                        onChange={(e) => setManualRemoveQty(e.target.value)}
                                        className="w-24 h-9"
                                      />
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={handleRemoveManualPallets}
                                      disabled={isMutatingPallets}
                                    >
                                      {isMutatingPallets ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        "Remove manual"
                                      )}
                                    </Button>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Manual pallets stay until you remove them or mark cycles closed; inventory sync only adjusts non-manual cycles to match in-stock pallet quantity.
                                  </p>
                                </div>
                              )}
                              <Button 
                                onClick={handleSaveStorage} 
                                disabled={isSaving || storagePricingLoading}
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
                  <div className="p-4 border rounded-lg bg-muted/50">
                    <h3 className="text-lg font-semibold mb-2">Container Handling Pricing</h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      Set the price charged per container when a user adds container handling inventory.
                    </p>
                    {containerHandlingPricingLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr className="border-b bg-muted">
                              <th className="text-left p-2 text-sm font-medium">Container Size</th>
                              <th className="text-left p-2 text-sm font-medium">Price per Container ($)</th>
                              <th className="text-left p-2 text-sm font-medium w-32">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {CONTAINER_SIZE_OPTIONS.map((size) => {
                              const row = containerPrices[size];
                              return (
                                <tr key={size} className="border-b hover:bg-muted/30">
                                  <td className="p-2 text-sm font-medium">{size}</td>
                                  <td className="p-2">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={row.price}
                                      onChange={(e) =>
                                        setContainerPrices((prev) => ({
                                          ...prev,
                                          [size]: { ...prev[size], price: e.target.value },
                                        }))
                                      }
                                      className="max-w-[180px]"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() =>
                                        handleSaveContainerHandling(size, row.price, row.pricingId)
                                      }
                                      disabled={isSaving || containerHandlingPricingLoading}
                                    >
                                      {isSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Save className="mr-1.5 h-4 w-4" />
                                          Save
                                        </>
                                      )}
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
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

