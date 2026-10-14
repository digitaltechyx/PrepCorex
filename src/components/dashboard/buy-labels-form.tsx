"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  saveShopifyLabelFulfillHandoff,
  shopifyQuickFulfillReturnUrl,
} from "@/lib/shopify-order-buy-label-prefill";
import {
  saveEbayLabelFulfillHandoff,
  ebayQuickFulfillReturnUrl,
} from "@/lib/ebay-order-buy-label-prefill";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, ShoppingCart, MapPin, Package, CreditCard, Plus, Trash2, Upload, ChevronsUpDown, Check, X, Search, ShoppingBag, Wallet, Pencil } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import type { BuyLabelShopifyPrefillLine } from "@/lib/shopify-order-buy-label-prefill";
import {
  BuyLabelsBulkImportDialog,
  type BuyLabelCartImportItem,
} from "@/components/dashboard/buy-labels-bulk-import-dialog";
import { ParcelBoxSuggestionCard } from "@/components/inventory/box-suggestion-card";
import { BUY_LABELS_FROM_NAME, BUY_LABELS_DEFAULT_FROM_PHONE } from "@/lib/buy-labels-bulk-import";
import { buildBuyLabelParcelPrefillFromSource } from "@/lib/buy-label-parcel-prefill";
import {
  filterVisibleBuyLabelRates,
  getBuyLabelRateDisplay,
} from "@/lib/buy-label-rate-display";
import {
  formatUnitDimensions,
  formatUnitWeight,
  readProductUnitMeasurements,
  suggestBox,
} from "@/lib/box-suggestion";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { getStripePublishableKey } from "@/lib/stripe";
import { PaymentDialog } from "./payment-dialog";
import type { InventoryItem, ShippingAddress, ParcelDetails, ShippingRate, LabelBillingSettings } from "@/types";
import {
  formatLabelBillingMoney,
  isLabelTrialActive,
  labelBillingRemainingCents,
  normalizeLabelBillingSettings,
  type LabelPaymentSource,
} from "@/lib/label-billing";
import { hasRole } from "@/lib/permissions";
import { formatWarehouseDisplayName, isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import { findDefaultWarehouseLocationIdInList } from "@/lib/default-warehouse";
import {
  locationToFromShippingAddress,
  normalizeShippoCountry,
  normalizeShippoState,
} from "@/lib/location-shipping-address";
import { canUseCsvImport } from "@/lib/csv-import-permissions";
import { cn } from "@/lib/utils";

// US States list
const US_STATES = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
  { value: "DC", label: "District of Columbia" },
];

// Canadian Provinces and Territories
const CANADIAN_PROVINCES = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "YT", label: "Yukon" },
];

const addressBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  street1: z.string().min(1, "Street address is required"),
  street2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(5, "ZIP code is required"),
  country: z.string().min(1, "Country is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

const fromAddressSchema = addressBaseSchema.extend({
  phone: z
    .string()
    .trim()
    .min(5, "Phone number is required (include country code if outside the US)"),
});

const toAddressSchema = addressBaseSchema.extend({
  phone: z.string().trim().optional().or(z.literal("")),
});

const parcelSchema = z.object({
  length: z.coerce.number().positive("Length must be positive"),
  width: z.coerce.number().positive("Width must be positive"),
  height: z.coerce.number().positive("Height must be positive"),
  weightPounds: z.coerce.number().min(0, "Pounds must be 0 or greater").max(70, "Max: 70lbs"),
  weightOunces: z.coerce.number().min(0, "Ounces must be 0 or greater").max(15.999, "Max: 15.999 oz"),
  distanceUnit: z.enum(["in", "ft", "cm", "m"]),
}).refine((data) => {
  // Total weight must be greater than 0
  const totalWeightOunces = (data.weightPounds * 16) + data.weightOunces;
  return totalWeightOunces > 0;
}, {
  message: "Total weight must be greater than 0",
  path: ["weightPounds"],
});

const formSchema = z.object({
  fromAddress: fromAddressSchema,
  toAddress: toAddressSchema,
  parcel: parcelSchema,
});

type FormValues = z.infer<typeof formSchema>;

/** Inventory products packed into one Buy Labels package / label. */
type BuyLabelPackageProduct = {
  id: string;
  productName: string;
  sku?: string;
  quantity: number;
};

type LabelCartItem = {
  id: string;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails & { weight: number; weightUnit: "lb" };
  selectedRate: ShippingRate;
  shipmentId: string | null;
  /** Optional multi-product contents for this package. */
  packageProducts?: BuyLabelPackageProduct[];
};

const BUY_LABELS_CART_STORAGE_PREFIX = "prepcorex.buyLabels.cart.v1.";

function buyLabelsCartStorageKey(userId: string): string {
  return `${BUY_LABELS_CART_STORAGE_PREFIX}${userId}`;
}

function isLabelCartItem(value: unknown): value is LabelCartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LabelCartItem>;
  return (
    typeof item.id === "string" &&
    !!item.fromAddress &&
    !!item.toAddress &&
    !!item.parcel &&
    !!item.selectedRate &&
    typeof item.selectedRate.amount === "string"
  );
}

function loadBuyLabelsCart(userId: string): LabelCartItem[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(buyLabelsCartStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLabelCartItem);
  } catch {
    return [];
  }
}

function saveBuyLabelsCart(userId: string, items: LabelCartItem[]): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const key = buyLabelsCartStorageKey(userId);
    if (items.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore quota / private mode failures.
  }
}

type LabelProvider = "shippo" | "shipbest";

function getRateDisplay(rate: ShippingRate): { provider: string; service: string } {
  return getBuyLabelRateDisplay(rate);
}

function toPaymentSelectedRate(
  rate: ShippingRate,
  shipmentId: string | null
): LabelPurchaseSelectedRate {
  return {
    objectId: rate.object_id,
    amount: rate.amount,
    currency: rate.currency,
    provider: rate.provider,
    serviceLevel: rate.servicelevel.name,
    shipmentId: rate.shipment || shipmentId || undefined,
    labelProvider: rate.labelProvider || (rate.object_id.startsWith("shipbest:") ? "shipbest" : "shippo"),
    logisticsProductId: rate.logisticsProductId,
    logisticsProductCode: rate.logisticsProductCode || rate.servicelevel.token,
    originalAmount: rate.originalAmount,
  };
}

/** Narrow type for payment payload — mirrors LabelPurchase.selectedRate */
type LabelPurchaseSelectedRate = {
  objectId: string;
  amount: string;
  currency: string;
  provider: string;
  serviceLevel: string;
  shipmentId?: string;
  labelProvider?: LabelProvider;
  logisticsProductId?: number;
  logisticsProductCode?: string;
  originalAmount?: string;
};

type LocationDoc = {
  id: string;
  name?: string;
  shippingName?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  stateOrProvince?: string;
  zip?: string;
  country?: string;
  active?: boolean;
};

const EMPTY_TO_ADDRESS: FormValues["toAddress"] = {
    name: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  /** Default to warehouse phone; user can change recipient phone on To. */
  phone: BUY_LABELS_DEFAULT_FROM_PHONE,
    email: "",
};

const DEFAULT_FROM_PHONE = BUY_LABELS_DEFAULT_FROM_PHONE;

const DEFAULT_PARCEL: FormValues["parcel"] = {
    length: 15,
    width: 4,
    height: 4,
    weightPounds: 0,
    weightOunces: 13,
    distanceUnit: "in",
};

function distanceToInches(value: number, unit: FormValues["parcel"]["distanceUnit"]): number {
  const factors: Record<FormValues["parcel"]["distanceUnit"], number> = {
    in: 1,
    ft: 12,
    cm: 1 / 2.54,
    m: 100 / 2.54,
  };
  return value * factors[unit];
}

type BuyLabelsFormProps = {
  /** Where to send the user after a successful purchase. Defaults to client purchased-labels page. */
  successRedirect?: string;
  /** Pre-fill ship-to address (e.g. from a Shopify order). */
  initialToAddress?: ShippingAddress | null;
  /** @deprecated Prefer shopifyOrderContext — kept for older call sites. */
  shopifyPrefillBanner?: string | null;
  /** Pre-fill parcel length/width/height/weight (e.g. from outbound inventory). */
  initialParcel?: {
    length?: number;
    width?: number;
    height?: number;
    distanceUnit?: "in" | "ft" | "cm" | "m";
    weightPounds?: number;
    weightOunces?: number;
  } | null;
  /** Banner when parcel was prefilled from outbound / inventory. */
  parcelPrefillBanner?: string | null;
  /**
   * Shopify → Buy Labels context. When set, shows order reference / line items,
   * pre-selects the client for inventory products, and returns to Quick Fulfill after purchase.
   */
  shopifyOrderContext?: {
    orderId: string;
    orderName: string;
    shop: string;
    shopName?: string;
    ownerUserId: string;
    ownerName: string;
    customerName?: string | null;
    email?: string | null;
    shipToSummary?: string | null;
    lineItems?: BuyLabelShopifyPrefillLine[];
    /** When set to ebay, Buy Labels returns to eBay Quick Fulfill. */
    platform?: "shopify" | "ebay";
    connectionId?: string;
  } | null;
  /** Client list for the inventory-owner picker (admin Buy Labels). */
  clientOptions?: Array<{ uid: string; label: string }>;
  /**
   * Admin mode: show Select User and load that client's inventory for the
   * product dropdown (required for Shopify quick-fulfill handoff).
   */
  enableClientInventoryPicker?: boolean;
};

