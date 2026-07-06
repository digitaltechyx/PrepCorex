"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShoppingCart, MapPin, Package, CreditCard, Plus, Trash2, Upload } from "lucide-react";
import {
  BuyLabelsBulkImportDialog,
  type BuyLabelCartImportItem,
} from "@/components/dashboard/buy-labels-bulk-import-dialog";
import { BUY_LABELS_FROM_NAME } from "@/lib/buy-labels-bulk-import";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { getStripePublishableKey } from "@/lib/stripe";
import { PaymentDialog } from "./payment-dialog";
import type { ShippingAddress, ParcelDetails, ShippingRate } from "@/types";
import { formatWarehouseDisplayName, isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import { locationToFromShippingAddress } from "@/lib/location-shipping-address";
import { canUseCsvImport } from "@/lib/csv-import-permissions";

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

const addressSchema = z.object({
  name: z.string().min(1, "Name is required"),
  street1: z.string().min(1, "Street address is required"),
  street2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(5, "ZIP code is required"),
  country: z.string().min(1, "Country is required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
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
  fromAddress: addressSchema,
  toAddress: addressSchema,
  parcel: parcelSchema,
});

type FormValues = z.infer<typeof formSchema>;

type LabelCartItem = {
  id: string;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails & { weight: number; weightUnit: "lb" };
  selectedRate: ShippingRate;
  shipmentId: string | null;
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
  phone: "",
  email: "",
};

const DEFAULT_PARCEL: FormValues["parcel"] = {
  length: 15,
  width: 4,
  height: 4,
  weightPounds: 0,
  weightOunces: 13,
  distanceUnit: "in",
};

export function BuyLabelsForm() {
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
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [paymentAmountCents, setPaymentAmountCents] = useState(0);
  const [paymentCurrency, setPaymentCurrency] = useState("usd");
  const [cartItems, setCartItems] = useState<LabelCartItem[]>([]);
  const [checkoutMode, setCheckoutMode] = useState<"single" | "bulk" | null>(null);
  const [selectedFromLocationId, setSelectedFromLocationId] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const canImportBuyLabels = canUseCsvImport(userProfile, "buy_labels");

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
        phone: "",
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

  const defaultFromName = BUY_LABELS_FROM_NAME;

  const buildFromAddressForLocation = (location: LocationDoc) =>
    locationToFromShippingAddress(location, {
      shipperName: defaultFromName,
      phone: userProfile?.phone || "",
      email: userProfile?.email || "",
    });

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
  };

  useEffect(() => {
    if (locationOptions.length === 0) return;
    if (selectedFromLocationId && locationOptions.some((loc) => loc.id === selectedFromLocationId)) return;

    const preferred =
      locationOptions.find((loc) => isDefaultNj2Warehouse(loc.name)) ||
      locationOptions[0];
    if (!preferred) return;
    setSelectedFromLocationId(preferred.id);
  }, [locationOptions, selectedFromLocationId]);

  useEffect(() => {
    if (!selectedFromLocation) return;
    applyFromAddressFromLocation(selectedFromLocation);
  }, [selectedFromLocationId, selectedFromLocation?.id]);

  const fromAddressLocked = Boolean(selectedFromLocation);

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

      const response = await fetch("/api/shippo/rates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromAddress: data.fromAddress,
          toAddress: data.toAddress,
          parcel: parcelData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to get rates");
      }

      const ratesData = await response.json();
      setRates(ratesData.rates || []);
      setShipmentId(ratesData.shipment_id || null);
      
      if (ratesData.rates && ratesData.rates.length > 0) {
        toast({
          title: "Rates Retrieved",
          description: `Found ${ratesData.rates.length} shipping options.`,
        });
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

    const amount = Math.round(parseFloat(item.selectedRate.amount) * 100);
    const paymentResponse = await fetch("/api/stripe/create-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: user.uid,
        amount,
        currency: item.selectedRate.currency.toLowerCase(),
        fromAddress: item.fromAddress,
        toAddress: item.toAddress,
        parcel: item.parcel,
        selectedRate: {
          objectId: item.selectedRate.object_id,
          amount: item.selectedRate.amount,
          currency: item.selectedRate.currency,
          provider: item.selectedRate.provider,
          serviceLevel: item.selectedRate.servicelevel.name,
          shipmentId: item.shipmentId || (item.selectedRate as any).shipment,
        },
      }),
    });

    if (!paymentResponse.ok) {
      const errorData = await paymentResponse.json();
      const errorMessage = errorData.details
        ? `${errorData.error}: ${errorData.details}`
        : errorData.error || "Failed to create payment";
      throw new Error(errorMessage);
    }

    const { clientSecret } = await paymentResponse.json();
    setClientSecret(clientSecret);
    setPaymentAmountCents(amount);
    setPaymentCurrency(item.selectedRate.currency || "usd");
    setPaymentDialogOpen(true);
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
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAddress: formData.fromAddress,
      toAddress: formData.toAddress,
      parcel: parcelData,
      selectedRate,
      shipmentId: shipmentId || (selectedRate as any).shipment || null,
    };
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
    setCartItems((prev) => [...prev, item]);
    resetFormForNextLabel();
    setRates([]);
    setSelectedRate(null);
    setShipmentId(null);
    toast({
      title: "Added to cart",
      description: `${item.selectedRate.provider} ${item.selectedRate.servicelevel.name} added.`,
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
      const response = await fetch("/api/stripe/create-bulk-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.uid,
          items: cartItems.map((item) => ({
            fromAddress: item.fromAddress,
            toAddress: item.toAddress,
            parcel: item.parcel,
            selectedRate: {
              objectId: item.selectedRate.object_id,
              amount: item.selectedRate.amount,
              currency: item.selectedRate.currency,
              provider: item.selectedRate.provider,
              serviceLevel: item.selectedRate.servicelevel.name,
              shipmentId: item.shipmentId || (item.selectedRate as any).shipment,
            },
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to start bulk checkout.");
      }

      const { clientSecret, amount, currency } = await response.json();
      setCheckoutMode("bulk");
      setClientSecret(clientSecret);
      setPaymentAmountCents(amount);
      setPaymentCurrency(currency || "usd");
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

  const handlePaymentSuccess = () => {
    if (checkoutMode === "bulk") {
      setCartItems([]);
    }

    // Reset form after successful payment
    resetFormForNextLabel();
    setRates([]);
    setSelectedRate(null);
    setShipmentId(null);
    setClientSecret(null);
    setCheckoutMode(null);
    
    // Redirect to purchased labels page
    router.push("/dashboard/purchased-labels");
  };

  return (
    <div className="space-y-6">
      {stripePromise && clientSecret && (
        <Elements stripe={stripePromise}>
          <PaymentDialog
            open={paymentDialogOpen}
            onOpenChange={setPaymentDialogOpen}
            clientSecret={clientSecret}
            amount={paymentAmountCents}
            currency={paymentCurrency}
            onSuccess={handlePaymentSuccess}
          />
        </Elements>
      )}
      {canImportBuyLabels ? (
        <BuyLabelsBulkImportDialog
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
          locationOptions={locationOptions}
          defaultFromName={defaultFromName}
          defaultFromPhone={userProfile?.phone || ""}
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
                        From address is filled automatically from the selected warehouse location.
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
                          <Input placeholder="Prep Services FBA" {...field} disabled={fromAddressLocked} />
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
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 (555) 123-4567" {...field} />
                        </FormControl>
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
                          <Input placeholder="123 Main St" {...field} disabled={fromAddressLocked} />
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
                          <Input placeholder="Apt 4B" {...field} disabled={fromAddressLocked} />
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
                          disabled={fromAddressLocked}
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
                          <Select onValueChange={field.onChange} value={field.value} disabled={fromAddressLocked}>
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
                          <Input placeholder="New York" {...field} disabled={fromAddressLocked} />
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
                          <Input placeholder="10001" {...field} disabled={fromAddressLocked} />
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
                          <Input placeholder="+1 (555) 987-6543" {...field} />
                        </FormControl>
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
                        <Select onValueChange={(value) => {
                          field.onChange(value);
                          // Reset state when country changes
                          form.setValue("toAddress.state", "");
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
                    name="toAddress.state"
                    render={({ field }) => {
                      const selectedCountry = form.watch("toAddress.country");
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
                                    step="1" 
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
                Select Shipping Rate
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
                          <p className="font-semibold">{rate.provider}</p>
                          <p className="text-sm text-muted-foreground">
                            {rate.servicelevel.name}
                          </p>
                          {rate.estimated_days && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Est. {rate.estimated_days} days
                            </p>
                          )}
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

              {selectedRate && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mt-4">
                  <Button
                    onClick={handleAddToCart}
                    variant="outline"
                    size="lg"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add To Cart
                  </Button>
                  <Button
                    onClick={handlePurchaseLabel}
                    disabled={loading}
                    size="lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-2 h-4 w-4" />
                        Buy Now - ${parseFloat(selectedRate.amount).toFixed(2)}
                      </>
                    )}
                  </Button>
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
                  onClick={() => setCartItems([])}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              </div>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {cartItems.map((item, idx) => (
                  <div key={item.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">
                        {idx + 1}. {item.selectedRate.provider} - {item.selectedRate.servicelevel.name}
                      </p>
                      <p className="font-semibold">${parseFloat(item.selectedRate.amount).toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      To: {item.toAddress.city}, {item.toAddress.state} {item.toAddress.zip}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleStartBulkCheckout}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting Bulk Checkout...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Checkout Cart ({cartItems.length} labels)
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                One payment for all cart labels. Labels are purchased automatically after payment.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


