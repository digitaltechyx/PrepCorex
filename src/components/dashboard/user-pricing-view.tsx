 "use client";

 import { useMemo, useState } from "react";
 import { useAuth } from "@/hooks/use-auth";
 import { useCollection } from "@/hooks/use-collection";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Skeleton } from "@/components/ui/skeleton";
import type { FbaPackAddOnConfig } from "@/lib/pricing-utils";

 type PricingRuleDoc = {
   id: string;
   userId?: string;
   service?: string;
   package?: string;
   quantityRange?: string;
   productType?: string;
   rate?: number;
   packOf?: number;
   updatedAt?: any;
   createdAt?: any;
 };

 type StoragePricingDoc = {
   id: string;
   storageType?: string;
   price?: number;
   palletCount?: number;
   updatedAt?: any;
   createdAt?: any;
 };

 type SimplePriceDoc = {
   id: string;
   price?: number;
   updatedAt?: any;
   createdAt?: any;
 };

 type ContainerHandlingDoc = {
   id: string;
   containerSize?: string;
   price?: number;
   updatedAt?: any;
   createdAt?: any;
 };

 type AdditionalServicesDoc = {
   id: string;
   bubbleWrapPrice?: number;
   stickerRemovalPrice?: number;
   warningLabelPrice?: number;
   updatedAt?: any;
   createdAt?: any;
 };

const FBA_PACKAGES = [
  { package: "Starter", quantityRange: "1-999" },
  { package: "Standard", quantityRange: "1000-2499" },
  { package: "Premium", quantityRange: "2500+" },
] as const;

 const FBM_PACKAGES = [
  { package: "Tier 1", quantityRange: "1-10" },
  { package: "Tier 2", quantityRange: "11-24" },
  { package: "Tier 3", quantityRange: "25-49" },
  { package: "Tier 4", quantityRange: "50+" },
 ] as const;

 const PRODUCT_TYPES = ["Standard", "Large"] as const;

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