export function BuyLabelsForm({
  successRedirect = "/dashboard/purchased-labels",
  initialToAddress = null,
  shopifyPrefillBanner = null,
  initialParcel = null,
  parcelPrefillBanner = null,
  shopifyOrderContext = null,
  clientOptions = [],
  enableClientInventoryPicker = false,
}: BuyLabelsFormProps = {}) {
  const { userProfile, user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { data: locationDocs } = useCollection<LocationDoc>("locations");
  const [loading, setLoading] = useState(false);
  const [loadingRates, setLoadingRates] = useState(false);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [paymentAmountCents, setPaymentAmountCents] = useState(0);
  const [paymentCurrency, setPaymentCurrency] = useState("usd");
  const [cartItems, setCartItems] = useState<LabelCartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);
  const [checkoutMode, setCheckoutMode] = useState<"single" | "bulk" | null>(null);
  const [pendingCheckoutItem, setPendingCheckoutItem] = useState<LabelCartItem | null>(null);
  const [labelBilling, setLabelBilling] = useState<LabelBillingSettings | null>(null);
  const [paymentSource, setPaymentSource] = useState<LabelPaymentSource>("limit");
  const [selectedFromLocationId, setSelectedFromLocationId] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [packageProducts, setPackageProducts] = useState<BuyLabelPackageProduct[]>([]);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [inventoryOwnerUserId, setInventoryOwnerUserId] = useState<string>(
    shopifyOrderContext?.ownerUserId || ""
  );
  const [pendingLabelPurchaseId, setPendingLabelPurchaseId] = useState<string | null>(null);
  const canImportBuyLabels = canUseCsvImport(userProfile, "buy_labels");
  const appliedInitialToRef = useRef(false);
  const appliedInitialParcelRef = useRef(false);

  const showClientInventoryPicker =
    enableClientInventoryPicker || Boolean(shopifyOrderContext) || clientOptions.length > 0;

  // Restore cart after refresh (per signed-in user).
  useEffect(() => {
    if (!user?.uid) {
      setCartItems([]);
      setCartHydrated(false);
      return;
    }
    setCartItems(loadBuyLabelsCart(user.uid));
    setCartHydrated(true);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !cartHydrated) return;
    saveBuyLabelsCart(user.uid, cartItems);
  }, [user?.uid, cartItems, cartHydrated]);

  useEffect(() => {
    if (shopifyOrderContext?.ownerUserId) {
      setInventoryOwnerUserId(shopifyOrderContext.ownerUserId);
    }
  }, [shopifyOrderContext?.ownerUserId]);

  // Admin client picker: only load that client's inventory (never silently fall back to admin uid).
  const inventoryOwnerId = showClientInventoryPicker
    ? (inventoryOwnerUserId || shopifyOrderContext?.ownerUserId || "").trim()
    : (user?.uid || "").trim();
  const inventoryPath = inventoryOwnerId ? `users/${inventoryOwnerId}/inventory` : "";
  const { data: inventoryItems } = useCollection<InventoryItem>(inventoryPath);

  useEffect(() => {
    if (!user) {
      setLabelBilling(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/label-billing?userId=${encodeURIComponent(user.uid)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.settings) {
          setLabelBilling(normalizeLabelBillingSettings(data.settings));
        } else {
          setLabelBilling(normalizeLabelBillingSettings(null));
        }
      } catch {
        if (!cancelled) setLabelBilling(normalizeLabelBillingSettings(null));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isBillingExempt =
    hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
  const trialActive = labelBilling ? isLabelTrialActive(labelBilling) : false;
  const limitMode = labelBilling?.mode === "limit";
  const walletMode = labelBilling?.mode === "wallet";
  const bothMode = labelBilling?.mode === "both";
  // Dual picker: permanent for card+wallet mode, or during wallet-mode trial.
  const showPaymentPicker =
    !isBillingExempt && (bothMode || (walletMode && trialActive));
  const cardPaymentSource: LabelPaymentSource =
    bothMode || limitMode ? "limit" : "trial";

  useEffect(() => {
    if (!labelBilling || isBillingExempt) return;
    if (limitMode) {
      setPaymentSource("limit");
      return;
    }
    if (bothMode) {
      // Prefer wallet when funded; otherwise card within period limit.
      if ((labelBilling.walletBalanceCents || 0) > 0) {
        setPaymentSource("wallet");
      } else {
        setPaymentSource("limit");
      }
      return;
    }
    if (trialActive && labelBillingRemainingCents(labelBilling) > 0) {
      setPaymentSource("trial");
      return;
    }
    setPaymentSource("wallet");
  }, [labelBilling, trialActive, limitMode, bothMode, isBillingExempt]);

  const payWithWallet = !isBillingExempt && paymentSource === "wallet";

  const paymentMethodPicker =
    showPaymentPicker && labelBilling ? (
      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-medium">Payment method</p>
        <RadioGroup
          value={paymentSource === "wallet" ? "wallet" : cardPaymentSource}
          onValueChange={(value) => setPaymentSource(value as LabelPaymentSource)}
          className="gap-3"
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
            <RadioGroupItem value={cardPaymentSource} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">
                {bothMode ? "Pay by card" : "Buy Label Trial (card)"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatLabelBillingMoney(labelBillingRemainingCents(labelBilling))} remaining this{" "}
                {labelBilling.period === "daily"
                  ? "day"
                  : labelBilling.period === "weekly"
                    ? "week"
                    : labelBilling.period === "yearly"
                      ? "year"
                      : "month"}
              </p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
            <RadioGroupItem value="wallet" className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">Wallet</p>
              <p className="text-xs text-muted-foreground">
                Balance {formatLabelBillingMoney(labelBilling.walletBalanceCents || 0)}
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>
    ) : null;

  const purchaseItemWithWallet = async (item: LabelCartItem) => {
    if (!user) throw new Error("You must be logged in to purchase labels.");
    const token = await user.getIdToken();
    const res = await fetch("/api/labels/purchase-with-wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fromAddress: item.fromAddress,
        toAddress: item.toAddress,
        parcel: item.parcel,
        selectedRate: toPaymentSelectedRate(
          item.selectedRate,
          item.shipmentId || item.selectedRate.shipment || null
        ),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Wallet purchase failed");
    return data as { labelPurchaseId?: string };
  };

  const resolvedClientOptions = useMemo(() => {
    if (
      shopifyOrderContext?.ownerUserId &&
      !clientOptions.some((o) => o.uid === shopifyOrderContext.ownerUserId)
    ) {
      return [
        {
          uid: shopifyOrderContext.ownerUserId,
          label: shopifyOrderContext.ownerName || shopifyOrderContext.ownerUserId,
        },
        ...clientOptions,
      ];
    }
    return clientOptions;
  }, [clientOptions, shopifyOrderContext]);

  const selectedClientOption = useMemo(
    () => resolvedClientOptions.find((opt) => opt.uid === inventoryOwnerId) ?? null,
    [resolvedClientOptions, inventoryOwnerId]
  );

  const filteredClientOptions = useMemo(() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return resolvedClientOptions;
    return resolvedClientOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [resolvedClientOptions, clientSearchQuery]);

  const inventoryProductOptions = useMemo(() => {
    const skus = new Set(
      (shopifyOrderContext?.lineItems || [])
        .map((li) => String(li.sku || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return [...(inventoryItems || [])]
      .filter((item) => Boolean(item.productName?.trim()))
      .sort((a, b) => {
        const aSku = String(a.sku || "").trim().toLowerCase();
        const bSku = String(b.sku || "").trim().toLowerCase();
        const aMatch = aSku && skus.has(aSku) ? 0 : 1;
        const bMatch = bSku && skus.has(bSku) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return String(a.productName).localeCompare(String(b.productName), undefined, {
          sensitivity: "base",
        });
      });
  }, [inventoryItems, shopifyOrderContext?.lineItems]);

  const findInventoryBySku = (sku: string | null | undefined) => {
    const needle = String(sku || "").trim().toLowerCase();
    if (!needle) return null;
    return (
      inventoryProductOptions.find(
        (item) => String(item.sku || "").trim().toLowerCase() === needle
      ) ?? null
    );
  };

  const filteredInventoryProductOptions = useMemo(() => {
    const q = productSearchQuery.trim().toLowerCase();
    if (!q) return inventoryProductOptions;
    return inventoryProductOptions.filter((item) => {
      const name = String(item.productName || "").toLowerCase();
      const sku = String(item.sku || "").toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
  }, [inventoryProductOptions, productSearchQuery]);

  const selectedInventoryProductIds = useMemo(
    () => new Set(packageProducts.map((p) => p.id)),
    [packageProducts]
  );
  const primaryPackageProductId = packageProducts[0]?.id || "";

  const assignedLocationIds = userProfile?.locations ?? [];
  const activeLocations = locationDocs.filter((loc) => loc.active !== false);
  const assignedLocations = activeLocations.filter((loc) => assignedLocationIds.includes(loc.id));
  const locationOptions = assignedLocations.length > 0 ? assignedLocations : activeLocations;
  const selectedFromLocation =
    locationOptions.find((loc) => loc.id === selectedFromLocationId) ?? null;

  useEffect(() => {
    const initStripe = async () => {
      const stripe = await loadStripe(getStripePublishableKey());
      setStripePromise(stripe);
    };
    initStripe();
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fromAddress: {
        name: "",
        phone: DEFAULT_FROM_PHONE,
        street1: "",
        street2: "",
        country: "US",
        state: "",
        city: "",
        zip: "",
        email: "",
      },
      toAddress: EMPTY_TO_ADDRESS,
      parcel: DEFAULT_PARCEL,
    },
  });
  const watchedParcel = form.watch("parcel");
  const watchedGrossWeightLb =
    ((watchedParcel.weightPounds || 0) * 16 + (watchedParcel.weightOunces || 0)) / 16;

  const defaultFromName = BUY_LABELS_FROM_NAME;

  const buildFromAddressForLocation = (
    location: LocationDoc
  ): FormValues["fromAddress"] => {
    const address = locationToFromShippingAddress(location, {
      shipperName: defaultFromName,
      phone: DEFAULT_FROM_PHONE,
      email: userProfile?.email || "",
    });
    return {
      ...address,
      phone: address.phone || DEFAULT_FROM_PHONE,
    };
  };

  const applyFromAddressFromLocation = (location: LocationDoc) => {
    const fromAddress = buildFromAddressForLocation(location);
    form.setValue("fromAddress", fromAddress, { shouldDirty: true, shouldValidate: true });
  };

  const resetFormForNextLabel = () => {
    const fromAddress = selectedFromLocation
      ? buildFromAddressForLocation(selectedFromLocation)
      : form.getValues("fromAddress");
    form.reset({
      fromAddress,
      toAddress: EMPTY_TO_ADDRESS,
      parcel: DEFAULT_PARCEL,
    });
    setPackageProducts([]);
  };

  useEffect(() => {
    if (locationOptions.length === 0) return;
    if (selectedFromLocationId && locationOptions.some((loc) => loc.id === selectedFromLocationId)) return;

    const preferredId = findDefaultWarehouseLocationIdInList(locationOptions);
    const preferred =
      (preferredId ? locationOptions.find((loc) => loc.id === preferredId) : undefined) ||
      locationOptions.find((loc) => isDefaultNj2Warehouse(loc.name)) ||
      locationOptions[0];
    if (!preferred) return;
    setSelectedFromLocationId(preferred.id);
  }, [locationOptions, selectedFromLocationId]);

  useEffect(() => {
    if (!selectedFromLocation) return;
    applyFromAddressFromLocation(selectedFromLocation);
  }, [selectedFromLocationId, selectedFromLocation?.id]);

  useEffect(() => {
    if (!initialToAddress || appliedInitialToRef.current) return;
    appliedInitialToRef.current = true;
    const country = normalizeShippoCountry(initialToAddress.country);
    const state = normalizeShippoState(initialToAddress.state, country);
    const phone = DEFAULT_FROM_PHONE;

    form.setValue("toAddress.name", initialToAddress.name || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.street1", initialToAddress.street1 || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.street2", initialToAddress.street2 || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.city", initialToAddress.city || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.zip", initialToAddress.zip || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.email", initialToAddress.email || "", {
      shouldDirty: true,
      shouldValidate: false,
    });
    form.setValue("toAddress.phone", phone, { shouldDirty: true, shouldValidate: false });
    // Country first, then state on next tick so the State Select remounts with the right options.
    form.setValue("toAddress.country", country, { shouldDirty: true, shouldValidate: false });
    queueMicrotask(() => {
      form.setValue("toAddress.state", state, { shouldDirty: true, shouldValidate: false });
    });
  }, [initialToAddress, form]);

  useEffect(() => {
    if (!initialParcel || appliedInitialParcelRef.current) return;
    appliedInitialParcelRef.current = true;
    const current = form.getValues("parcel");
    form.setValue(
      "parcel",
      {
        length: initialParcel.length ?? current.length,
        width: initialParcel.width ?? current.width,
        height: initialParcel.height ?? current.height,
        distanceUnit: initialParcel.distanceUnit ?? current.distanceUnit,
        weightPounds:
          initialParcel.weightPounds != null ? initialParcel.weightPounds : current.weightPounds,
        weightOunces:
          initialParcel.weightOunces != null ? initialParcel.weightOunces : current.weightOunces,
      },
      { shouldDirty: true, shouldValidate: false }
    );
  }, [initialParcel, form]);

  const syncParcelFromPackageProducts = (products: BuyLabelPackageProduct[]) => {
    if (products.length === 0) return;

    // Single product: keep previous behavior (unit dims + weight).
    if (products.length === 1) {
      const inv = inventoryProductOptions.find((i) => i.id === products[0].id);
      if (!inv) return;
      const qty = Math.max(1, Math.floor(products[0].quantity) || 1);
      const prefill = buildBuyLabelParcelPrefillFromSource(
        inv as unknown as Record<string, unknown>,
        { productName: inv.productName }
      );
      if (!prefill) {
        toast({
          title: "No dimensions on file",
          description: `“${inv.productName}” has no L/W/H or weight yet. Enter them manually below.`,
        });
        return;
      }
      const unitWeightLb =
        (Number(prefill.weightPounds) || 0) + (Number(prefill.weightOunces) || 0) / 16;
      const totalWeightLb = unitWeightLb * qty;
      const current = form.getValues("parcel");
      form.setValue(
        "parcel",
        {
          length: prefill.length ?? current.length,
          width: prefill.width ?? current.width,
          height: prefill.height ?? current.height,
          distanceUnit: prefill.distanceUnit ?? current.distanceUnit ?? "in",
          weightPounds: Math.round(totalWeightLb * 100) / 100,
          weightOunces: 0,
        },
        { shouldDirty: true, shouldValidate: true }
      );
      toast({
        title: "Package details filled",
        description: [
          inv.productName,
          qty > 1 ? `×${qty}` : null,
          formatUnitDimensions(inv) || null,
          `${(Math.round(totalWeightLb * 100) / 100).toFixed(2)} lb`,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      return;
    }

    const lines = products.map((p) => {
      const inv = inventoryProductOptions.find((i) => i.id === p.id);
      return {
        productId: p.id,
        productName: p.productName,
        sku: p.sku,
        quantity: Math.max(1, Math.floor(p.quantity) || 1),
        measurements: readProductUnitMeasurements(
          inv as unknown as Record<string, unknown> | undefined
        ),
      };
    });

    const suggestion = suggestBox(lines);
    const current = form.getValues("parcel");

    if (suggestion.status === "recommended") {
      form.setValue(
        "parcel",
        {
          length: suggestion.box.externalLengthIn,
          width: suggestion.box.externalWidthIn,
          height: suggestion.box.externalHeightIn,
          distanceUnit: "in",
          weightPounds: Math.round(suggestion.grossWeightLb * 100) / 100,
          weightOunces: 0,
        },
        { shouldDirty: true, shouldValidate: true }
      );
      toast({
        title: "Multi-product package filled",
        description: `${products.length} products · box ${suggestion.box.code} · ${suggestion.grossWeightLb.toFixed(2)} lb (edit if needed).`,
      });
      return;
    }

    // Fallback: sum weights; keep largest single unit footprint for L/W/H.
    let totalWeightLb = 0;
    let bestVol = 0;
    let bestDims: { length: number; width: number; height: number } | null = null;
    const missing: string[] = [];
    for (const line of lines) {
      if (!line.measurements) {
        missing.push(line.productName || "Product");
        continue;
      }
      totalWeightLb += line.measurements.unitWeightLb * line.quantity;
      const vol =
        line.measurements.unitLengthIn *
        line.measurements.unitWidthIn *
        line.measurements.unitHeightIn;
      if (vol > bestVol) {
        bestVol = vol;
        bestDims = {
          length: line.measurements.unitLengthIn,
          width: line.measurements.unitWidthIn,
          height: line.measurements.unitHeightIn,
        };
      }
    }

    if (totalWeightLb <= 0 && !bestDims) {
      toast({
        title: "Missing product measurements",
        description:
          missing.length > 0
            ? `No L/W/H or weight for: ${missing.join(", ")}. Enter package details manually.`
            : "Enter package details manually below.",
      });
      return;
    }

    form.setValue(
      "parcel",
      {
        length: bestDims?.length ?? current.length,
        width: bestDims?.width ?? current.width,
        height: bestDims?.height ?? current.height,
        distanceUnit: "in",
        weightPounds:
          totalWeightLb > 0
            ? Math.round(totalWeightLb * 100) / 100
            : current.weightPounds,
        weightOunces: 0,
      },
      { shouldDirty: true, shouldValidate: true }
    );
    toast({
      title: "Multi-product package filled",
      description:
        missing.length > 0
          ? `Weight/dims from available products. Missing measurements: ${missing.join(", ")}. Review below.`
          : `${products.length} products · combined weight applied. Review box size below.`,
    });
  };

  const upsertPackageProduct = (item: InventoryItem, quantity = 1) => {
    const qty = Math.max(1, Math.floor(quantity) || 1);
    setPackageProducts((prev) => {
      const existing = prev.find((p) => p.id === item.id);
      const next = existing
        ? prev.map((p) => (p.id === item.id ? { ...p, quantity: qty } : p))
        : [
            ...prev,
            {
              id: item.id,
              productName: item.productName,
              sku: item.sku ? String(item.sku) : undefined,
              quantity: qty,
            },
          ];
      // Defer parcel sync so state is current.
      queueMicrotask(() => syncParcelFromPackageProducts(next));
      return next;
    });
  };

  const togglePackageProduct = (item: InventoryItem, quantity = 1) => {
    setPackageProducts((prev) => {
      const exists = prev.some((p) => p.id === item.id);
      const next = exists
        ? prev.filter((p) => p.id !== item.id)
        : [
            ...prev,
            {
              id: item.id,
              productName: item.productName,
              sku: item.sku ? String(item.sku) : undefined,
              quantity: Math.max(1, Math.floor(quantity) || 1),
            },
          ];
      queueMicrotask(() => syncParcelFromPackageProducts(next));
      return next;
    });
  };

  const setPackageProductQuantity = (productId: string, quantity: number) => {
    const qty = Math.max(1, Math.floor(quantity) || 1);
    setPackageProducts((prev) => {
      const next = prev.map((p) => (p.id === productId ? { ...p, quantity: qty } : p));
      queueMicrotask(() => syncParcelFromPackageProducts(next));
      return next;
    });
  };

  const removePackageProduct = (productId: string) => {
    setPackageProducts((prev) => {
      const next = prev.filter((p) => p.id !== productId);
      queueMicrotask(() => {
        if (next.length > 0) syncParcelFromPackageProducts(next);
      });
      return next;
    });
  };

  const clearPackageProducts = () => {
    setPackageProducts([]);
  };

  const handleGetRates = async (data: FormValues) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to get rates.",
      });
      return;
    }

    setLoadingRates(true);
    try {
      // Convert pounds and ounces to total weight in ounces
      const totalWeightOunces = (data.parcel.weightPounds * 16) + data.parcel.weightOunces;
      const totalWeightPounds = totalWeightOunces / 16;
      
      // Prepare parcel data for API (convert to pounds for Shippo)
      const parcelData = {
        ...data.parcel,
        weight: totalWeightPounds,
        weightUnit: "lb" as const,
      };

      const requestBody = JSON.stringify({
          fromAddress: data.fromAddress,
          toAddress: data.toAddress,
          parcel: parcelData,
      });

      const token = await user.getIdToken();
      const allowShippo = labelBilling?.allowShippo !== false;
      const allowShipbest = labelBilling?.allowShipbest !== false;
      const hasRecipientPhone = Boolean(data.toAddress.phone?.trim());
      const providerRequests = [
        ...(allowShippo ? [{ name: "Shippo", url: "/api/shippo/rates" }] : []),
        ...(allowShipbest && hasRecipientPhone
          ? [{ name: "ShipBest", url: "/api/shipbest/rates" }]
          : []),
      ];

      if (providerRequests.length === 0) {
        if (allowShipbest && !hasRecipientPhone) {
          toast({
            variant: "destructive",
            title: "ShipBest rates need a phone",
            description:
              "Shippo is disabled for your account. Add the recipient phone number to get ShipBest rates (including PrepCorex GOFO).",
          });
        } else {
          toast({
            variant: "destructive",
            title: "No couriers enabled",
            description:
              "Contact an administrator to enable Shippo or ShipBest rates for your account.",
          });
        }
        setRates([]);
        setSelectedRate(null);
        return;
      }

      const providerResults = await Promise.all(
        providerRequests.map(async ({ name, url }) => {
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: requestBody,
            });
            const result = await response.json().catch(() => ({}));
      if (!response.ok) {
              const message =
                [result.error, result.details].filter(Boolean).join(" — ") ||
                `Failed to get ${name} rates`;
              return { name, rates: [] as ShippingRate[], shipmentId: null, error: message };
            }
            return {
              name,
              rates: Array.isArray(result.rates) ? (result.rates as ShippingRate[]) : [],
              shipmentId: typeof result.shipment_id === "string" ? result.shipment_id : null,
              error: null,
            };
          } catch (error: unknown) {
            return {
              name,
              rates: [] as ShippingRate[],
              shipmentId: null,
              error: error instanceof Error ? error.message : `Failed to get ${name} rates`,
            };
          }
        })
      );

      const combinedRates = filterVisibleBuyLabelRates(
        providerResults.flatMap((result) => result.rates)
      ).sort((a, b) => Number(a.amount) - Number(b.amount));
      const shippoShipmentId =
        providerResults.find((result) => result.name === "Shippo")?.shipmentId || null;

      setRates(combinedRates);
      setSelectedRate(null);
      setShipmentId(shippoShipmentId);

      // Expected when a courier is disabled for the account — never surface these to the client.
      const isCourierDisabledError = (message: string | null | undefined) =>
        /not enabled for this account/i.test(String(message || ""));

      const failedProviders = providerResults.filter(
        (result) => result.error && !isCourierDisabledError(result.error)
      );
      if (combinedRates.length === 0 && failedProviders.length > 0) {
        throw new Error(
          failedProviders.map((result) => `${result.name}: ${result.error}`).join(" | ")
        );
      }

      if (combinedRates.length > 0) {
        toast({
          title: "Rates Retrieved",
          description: `Found ${combinedRates.length} shipping options.`,
        });
        if (allowShipbest && !hasRecipientPhone) {
          toast({
            title: "ShipBest rates unavailable",
            description:
              "Add the recipient phone number to view all ShipBest logistics products (including PrepCorex GOFO).",
          });
        }
        // Only warn about unexpected provider failures — never "courier not enabled".
        if (failedProviders.length > 0) {
          toast({
            title: "Some rates unavailable",
            description: failedProviders
              .map((result) =>
                result.name === "ShipBest"
                  ? "ShipBest could not return rates. Verify the recipient address and phone."
                  : `${result.name}: ${result.error}`
              )
              .join(" | "),
          });
        }
      } else {
        toast({
          variant: "destructive",
          title: "No Rates Found",
          description: "No shipping rates available for this shipment.",
        });
      }
    } catch (error: any) {
      console.error("Error getting rates:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to get shipping rates. Please try again.",
      });
    } finally {
      setLoadingRates(false);
    }
  };

  const createPaymentIntentForItem = async (item: LabelCartItem) => {
    if (!user) {
      throw new Error("You must be logged in to purchase labels.");
    }

    if (payWithWallet) {
      await purchaseItemWithWallet(item);
      toast({
        title: "Label purchased",
        description: "Paid from your Buy Labels wallet.",
      });
      router.push(successRedirect);
      return;
    }

    const amount = Math.round(parseFloat(item.selectedRate.amount) * 100);
    setPendingCheckoutItem(item);
    setCheckoutMode("single");
    setPaymentAmountCents(amount);
    setPaymentCurrency(item.selectedRate.currency || "usd");
    setPendingLabelPurchaseId(null);
    setPaymentDialogOpen(true);
  };

  const createStripePaymentIntent = async (opts: {
    saveCard: boolean;
    paymentMethodId?: string | null;
  }) => {
    if (!user) throw new Error("You must be logged in to purchase labels.");
    const token = await user.getIdToken();

    if (checkoutMode === "bulk") {
      const response = await fetch("/api/stripe/create-bulk-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user.uid,
          saveCard: opts.saveCard,
          paymentMethodId: opts.paymentMethodId || null,
          items: cartItems.map((item) => ({
            fromAddress: item.fromAddress,
            toAddress: item.toAddress,
            parcel: item.parcel,
            selectedRate: toPaymentSelectedRate(
              item.selectedRate,
              item.shipmentId || item.selectedRate.shipment || null
            ),
          })),
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to start bulk checkout.");
      }
      const data = await response.json();
      return { clientSecret: data.clientSecret as string };
    }

    const item = pendingCheckoutItem;
    if (!item) throw new Error("No label selected for checkout.");

    const amount = Math.round(parseFloat(item.selectedRate.amount) * 100);
    const paymentResponse = await fetch("/api/stripe/create-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: user.uid,
        amount,
        currency: item.selectedRate.currency.toLowerCase(),
        fromAddress: item.fromAddress,
        toAddress: item.toAddress,
        parcel: item.parcel,
        selectedRate: toPaymentSelectedRate(
          item.selectedRate,
          item.shipmentId || item.selectedRate.shipment || null
        ),
        saveCard: opts.saveCard,
        paymentMethodId: opts.paymentMethodId || null,
      }),
    });

    if (!paymentResponse.ok) {
      const errorData = await paymentResponse.json().catch(() => ({}));
      const errorMessage = errorData.details
        ? `${errorData.error}: ${errorData.details}`
        : errorData.error || "Failed to create payment";
      throw new Error(errorMessage);
    }

    const { clientSecret, labelPurchaseId } = await paymentResponse.json();
    if (typeof labelPurchaseId === "string" && labelPurchaseId) {
      setPendingLabelPurchaseId(labelPurchaseId);
    }
    return {
      clientSecret: clientSecret as string,
      labelPurchaseId: typeof labelPurchaseId === "string" ? labelPurchaseId : undefined,
    };
  };

  const buildCartItemFromCurrentForm = (): LabelCartItem | null => {
    if (!selectedRate) return null;
    const formData = form.getValues();
    const totalWeightOunces = (formData.parcel.weightPounds * 16) + formData.parcel.weightOunces;
    const totalWeightPounds = totalWeightOunces / 16;
    const parcelData = {
      ...formData.parcel,
      weight: totalWeightPounds,
      weightUnit: "lb" as const,
    };
    return {
      id: editingCartItemId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: formData.fromAddress,
      toAddress: formData.toAddress,
      parcel: parcelData,
      selectedRate,
      shipmentId: selectedRate.shipment || shipmentId || null,
      packageProducts: packageProducts.length > 0 ? packageProducts : undefined,
    };
  };

  const clearEditingCartState = () => {
    setEditingCartItemId(null);
    setRates([]);
    setSelectedRate(null);
    setShipmentId(null);
  };

  const handleStartEditCartItem = (item: LabelCartItem) => {
    const parcel = item.parcel as FormValues["parcel"] & {
      weight?: number;
      weightUnit?: string;
    };
    let weightPounds = Number(parcel.weightPounds);
    let weightOunces = Number(parcel.weightOunces);
    if (!Number.isFinite(weightPounds) || !Number.isFinite(weightOunces)) {
      const totalLb = Number(parcel.weight) || 0;
      weightPounds = Math.floor(totalLb);
      weightOunces = Math.round((totalLb - weightPounds) * 16 * 1000) / 1000;
    }

    form.reset({
      fromAddress: {
        ...item.fromAddress,
        phone: item.fromAddress.phone || DEFAULT_FROM_PHONE,
        country: item.fromAddress.country || "US",
        email: item.fromAddress.email || "",
        street2: item.fromAddress.street2 || "",
      },
      toAddress: {
        ...item.toAddress,
        phone: item.toAddress.phone || "",
        country: item.toAddress.country || "US",
        email: item.toAddress.email || "",
        street2: item.toAddress.street2 || "",
      },
      parcel: {
        length: Number(parcel.length) || DEFAULT_PARCEL.length,
        width: Number(parcel.width) || DEFAULT_PARCEL.width,
        height: Number(parcel.height) || DEFAULT_PARCEL.height,
        weightPounds: Math.max(0, weightPounds),
        weightOunces: Math.max(0, weightOunces),
      },
    });

    // Best-effort match warehouse from the saved from-address.
    const matchLoc = locationOptions.find((loc) => {
      const built = buildFromAddressForLocation(loc);
      return (
        built.street1 === item.fromAddress.street1 &&
        built.zip === item.fromAddress.zip &&
        built.city === item.fromAddress.city
      );
    });
    if (matchLoc) setSelectedFromLocationId(matchLoc.id);

    setEditingCartItemId(item.id);
    setPackageProducts(item.packageProducts || []);
    setRates([item.selectedRate]);
    setSelectedRate(item.selectedRate);
    setShipmentId(item.shipmentId || item.selectedRate.shipment || null);

    toast({
      title: "Editing cart item",
      description: "Update the form, re-get rates if needed, then save back to cart.",
    });

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCancelEditCartItem = () => {
    clearEditingCartState();
    resetFormForNextLabel();
    toast({
      title: "Edit cancelled",
      description: "Cart item left unchanged.",
    });
  };

  const handleRemoveCartItem = (itemId: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
    if (editingCartItemId === itemId) {
      clearEditingCartState();
      resetFormForNextLabel();
    }
  };

  const handleAddToCart = () => {
    const item = buildCartItemFromCurrentForm();
    if (!item) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a shipping rate first.",
      });
      return;
    }
    const isEditing = Boolean(editingCartItemId);
    setCartItems((prev) => {
      if (!editingCartItemId) return [...prev, item];
      const idx = prev.findIndex((row) => row.id === editingCartItemId);
      if (idx < 0) return [...prev, item];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
    clearEditingCartState();
    resetFormForNextLabel();
    const displayRate = getRateDisplay(item.selectedRate);
    toast({
      title: isEditing ? "Cart item updated" : "Added to cart",
      description: `${displayRate.provider} ${displayRate.service} ${
        isEditing ? "updated." : "added."
      }`,
    });
  };

  const handlePurchaseLabel = async () => {
    const item = buildCartItemFromCurrentForm();
    if (!item || !user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a shipping rate first.",
      });
      return;
    }

    setLoading(true);

    try {
      setCheckoutMode("single");
      await createPaymentIntentForItem(item);
    } catch (error: any) {
      console.error("Error purchasing label:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to purchase label. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartBulkCheckout = async () => {
    if (cartItems.length === 0) {
      toast({
        variant: "destructive",
        title: "Cart is empty",
        description: "Add at least one label to cart first.",
      });
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error("You must be logged in to purchase labels.");

      if (payWithWallet) {
        const count = cartItems.length;
        setCheckoutMode("bulk");
        for (const item of cartItems) {
          await purchaseItemWithWallet(item);
        }
        setCartItems([]);
        toast({
          title: "Labels purchased",
          description: `${count} label(s) paid from your wallet.`,
        });
        router.push(successRedirect);
        return;
      }

      const totalAmount = cartItems.reduce((sum, item) => {
        const cents = Math.round(Number.parseFloat(item.selectedRate.amount || "0") * 100);
        return sum + (Number.isFinite(cents) ? cents : 0);
      }, 0);
      const currency = cartItems[0]?.selectedRate?.currency || "usd";
      setCheckoutMode("bulk");
      setPendingCheckoutItem(null);
      setPaymentAmountCents(totalAmount);
      setPaymentCurrency(currency);
      setPendingLabelPurchaseId(null);
      setPaymentDialogOpen(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to start bulk checkout.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImportAddToCart = (items: BuyLabelCartImportItem[]) => {
    const newItems: LabelCartItem[] = items.map((item) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: item.fromAddress,
      toAddress: item.toAddress,
      parcel: item.parcel,
      selectedRate: item.selectedRate,
      shipmentId: item.shipmentId,
    }));
    setCartItems((prev) => [...prev, ...newItems]);
  };

  const handlePaymentSuccess = async (paidLabelPurchaseId?: string | null) => {
    if (checkoutMode === "bulk") {
      setCartItems([]);
    }

    const selectedProduct = (inventoryItems || []).find(
      (item) => item.id === primaryPackageProductId
    );
    const packageProductNames =
      packageProducts.length > 0
        ? packageProducts.map((p) => `${p.productName}×${p.quantity}`).join(", ")
        : selectedProduct?.productName || null;
    const labelPrice = selectedRate
      ? Number.parseFloat(String(selectedRate.amount))
      : NaN;
    const resolvedPurchaseId = paidLabelPurchaseId || pendingLabelPurchaseId;

    if (shopifyOrderContext && user?.uid) {
      let trackingNumber: string | null = null;
      let trackingCompany: string | null = null;
      if (resolvedPurchaseId) {
        for (let i = 0; i < 12; i++) {
          try {
            const snap = await getDoc(
              doc(db, `users/${user.uid}/labelPurchases`, resolvedPurchaseId)
            );
            if (snap.exists()) {
              const data = snap.data() as {
                trackingNumber?: string;
                selectedRate?: { provider?: string; serviceLevel?: string };
                status?: string;
              };
              if (data.trackingNumber) {
                trackingNumber = String(data.trackingNumber);
                trackingCompany =
                  data.selectedRate?.provider || data.selectedRate?.serviceLevel || null;
                break;
              }
              if (data.status === "label_failed") break;
            }
          } catch {
            // keep polling
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (shopifyOrderContext.platform === "ebay") {
        saveEbayLabelFulfillHandoff({
          ownerUserId: inventoryOwnerId || shopifyOrderContext.ownerUserId,
          orderId: shopifyOrderContext.orderId,
          connectionId: shopifyOrderContext.connectionId || "",
          inventoryProductId: primaryPackageProductId || null,
          inventoryProductName: packageProductNames,
          labelPurchaseId: resolvedPurchaseId,
          labelPrice: Number.isFinite(labelPrice) ? labelPrice : null,
          trackingNumber,
          trackingCompany,
          purchasedByUserId: user.uid,
        });

        resetFormForNextLabel();
        setRates([]);
        setSelectedRate(null);
        setShipmentId(null);
        setCheckoutMode(null);
        setPendingLabelPurchaseId(null);
        setPendingCheckoutItem(null);

        toast({
          title: trackingNumber ? "Label purchased" : "Payment succeeded",
          description: trackingNumber
            ? "Returning to eBay Quick Fulfill with tracking prefilled."
            : "Returning to eBay Quick Fulfill. Tracking may appear shortly — refresh if needed.",
        });

        router.push(
          ebayQuickFulfillReturnUrl({
            ownerUserId: inventoryOwnerId || shopifyOrderContext.ownerUserId,
            orderId: shopifyOrderContext.orderId,
          })
        );
        return;
      }

      saveShopifyLabelFulfillHandoff({
        ownerUserId: inventoryOwnerId || shopifyOrderContext.ownerUserId,
        orderId: shopifyOrderContext.orderId,
        orderName: shopifyOrderContext.orderName,
        shop: shopifyOrderContext.shop,
        inventoryProductId: primaryPackageProductId || null,
        inventoryProductName: packageProductNames,
        labelPurchaseId: resolvedPurchaseId,
        labelPrice: Number.isFinite(labelPrice) ? labelPrice : null,
        trackingNumber,
        trackingCompany,
        purchasedByUserId: user.uid,
      });

      resetFormForNextLabel();
      setRates([]);
      setSelectedRate(null);
      setShipmentId(null);
      setCheckoutMode(null);
      setPendingLabelPurchaseId(null);
      setPendingCheckoutItem(null);

      toast({
        title: trackingNumber ? "Label purchased" : "Payment succeeded",
        description: trackingNumber
          ? "Returning to Quick Fulfill with tracking prefilled."
          : "Returning to Quick Fulfill. Tracking may appear shortly — refresh if needed.",
      });

      router.push(
        shopifyQuickFulfillReturnUrl({
          ownerUserId: inventoryOwnerId || shopifyOrderContext.ownerUserId,
          orderId: shopifyOrderContext.orderId,
        })
      );
      return;
    }

    // Reset form after successful payment
    resetFormForNextLabel();
    setRates([]);
    setSelectedRate(null);
    setShipmentId(null);
    setCheckoutMode(null);
    setPendingLabelPurchaseId(null);
    setPendingCheckoutItem(null);
    
    // Redirect to purchased labels page
    router.push(successRedirect);
  };

  return (
    <div className="space-y-6">
      {shopifyOrderContext ? (
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <ShoppingBag className="h-5 w-5 text-emerald-600" />
              {shopifyOrderContext.platform === "ebay" ? "eBay" : "Shopify"} order reference
              <Badge variant="secondary">{shopifyOrderContext.orderName}</Badge>
            </CardTitle>
            <CardDescription>
              Review the order below, then select the matching warehouse product to fill package
              size/weight before getting rates. After purchase you&apos;ll return to Quick Fulfill.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Client
                </div>
                <div className="font-medium">{shopifyOrderContext.ownerName}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Store
                </div>
                <div className="font-medium">
                  {shopifyOrderContext.shopName || shopifyOrderContext.shop}
                </div>
                {shopifyOrderContext.shopName &&
                shopifyOrderContext.shopName !== shopifyOrderContext.shop ? (
                  <div className="text-xs text-muted-foreground">{shopifyOrderContext.shop}</div>
                ) : null}
              </div>
              {shopifyOrderContext.customerName ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Customer
                  </div>
                  <div className="font-medium">{shopifyOrderContext.customerName}</div>
                  {shopifyOrderContext.email ? (
                    <div className="text-xs text-muted-foreground">{shopifyOrderContext.email}</div>
                  ) : null}
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Ship to
                </div>
                <div className="font-medium">
                  {shopifyOrderContext.shipToSummary ||
                    "No address on the order — enter ship-to below."}
                </div>
              </div>
            </div>

            {(shopifyOrderContext.lineItems || []).length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Order line items — add one or more warehouse products to this package
                </div>
                <ul className="divide-y rounded-md border bg-background">
                  {(shopifyOrderContext.lineItems || []).map((li, idx) => {
                    const matched = findInventoryBySku(li.sku);
                    const selected =
                      matched && selectedInventoryProductIds.has(matched.id);
                    const label = [li.title, li.variantTitle].filter(Boolean).join(" · ");
                    return (
                      <li
                        key={`${li.sku || li.title}-${idx}`}
                        className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {label}{" "}
                            <span className="text-muted-foreground">×{li.quantity}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {li.sku ? `SKU: ${li.sku}` : "No SKU on Shopify line"}
                            {matched
                              ? ` · Matched inventory: ${matched.productName}`
                              : li.sku
                                ? " · No inventory match for this SKU yet"
                                : ""}
                          </div>
                        </div>
                        {matched ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={selected ? "secondary" : "outline"}
                            className="shrink-0"
                            onClick={() =>
                              selected
                                ? removePackageProduct(matched.id)
                                : upsertPackageProduct(matched, Math.max(1, Number(li.quantity) || 1))
                            }
                          >
                            {selected ? "In package" : "Add to package"}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            disabled={!inventoryOwnerId}
                            onClick={() => {
                              setProductSearchQuery(li.sku || li.title || "");
                              setProductPickerOpen(true);
                            }}
                          >
                            Find in inventory
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No line items on this order. Select a product from the client&apos;s inventory below.
              </p>
            )}
          </CardContent>
        </Card>
      ) : shopifyPrefillBanner ? (
        <Alert>
          <Package className="h-4 w-4" />
          <AlertTitle>Pre-filled from Shopify order</AlertTitle>
          <AlertDescription>
            {shopifyPrefillBanner}. Ship-to is filled in — select the client&apos;s warehouse product
            for dimensions, get rates, and purchase. You&apos;ll return to Quick Fulfill with tracking.
          </AlertDescription>
        </Alert>
      ) : null}
      {parcelPrefillBanner ? (
        <Alert>
          <Package className="h-4 w-4" />
          <AlertTitle>Package details pre-filled</AlertTitle>
          <AlertDescription>
            {parcelPrefillBanner}. Review weight and dimensions, then get rates.
          </AlertDescription>
        </Alert>
      ) : null}
      {stripePromise && paymentDialogOpen && user ? (
        <Elements stripe={stripePromise}>
          <PaymentDialog
            open={paymentDialogOpen}
            onOpenChange={(open) => {
              setPaymentDialogOpen(open);
              if (!open) {
                setPendingCheckoutItem(null);
              }
            }}
            amount={paymentAmountCents}
            currency={paymentCurrency}
            getIdToken={() => user.getIdToken()}
            createPaymentIntent={createStripePaymentIntent}
            onSuccess={(labelPurchaseId) => {
              if (labelPurchaseId) setPendingLabelPurchaseId(labelPurchaseId);
              void handlePaymentSuccess(labelPurchaseId);
            }}
          />
        </Elements>
      ) : null}
      {canImportBuyLabels ? (
        <BuyLabelsBulkImportDialog
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
          locationOptions={locationOptions}
          defaultFromName={defaultFromName}
          defaultFromPhone={DEFAULT_FROM_PHONE}
          onAddToCart={handleBulkImportAddToCart}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Purchase Shipping Label
          </CardTitle>
          <CardDescription>
                Enter shipment details to get shipping rates and purchase a label, or import multiple
                labels from CSV.
          </CardDescription>
            </div>
            {canImportBuyLabels ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setBulkImportOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleGetRates)} className="space-y-6">
              {/* From Address */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-semibold">From Address</h3>
                </div>
                {locationOptions.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Warehouse Location</Label>
                      <Select
                        value={selectedFromLocationId}
                        onValueChange={setSelectedFromLocationId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select warehouse location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locationOptions.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              {formatWarehouseDisplayName(loc.name)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Defaults to the selected warehouse (NJ-02 when available). Change the
                        warehouse to fill our address, or edit the fields below to use your own.
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="fromAddress.name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Prep Services FBA" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone *</FormLabel>
                        <FormControl>
                          <PhoneInput
                            value={field.value}
                            onChange={field.onChange}
                            defaultCountry="us"
                            placeholder="347 661 3010"
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Country code defaults to +1. Select another code if needed, then enter the number.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.street1"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Street Address *</FormLabel>
                        <FormControl>
                          <Input placeholder="123 Main St" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.street2"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Apartment, suite, etc. (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Apt 4B" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country *</FormLabel>
                        <Select
                          onValueChange={(value) => {
                          field.onChange(value);
                          // Reset state when country changes
                          form.setValue("fromAddress.state", "");
                        }} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="US">United States</SelectItem>
                            <SelectItem value="CA">Canada</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.state"
                    render={({ field }) => {
                      const selectedCountry = form.watch("fromAddress.country");
                      const stateOptions = selectedCountry === "CA" ? CANADIAN_PROVINCES : US_STATES;
                      
                      return (
                        <FormItem>
                          <FormLabel>{selectedCountry === "CA" ? "Province" : "State"} *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={`Select ${selectedCountry === "CA" ? "province" : "state"}`} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {stateOptions.map((state) => (
                                <SelectItem key={state.value} value={state.value}>
                                  {state.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City *</FormLabel>
                        <FormControl>
                          <Input placeholder="New York" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromAddress.zip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code *</FormLabel>
                        <FormControl>
                          <Input placeholder="10001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* To Address */}
              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5 text-green-600" />
                  <h3 className="text-lg font-semibold">To Address</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="toAddress.name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Jane Smith" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <PhoneInput
                            value={field.value}
                            onChange={field.onChange}
                            defaultCountry="us"
                            placeholder="347 661 3010"
                          />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">
                          Country code defaults to +1. Change the code or number if the recipient needs a different phone.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.street1"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Street Address *</FormLabel>
                        <FormControl>
                          <Input placeholder="456 Oak Ave" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.street2"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Apartment, suite, etc. (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Suite 200" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country *</FormLabel>
                        <Select
                          onValueChange={(value) => {
                            const prev = field.value;
                          field.onChange(value);
                            if (prev !== value) {
                          form.setValue("toAddress.state", "");
                            }
                          }}
                          value={field.value || undefined}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="US">United States</SelectItem>
                            <SelectItem value="CA">Canada</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.state"
                    render={({ field }) => {
                      const selectedCountry = form.watch("toAddress.country");
                      const stateOptions = selectedCountry === "CA" ? CANADIAN_PROVINCES : US_STATES;
                      
                      return (
                        <FormItem>
                          <FormLabel>{selectedCountry === "CA" ? "Province" : "State"} *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={`Select ${selectedCountry === "CA" ? "province" : "state"}`} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {stateOptions.map((state) => (
                                <SelectItem key={state.value} value={state.value}>
                                  {state.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City *</FormLabel>
                        <FormControl>
                          <Input placeholder="Los Angeles" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="toAddress.zip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code *</FormLabel>
                        <FormControl>
                          <Input placeholder="90001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Parcel Details */}
              <div className="space-y-6 pt-4 border-t">
                <div className="flex items-center gap-2 mb-4">
                  <Package className="h-5 w-5 text-orange-600" />
                  <h3 className="text-lg font-semibold">Packaging Details</h3>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  {showClientInventoryPicker ? (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Select user *</Label>
                      <p className="text-xs text-muted-foreground">
                        {shopifyOrderContext
                          ? "Pre-selected from the Shopify order. Change if needed — products load from this client’s inventory."
                          : "Choose a client first. The product list below shows that user’s warehouse inventory."}
                      </p>
                      <Popover
                        open={clientPickerOpen}
                        modal={false}
                        onOpenChange={(open) => {
                          setClientPickerOpen(open);
                          if (!open) setClientSearchQuery("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={clientPickerOpen}
                            className="relative z-10 w-full max-w-md justify-between font-normal pointer-events-auto"
                          >
                            <span className="truncate">
                              {selectedClientOption
                                ? selectedClientOption.label
                                : inventoryOwnerId
                                  ? resolvedClientOptions.find((o) => o.uid === inventoryOwnerId)
                                      ?.label ||
                                    shopifyOrderContext?.ownerName ||
                                    "Selected user"
                                  : "Select user…"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="z-[200] w-[min(100vw-2rem,28rem)] p-0 pointer-events-auto"
                          align="start"
                          sideOffset={4}
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          <div className="flex items-center gap-2 border-b px-3 py-2">
                            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <Input
                              value={clientSearchQuery}
                              onChange={(e) => setClientSearchQuery(e.target.value)}
                              placeholder="Search client by name or email…"
                              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                            />
                          </div>
                          <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1">
                            {filteredClientOptions.length === 0 ? (
                              <p className="py-6 text-center text-sm text-muted-foreground">
                                No clients found.
                              </p>
                            ) : (
                              filteredClientOptions.map((opt) => {
                                const selected = inventoryOwnerId === opt.uid;
                                return (
                                  <button
                                    key={opt.uid}
                                    type="button"
                                    className={cn(
                                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                                      selected && "bg-accent"
                                    )}
                                    onClick={() => {
                                      setInventoryOwnerUserId(opt.uid);
                                      setPackageProducts([]);
                                      setProductSearchQuery("");
                                      setClientPickerOpen(false);
                                      setClientSearchQuery("");
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "h-4 w-4 shrink-0",
                                        selected ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <span className="truncate">{opt.label}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Products in this package (optional)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {showClientInventoryPicker
                        ? inventoryOwnerId
                          ? "Add one or more inventory products for this package. Weight/box size autofill from the selection."
                          : "Select a user above to load their products."
                        : "Add one or more products to this package (one label). Autofill combined weight/box, or enter package details manually."}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Popover
                        open={productPickerOpen}
                        modal={false}
                        onOpenChange={(open) => {
                          if (showClientInventoryPicker && !inventoryOwnerId) return;
                          setProductPickerOpen(open);
                          if (!open) setProductSearchQuery("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-expanded={productPickerOpen}
                            disabled={showClientInventoryPicker && !inventoryOwnerId}
                            className="relative z-10 w-full max-w-md justify-between font-normal pointer-events-auto"
                          >
                            <span className="truncate">
                              {packageProducts.length > 0
                                ? `${packageProducts.length} product${
                                    packageProducts.length === 1 ? "" : "s"
                                  } in package`
                                : showClientInventoryPicker && !inventoryOwnerId
                                  ? "Select user first…"
                                  : "Add products…"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="z-[200] w-[min(100vw-2rem,28rem)] p-0 pointer-events-auto"
                          align="start"
                          sideOffset={4}
                          onOpenAutoFocus={(e) => e.preventDefault()}
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          <div className="flex items-center gap-2 border-b px-3 py-2">
                            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <Input
                              value={productSearchQuery}
                              onChange={(e) => setProductSearchQuery(e.target.value)}
                              placeholder="Search by name or SKU…"
                              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                            />
                          </div>
                          <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1">
                            {filteredInventoryProductOptions.length === 0 ? (
                              <p className="py-6 text-center text-sm text-muted-foreground">
                                No products found.
                              </p>
                            ) : (
                              filteredInventoryProductOptions.map((item) => {
                                const dims = formatUnitDimensions(item);
                                const weight = formatUnitWeight(item);
                                const meta = [item.sku, dims, weight].filter(Boolean).join(" · ");
                                const selected = selectedInventoryProductIds.has(item.id);
                                const skuMatch = (shopifyOrderContext?.lineItems || []).some(
                                  (li) =>
                                    li.sku &&
                                    String(li.sku).trim().toLowerCase() ===
                                      String(item.sku || "").trim().toLowerCase()
                                );
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                      "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                                      selected && "bg-accent"
                                    )}
                                    onClick={() => togglePackageProduct(item)}
                                  >
                                    <Check
                                      className={cn(
                                        "mt-0.5 h-4 w-4 shrink-0",
                                        selected ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 truncate font-medium">
                                        <span className="truncate">{item.productName}</span>
                                        {skuMatch ? (
                                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                                            Order SKU
                                          </Badge>
                                        ) : null}
                                      </div>
                                      {meta ? (
                                        <div className="truncate text-xs text-muted-foreground">
                                          {meta}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-amber-700">
                                          No L/W/H or weight on file
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                          {packageProducts.length > 0 ? (
                            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                              Click again to remove. Keep picker open to add more.
                            </div>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                      {packageProducts.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 gap-1"
                          onClick={clearPackageProducts}
                        >
                          <X className="h-3.5 w-3.5" />
                          Clear all
                        </Button>
                      ) : null}
                    </div>
                    {packageProducts.length > 0 ? (
                      <div className="space-y-2 rounded-md border p-3">
                        {packageProducts.map((p) => (
                          <div
                            key={p.id}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{p.productName}</p>
                              {p.sku ? (
                                <p className="truncate text-xs text-muted-foreground">{p.sku}</p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Label className="text-xs text-muted-foreground">Qty</Label>
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                className="h-8 w-16 text-xs"
                                value={p.quantity}
                                onChange={(e) =>
                                  setPackageProductQuantity(p.id, Number(e.target.value))
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-destructive"
                                onClick={() => removePackageProduct(p.id)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          You can still edit weight and dimensions below after autofill.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Weight Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">Weight (includes packaging)</h3>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="parcel.weightPounds"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.01" 
                                    min="0"
                                    max="70"
                                    placeholder="0" 
                                    className="rounded-r-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={field.value ?? ""}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      if (value <= 70) {
                                        field.onChange(value);
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="flex items-center px-3 border border-l-0 border-input bg-muted rounded-r-md text-sm font-medium">
                            lbs
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Max: 70lbs</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="parcel.weightOunces"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.001" 
                                    min="0"
                                    max="15.999"
                                    placeholder="13" 
                                    className="rounded-r-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={field.value ?? ""}
                                    onChange={(e) => {
                                      const value = parseFloat(e.target.value) || 0;
                                      if (value <= 15.999) {
                                        field.onChange(value);
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="flex items-center px-3 border border-l-0 border-input bg-muted rounded-r-md text-sm font-medium">
                            oz
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Enter Package weight in ounces (1 pound = 16 oz).</p>
                      </div>
                    </div>
                  </div>

                  {/* Dimensions Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">Dimensions</h3>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Length</Label>
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="parcel.length"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.01" 
                                    placeholder="15" 
                                    className="rounded-r-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="parcel.distanceUnit"
                            render={({ field }) => (
                              <FormItem>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="w-[70px] rounded-l-none border-l-0">
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="in">in</SelectItem>
                                    <SelectItem value="ft">ft</SelectItem>
                                    <SelectItem value="cm">cm</SelectItem>
                                    <SelectItem value="m">m</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Width</Label>
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="parcel.width"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.01" 
                                    placeholder="4" 
                                    className="rounded-r-none"
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="parcel.distanceUnit"
                            render={({ field }) => (
                              <FormItem>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="w-[70px] rounded-l-none border-l-0">
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="in">in</SelectItem>
                                    <SelectItem value="ft">ft</SelectItem>
                                    <SelectItem value="cm">cm</SelectItem>
                                    <SelectItem value="m">m</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Height</Label>
                        <div className="flex gap-2">
                          <FormField
                            control={form.control}
                            name="parcel.height"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.01" 
                                    placeholder="4" 
                                    className="rounded-r-none"
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="parcel.distanceUnit"
                            render={({ field }) => (
                              <FormItem>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger className="w-[70px] rounded-l-none border-l-0">
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="in">in</SelectItem>
                                    <SelectItem value="ft">ft</SelectItem>
                                    <SelectItem value="cm">cm</SelectItem>
                                    <SelectItem value="m">m</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <ParcelBoxSuggestionCard
                    lengthIn={distanceToInches(
                      watchedParcel.length || 0,
                      watchedParcel.distanceUnit
                    )}
                    widthIn={distanceToInches(
                      watchedParcel.width || 0,
                      watchedParcel.distanceUnit
                    )}
                    heightIn={distanceToInches(
                      watchedParcel.height || 0,
                      watchedParcel.distanceUnit
                    )}
                    grossWeightLb={watchedGrossWeightLb}
                  />
              </div>

              <Button type="submit" disabled={loadingRates} className="w-full">
                {loadingRates ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Getting Rates...
                  </>
                ) : (
                  "Get Shipping Rates"
                )}
              </Button>
            </form>
          </Form>

          {/* Rates Selection */}
          {rates.length > 0 && (
            <div className="mt-6 space-y-4 pt-6 border-t">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                PrepCorex Shipping Rates
              </h3>
              <div className="space-y-2">
                {rates.map((rate) => (
                  <Card
                    key={rate.object_id}
                    className={`cursor-pointer transition-all ${
                      selectedRate?.object_id === rate.object_id
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedRate(rate)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{getRateDisplay(rate).provider}</p>
                          <p className="text-sm text-muted-foreground">
                            {getRateDisplay(rate).service}
                          </p>
                          {rate.serviceDescription ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {rate.serviceDescription}
                            </p>
                          ) : null}
                          {rate.deliveryEstimate ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Est. {rate.deliveryEstimate}
                            </p>
                          ) : rate.estimated_days ? (
                            <p className="text-xs text-muted-foreground mt-1">
                              Est. {rate.estimated_days} days
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">
                            ${parseFloat(rate.amount).toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground uppercase">
                            {rate.currency}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {editingCartItemId ? (
                <div className="mt-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  Editing a cart item. Change details, get rates again if needed, then save.
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-2 py-0"
                    onClick={handleCancelEditCartItem}
                  >
                    Cancel edit
                  </Button>
                </div>
              ) : null}

              {selectedRate && (
                <div className="mt-4 space-y-3">
                  {paymentMethodPicker}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    onClick={handleAddToCart}
                    variant="outline"
                    size="lg"
                  >
                    {editingCartItemId ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Update cart item
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Add To Cart
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handlePurchaseLabel}
                    disabled={loading || Boolean(editingCartItemId)}
                    size="lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                      ) : payWithWallet ? (
                        <>
                          <Wallet className="mr-2 h-4 w-4" />
                          Pay from wallet - ${parseFloat(selectedRate.amount).toFixed(2)}
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-2 h-4 w-4" />
                          Buy label - ${parseFloat(selectedRate.amount).toFixed(2)}
                      </>
                    )}
                  </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {cartItems.length > 0 && (
            <div className="mt-6 space-y-4 pt-6 border-t">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Label Cart ({cartItems.length})
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCartItems([]);
                    if (editingCartItemId) {
                      clearEditingCartState();
                      resetFormForNextLabel();
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              </div>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {cartItems.map((item, idx) => {
                  const isEditing = editingCartItemId === item.id;
                  return (
                  <div
                    key={item.id}
                    className={`rounded-md border p-3 text-sm ${
                      isEditing ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {idx + 1}. {getRateDisplay(item.selectedRate).provider} -{" "}
                          {getRateDisplay(item.selectedRate).service}
                          {isEditing ? (
                            <span className="ml-2 text-xs font-normal text-primary">Editing</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          To: {item.toAddress.name || "—"} · {item.toAddress.city},{" "}
                          {item.toAddress.state} {item.toAddress.zip}
                        </p>
                        {item.packageProducts && item.packageProducts.length > 0 ? (
                          <p className="text-xs text-muted-foreground mt-1">
                            Products:{" "}
                            {item.packageProducts
                              .map((p) => `${p.productName}×${p.quantity}`)
                              .join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <p className="font-semibold">
                          ${parseFloat(item.selectedRate.amount).toFixed(2)}
                        </p>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            disabled={Boolean(editingCartItemId) && !isEditing}
                            onClick={() => handleStartEditCartItem(item)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveCartItem(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Remove</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              {paymentMethodPicker}
              <Button
                onClick={handleStartBulkCheckout}
                disabled={loading || Boolean(editingCartItemId)}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting Bulk Checkout...
                  </>
                ) : payWithWallet ? (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Pay cart from wallet ({cartItems.length} labels)
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Buy labels ({cartItems.length})
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                {payWithWallet
                  ? "Each label is paid from your wallet balance."
                  : "One card payment for all cart labels. Labels are purchased automatically after payment."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