type FbaPackAddOnPricingDoc = FbaPackAddOnConfig & {
  id: string;
  updatedAt?: any;
  createdAt?: any;
};

 function toMs(v: any): number {
   if (!v) return 0;
   if (typeof v === "string") {
     const t = new Date(v).getTime();
     return Number.isNaN(t) ? 0 : t;
   }
   if (typeof v?.toDate === "function") return v.toDate().getTime();
   if (typeof v?.seconds === "number") return v.seconds * 1000;
   if (v instanceof Date) return v.getTime();
   return 0;
 }

 function formatUpdated(v: any): string {
   const ms = toMs(v);
   if (!ms) return "";
   try {
     return new Intl.DateTimeFormat(undefined, {
       year: "numeric",
       month: "short",
       day: "2-digit",
       hour: "2-digit",
       minute: "2-digit",
     }).format(new Date(ms));
   } catch {
     return "";
   }
 }

 function money(v: unknown): string {
   const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
   if (!Number.isFinite(n)) return "-";
   return `$${n.toFixed(2)}`;
 }

 function pickLatest<T extends { updatedAt?: any; createdAt?: any }>(docs: T[]): T | null {
   if (!docs || docs.length === 0) return null;
   return [...docs].sort((a, b) => toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt))[0] ?? null;
 }

 function normalizeSize(input: unknown): string {
   const raw = (typeof input === "string" ? input : "").toLowerCase();
   const compact = raw.replace(/\s+/g, "");
   if (compact.includes("20") && compact.includes("feet")) return "20feet";
   if (compact.includes("40") && compact.includes("feet")) return "40feet";
   if (compact.includes("20") && compact.includes("ft")) return "20feet";
   if (compact.includes("40") && compact.includes("ft")) return "40feet";
   return compact || "unknown";
 }

 function productTypeLabel(t: string) {
   if (t === "Standard") return "Standard (6x6x6) - <3lbs";
   if (t === "Large") return "Large (10x10x10) - <6lbs";
   return t;
 }

 export function UserPricingView() {
   const { userProfile } = useAuth();
   const uid = userProfile?.uid || "";
   const [activeTab, setActiveTab] = useState<string>("FBA/WFS/TFS");

   const { data: pricingList, loading: pricingLoading, error: pricingError } = useCollection<PricingRuleDoc>(
     uid ? `users/${uid}/pricing` : ""
   );
   const { data: storagePricingList, loading: storageLoading } = useCollection<StoragePricingDoc>(
     uid ? `users/${uid}/storagePricing` : ""
   );
   const { data: boxForwardingPricingList, loading: boxLoading } = useCollection<SimplePriceDoc>(
     uid ? `users/${uid}/boxForwardingPricing` : ""
   );
   const { data: palletForwardingPricingList, loading: palletLoading } = useCollection<SimplePriceDoc>(
     uid ? `users/${uid}/palletForwardingPricing` : ""
   );
   const { data: containerHandlingPricingList, loading: containerLoading } = useCollection<ContainerHandlingDoc>(
     uid ? `users/${uid}/containerHandlingPricing` : ""
   );
   const { data: additionalServicesPricingList, loading: additionalLoading } = useCollection<AdditionalServicesDoc>(
     uid ? `users/${uid}/additionalServicesPricing` : ""
   );
  const { data: fbaPackAddOnPricingList, loading: fbaPackLoading } = useCollection<FbaPackAddOnPricingDoc>(
    uid ? `users/${uid}/fbaPackAddOnPricing` : ""
  );

   const pricingByKey = useMemo(() => {
     const map = new Map<string, PricingRuleDoc>();
     for (const d of pricingList || []) {
       if (!d.service || !d.package || !d.quantityRange || !d.productType) continue;
       const key = `${d.service}|${d.package}|${d.quantityRange}|${d.productType}`;
       const prev = map.get(key);
       if (!prev || toMs(d.updatedAt || d.createdAt) > toMs(prev.updatedAt || prev.createdAt)) {
         map.set(key, d);
       }
     }
     return map;
   }, [pricingList]);

   const latestStorage = useMemo(() => pickLatest(storagePricingList || []), [storagePricingList]);
   const latestBox = useMemo(() => pickLatest(boxForwardingPricingList || []), [boxForwardingPricingList]);
   const latestPallet = useMemo(() => pickLatest(palletForwardingPricingList || []), [palletForwardingPricingList]);
   const latestAdditional = useMemo(() => pickLatest(additionalServicesPricingList || []), [additionalServicesPricingList]);
  const latestFbaPack = useMemo(() => pickLatest(fbaPackAddOnPricingList || []), [fbaPackAddOnPricingList]);

   const containerBySize = useMemo(() => {
     const m = new Map<string, ContainerHandlingDoc>();
     for (const d of containerHandlingPricingList || []) {
       const size = normalizeSize(d.containerSize);
       const prev = m.get(size);
       if (!prev || toMs(d.updatedAt || d.createdAt) > toMs(prev.updatedAt || prev.createdAt)) m.set(size, d);
     }
     return m;
   }, [containerHandlingPricingList]);

  const isLoading = pricingLoading || storageLoading || boxLoading || palletLoading || containerLoading || additionalLoading || fbaPackLoading;

   if (!uid) {
     return <div className="text-sm text-muted-foreground">Loading user…</div>;
   }

   if (isLoading) {
     return (
       <div className="space-y-3">
         <Skeleton className="h-10 w-full" />
         <Skeleton className="h-44 w-full" />
       </div>
     );
   }

   if (pricingError) {
     return (
       <div className="text-sm">
         <div className="font-medium text-destructive">Pricing couldn’t be loaded.</div>
         <div className="text-muted-foreground mt-1">This is usually a Firestore permission/rules issue.</div>
       </div>
     );
   }

   const renderServiceTable = (service: "FBA/WFS/TFS" | "FBM") => {
     const pkgs = service === "FBM" ? FBM_PACKAGES : FBA_PACKAGES;
     return (
       <div className="overflow-x-auto">
         <table className="w-full border-collapse">
           <thead>
             <tr className="border-b bg-muted">
               <th className="text-left p-2 text-sm font-medium">Package</th>
               <th className="text-left p-2 text-sm font-medium">Range</th>
               <th className="text-left p-2 text-sm font-medium">Product Type</th>
               <th className="text-left p-2 text-sm font-medium">Rate ($)</th>
                    <th className="text-left p-2 text-sm font-medium">Pack Add-on</th>
             </tr>
           </thead>
           <tbody>
             {pkgs.flatMap((pkg) =>
               PRODUCT_TYPES.map((pt) => {
                 const key = `${service}|${pkg.package}|${pkg.quantityRange}|${pt}`;
                 const rule = pricingByKey.get(key);
                const fbaDefaultRate =
                  service === "FBA/WFS/TFS"
                    ? DEFAULT_FBA_RATES[`${pkg.quantityRange}|${pt}`]
                    : undefined;
                const rateToShow =
                  rule?.rate !== undefined && rule?.rate !== null ? rule.rate : fbaDefaultRate;
                 return (
                   <tr key={key} className="border-b hover:bg-muted/50">
                     <td className="p-2 text-sm">{pkg.package}</td>
                     <td className="p-2 text-sm">{pkg.quantityRange}</td>
                     <td className="p-2 text-sm">{productTypeLabel(pt)}</td>
                    <td className="p-2 text-sm font-medium">{money(rateToShow)}</td>
                    <td className="p-2 text-sm font-medium">
                      {service === "FBA/WFS/TFS"
                        ? "$0.35 (2-3) / $0.75 (4-12)"
                        : money(rule?.packOf)}
                    </td>
                   </tr>
                 );
               })
             )}
           </tbody>
         </table>
       </div>
     );
   };

  const renderFbaPlans = () => {
    const getFbaPrice = (range: (typeof FBA_PACKAGES)[number]["quantityRange"], productType: "Standard" | "Large") => {
      const pkg = FBA_PACKAGES.find((p) => p.quantityRange === range);
      if (!pkg) return undefined;
      const key = `FBA/WFS/TFS|${pkg.package}|${pkg.quantityRange}|${productType}`;
      const rule = pricingByKey.get(key);
      if (rule?.rate !== undefined && rule?.rate !== null) return rule.rate;
      return DEFAULT_FBA_RATES[`${range}|${productType}`];
    };

    const volumeRows: Array<{ range: "1-999" | "1000-2499" | "2500+"; label: string }> = [
      { range: "1-999", label: "1-999 units" },
      { range: "1000-2499", label: "1,000-2,499 units" },
      { range: "2500+", label: "2,500+ units" },
    ];

    const includedItems = [
      "Receiving & inspection",
      "Labeling & standard prep",
      "Packaging & forwarding",
      "24-72 hour turnaround",
    ];

    const plans: Array<{ title: string; productType: "Standard" | "Large" }> = [
      { title: "Standard Units", productType: "Standard" },
      { title: "Large/Heavy Units", productType: "Large" },
    ];
    const pack2to3 = typeof latestFbaPack?.pack2to3 === "number" ? latestFbaPack.pack2to3 : 0.35;
    const pack4to12 = typeof latestFbaPack?.pack4to12 === "number" ? latestFbaPack.pack4to12 : 0.75;

    return (
      <div className="space-y-4">
        <div className="grid gap-5 md:grid-cols-2">
          {plans.map((plan) => (
            <Card
              key={plan.title}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/70"
            >
              <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 pb-3 dark:from-slate-900 dark:to-slate-900">
                <CardTitle className="text-xl text-blue-700 dark:text-blue-300">{plan.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-5 text-sm">
                <div className="grid grid-cols-2 gap-3 border-b pb-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monthly Volume</div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Price</div>
                  {volumeRows.map((row) => (
                    <div key={`${plan.productType}-${row.range}`} className="contents">
                      <div className="text-[15px]">{row.label}</div>
                      <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                        {money(getFbaPrice(row.range, plan.productType))}/unit
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div className="mb-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Pack Add-on Pricing</div>
                  <div className="text-sm text-emerald-900 dark:text-emerald-200">{money(pack2to3)} for pack 2-3</div>
                  <div className="text-sm text-emerald-900 dark:text-emerald-200">{money(pack4to12)} for pack 4-12</div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-semibold">What's Included</div>
                  <div className="space-y-1.5 text-[15px]">
                    {includedItems.map((item) => (
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
      </div>
    );
  };

  const renderFbmPlan = () => {
    const rows: Array<{ range: "1-10" | "11-24" | "25-49" | "50+"; label: string }> = [
      { range: "1-10", label: "1-10" },
      { range: "11-24", label: "11-24" },
      { range: "25-49", label: "25-49" },
      { range: "50+", label: "50+" },
    ];
    const getFbmPrice = (range: (typeof rows)[number]["range"], productType: "Standard" | "Large") => {
      const pkg = FBM_PACKAGES.find((p) => p.quantityRange === range);
      if (!pkg) return undefined;
      const key = `FBM|${pkg.package}|${pkg.quantityRange}|${productType}`;
      const rule = pricingByKey.get(key);
      if (rule?.rate !== undefined && rule?.rate !== null) return rule.rate;
      return DEFAULT_FBM_RATES[`${range}|${productType}`];
    };

    const includedItems = [
      "Pick, pack, packaging, labeling",
      "Same-day shipping (before cutoff)",
      "24-48 hr guaranteed turnaround",
    ];

    return (
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
        <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-indigo-50 pb-3 dark:from-slate-900 dark:to-slate-900">
          <CardTitle className="text-xl text-violet-700 dark:text-violet-300">FBM Fulfillment Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5 text-sm">
          <div className="grid grid-cols-3 gap-3 border-b pb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Volume (Daily)</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your Price (Standard)</div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Large Items</div>
            {rows.map((row) => (
              <div key={row.range} className="contents">
                <div className="text-[15px]">{row.label}</div>
                <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{money(getFbmPrice(row.range, "Standard"))}</div>
                <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{money(getFbmPrice(row.range, "Large"))}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">What's Included</div>
            <div className="space-y-1.5 text-[15px]">
              {includedItems.map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-600">{"\u2713"}</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

   return (
     <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)} className="w-full">
       <div className="overflow-x-auto mb-4">
         <TabsList className="inline-flex min-w-full w-auto h-auto p-1 bg-muted rounded-lg">
           <TabsTrigger value="FBA/WFS/TFS" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             FBA/WFS/TFS
           </TabsTrigger>
           <TabsTrigger value="FBM" className="data-[state=active]:bg-purple-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             FBM
           </TabsTrigger>
           <TabsTrigger value="Storage" className="data-[state=active]:bg-green-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             Storage
           </TabsTrigger>
           <TabsTrigger value="Box Forwarding" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             Box Forwarding
           </TabsTrigger>
           <TabsTrigger value="Pallet Forwarding" className="data-[state=active]:bg-red-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             Pallet Forwarding
           </TabsTrigger>
           <TabsTrigger value="Container Handling" className="data-[state=active]:bg-teal-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             Container Handling
           </TabsTrigger>
           <TabsTrigger value="Additional Services" className="data-[state=active]:bg-pink-500 data-[state=active]:text-white whitespace-nowrap px-4 py-2">
             Additional Services
           </TabsTrigger>
         </TabsList>
       </div>

       <TabsContent value="FBA/WFS/TFS" className="mt-4">
        {renderFbaPlans()}
       </TabsContent>

       <TabsContent value="FBM" className="mt-4">
        {renderFbmPlan()}
       </TabsContent>

       <TabsContent value="Storage" className="mt-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-base">Storage Pricing</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             {latestStorage ? (
               <>
                 <div className="flex items-center justify-between">
                   <span>Storage Type</span>
                   <span className="font-medium">{latestStorage.storageType || (userProfile as any)?.storageType || "-"}</span>
                 </div>
                 <div className="flex items-center justify-between">
                   <span>Price</span>
                   <span className="font-semibold">{money(latestStorage.price)}</span>
                 </div>
                 {(latestStorage.storageType === "pallet_base" || (userProfile as any)?.storageType === "pallet_base") && (
                   <div className="flex items-center justify-between">
                     <span>Pallet Count</span>
                     <span className="font-medium">{latestStorage.palletCount ?? "-"}</span>
                   </div>
                 )}
                 {formatUpdated(latestStorage.updatedAt || latestStorage.createdAt) && (
                   <div className="text-xs text-muted-foreground pt-2 border-t">
                     Last updated: {formatUpdated(latestStorage.updatedAt || latestStorage.createdAt)}
                   </div>
                 )}
               </>
             ) : (
               <div className="space-y-2">
                 <div className="text-muted-foreground">
                   Storage pricing is not configured yet.
                 </div>
                 <div className="text-xs text-muted-foreground">
                   Your admin will set this based on your assigned storage type.
                 </div>
                 {(userProfile as any)?.storageType && (
                   <div className="flex items-center justify-between text-xs">
                     <span className="text-muted-foreground">Assigned Type</span>
                     <span className="font-medium">{(userProfile as any).storageType}</span>
                   </div>
                 )}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Box Forwarding" className="mt-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-base">Box Forwarding</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             <div className="text-xs text-muted-foreground">
               Applies when you select shipment type <span className="font-medium">Box Forwarding</span>.
             </div>
             <div className="flex items-center justify-between">
               <span>Forwarding Price</span>
               <span className="font-semibold">{latestBox ? money(latestBox.price) : "-"}</span>
             </div>
             {!latestBox && (
               <div className="text-xs text-muted-foreground">
                 Not configured by admin yet.
               </div>
             )}
             {latestBox && formatUpdated(latestBox.updatedAt || latestBox.createdAt) && (
               <div className="text-xs text-muted-foreground pt-2 border-t">
                 Last updated: {formatUpdated(latestBox.updatedAt || latestBox.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Pallet Forwarding" className="mt-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-base">Pallet Forwarding</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             <div className="text-xs text-muted-foreground">
               Applies when you select shipment type <span className="font-medium">Pallet</span> and sub-type <span className="font-medium">Forwarding</span>.
             </div>
             <div className="flex items-center justify-between">
               <span>Forwarding Price</span>
               <span className="font-semibold">{latestPallet ? money(latestPallet.price) : "-"}</span>
             </div>
             {!latestPallet && (
               <div className="text-xs text-muted-foreground">
                 Not configured by admin yet.
               </div>
             )}
             <div className="text-xs text-muted-foreground">
               Pallet “Existing Inventory” pricing is handled manually at approval.
             </div>
             {latestPallet && formatUpdated(latestPallet.updatedAt || latestPallet.createdAt) && (
               <div className="text-xs text-muted-foreground pt-2 border-t">
                 Last updated: {formatUpdated(latestPallet.updatedAt || latestPallet.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Container Handling" className="mt-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-base">Container Handling</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             <div className="text-xs text-muted-foreground">
               Container handling rates are set by admin per container size.
             </div>
             <div className="flex items-center justify-between">
               <span>20 ft</span>
               <span className="font-semibold">{money(containerBySize.get("20feet")?.price)}</span>
             </div>
             <div className="flex items-center justify-between">
               <span>40 ft</span>
               <span className="font-semibold">{money(containerBySize.get("40feet")?.price)}</span>
             </div>
             {!containerBySize.get("20feet") && !containerBySize.get("40feet") && (
               <div className="text-xs text-muted-foreground">
                 Not configured by admin yet.
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Additional Services" className="mt-4">
         <Card>
           <CardHeader>
             <CardTitle className="text-base">Additional Services</CardTitle>
           </CardHeader>
           <CardContent className="space-y-2 text-sm">
             <div className="text-xs text-muted-foreground">
               These rates are used for invoicing when you request additional services.
             </div>
             <div className="flex items-center justify-between">
               <span>Bubble Wrap (per ft)</span>
               <span className="font-semibold">{latestAdditional ? money(latestAdditional.bubbleWrapPrice) : "-"}</span>
             </div>
             <div className="flex items-center justify-between">
               <span>Sticker Removal (per item)</span>
               <span className="font-semibold">{latestAdditional ? money(latestAdditional.stickerRemovalPrice) : "-"}</span>
             </div>
             <div className="flex items-center justify-between">
               <span>Warning Labels (per label)</span>
               <span className="font-semibold">{latestAdditional ? money(latestAdditional.warningLabelPrice) : "-"}</span>
             </div>
             {!latestAdditional && (
               <div className="text-xs text-muted-foreground">
                 Not configured by admin yet.
               </div>
             )}
             {latestAdditional && formatUpdated(latestAdditional.updatedAt || latestAdditional.createdAt) && (
               <div className="text-xs text-muted-foreground pt-2 border-t">
                 Last updated: {formatUpdated(latestAdditional.updatedAt || latestAdditional.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>
     </Tabs>
   );
 }


