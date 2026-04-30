 "use client";

 import { useMemo, useState } from "react";
 import { useAuth } from "@/hooks/use-auth";
 import { useCollection } from "@/hooks/use-collection";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import type { FbaPackAddOnConfig } from "@/lib/pricing-utils";
import { catalogFromPricingDoc } from "@/lib/additional-services-catalog";

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

type PalletStorageCycleDoc = {
  id: string;
  status?: "active" | "closed";
  assignedAt?: any;
  nextInvoiceDate?: any;
  lastInvoicedAt?: any;
  source?: string;
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
   extraServices?: unknown;
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

type ShippedOrderDoc = {
  id: string;
  date?: any;
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

function pickLatestWithFallback<T extends { updatedAt?: any; createdAt?: any }>(
  userDocs: T[] | undefined,
  defaultDocs: T[] | undefined
): T | null {
  const userLatest = pickLatest(userDocs || []);
  if (userLatest) return userLatest;
  return pickLatest(defaultDocs || []);
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

function fbmRangeForDailyOrders(avgDailyOrders: number): "1-10" | "11-24" | "25-49" | "50+" {
  if (avgDailyOrders >= 50) return "50+";
  if (avgDailyOrders >= 25) return "25-49";
  if (avgDailyOrders >= 11) return "11-24";
  return "1-10";
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
  const { data: defaultPricingList } = useCollection<PricingRuleDoc>("defaultPricing");
   const { data: storagePricingList, loading: storageLoading } = useCollection<StoragePricingDoc>(
     uid ? `users/${uid}/storagePricing` : ""
   );
  const { data: defaultStoragePricingList } = useCollection<StoragePricingDoc>("defaultStoragePricing");
   const { data: boxForwardingPricingList, loading: boxLoading } = useCollection<SimplePriceDoc>(
     uid ? `users/${uid}/boxForwardingPricing` : ""
   );
  const { data: defaultBoxForwardingPricingList } = useCollection<SimplePriceDoc>("defaultBoxForwardingPricing");
   const { data: palletForwardingPricingList, loading: palletLoading } = useCollection<SimplePriceDoc>(
     uid ? `users/${uid}/palletForwardingPricing` : ""
   );
  const { data: defaultPalletForwardingPricingList } = useCollection<SimplePriceDoc>("defaultPalletForwardingPricing");
   const { data: containerHandlingPricingList, loading: containerLoading } = useCollection<ContainerHandlingDoc>(
     uid ? `users/${uid}/containerHandlingPricing` : ""
   );
  const { data: defaultContainerHandlingPricingList } = useCollection<ContainerHandlingDoc>("defaultContainerHandlingPricing");
   const { data: additionalServicesPricingList, loading: additionalLoading } = useCollection<AdditionalServicesDoc>(
     uid ? `users/${uid}/additionalServicesPricing` : ""
   );
  const { data: defaultAdditionalServicesPricingList } = useCollection<AdditionalServicesDoc>("defaultAdditionalServicesPricing");
  const { data: fbaPackAddOnPricingList, loading: fbaPackLoading } = useCollection<FbaPackAddOnPricingDoc>(
    uid ? `users/${uid}/fbaPackAddOnPricing` : ""
  );
  const { data: defaultFbaPackAddOnPricingList } = useCollection<FbaPackAddOnPricingDoc>("defaultFbaPackAddOnPricing");
  const { data: shippedOrders } = useCollection<ShippedOrderDoc>(
    uid ? `users/${uid}/shipped` : ""
  );
  const { data: palletStorageCycles } = useCollection<PalletStorageCycleDoc>(
    uid ? `users/${uid}/palletStorageCycles` : ""
  );

   const pricingByKey = useMemo(() => {
     const map = new Map<string, PricingRuleDoc>();
    for (const d of defaultPricingList || []) {
      if (!d.service || !d.package || !d.quantityRange || !d.productType) continue;
      const key = `${d.service}|${d.package}|${d.quantityRange}|${d.productType}`;
      map.set(key, d);
    }
    for (const d of pricingList || []) {
       if (!d.service || !d.package || !d.quantityRange || !d.productType) continue;
       const key = `${d.service}|${d.package}|${d.quantityRange}|${d.productType}`;
      map.set(key, d);
     }
     return map;
  }, [pricingList, defaultPricingList]);

  const latestStorage = useMemo(() => pickLatestWithFallback(storagePricingList, defaultStoragePricingList), [storagePricingList, defaultStoragePricingList]);
  const latestBox = useMemo(() => pickLatestWithFallback(boxForwardingPricingList, defaultBoxForwardingPricingList), [boxForwardingPricingList, defaultBoxForwardingPricingList]);
  const latestPallet = useMemo(() => pickLatestWithFallback(palletForwardingPricingList, defaultPalletForwardingPricingList), [palletForwardingPricingList, defaultPalletForwardingPricingList]);
  const latestAdditional = useMemo(() => pickLatestWithFallback(additionalServicesPricingList, defaultAdditionalServicesPricingList), [additionalServicesPricingList, defaultAdditionalServicesPricingList]);
  const additionalServicesCatalogRows = useMemo(
    () => catalogFromPricingDoc(latestAdditional as AdditionalServicesDoc | null),
    [latestAdditional]
  );
  const latestFbaPack = useMemo(() => pickLatestWithFallback(fbaPackAddOnPricingList, defaultFbaPackAddOnPricingList), [fbaPackAddOnPricingList, defaultFbaPackAddOnPricingList]);

   const containerBySize = useMemo(() => {
     const m = new Map<string, ContainerHandlingDoc>();
    for (const d of defaultContainerHandlingPricingList || []) {
      const size = normalizeSize(d.containerSize);
      m.set(size, d);
    }
    for (const d of containerHandlingPricingList || []) {
       const size = normalizeSize(d.containerSize);
      m.set(size, d);
     }
     return m;
  }, [containerHandlingPricingList, defaultContainerHandlingPricingList]);

  const isLoading = pricingLoading || storageLoading || boxLoading || palletLoading || containerLoading || additionalLoading || fbaPackLoading;
  const sortedPalletCycles = useMemo(
    () =>
      [...(palletStorageCycles || [])].sort(
        (a, b) => toMs(b.assignedAt || b.createdAt) - toMs(a.assignedAt || a.createdAt)
      ),
    [palletStorageCycles]
  );
  const activePalletCount = useMemo(
    () => (palletStorageCycles || []).filter((c) => c.status !== "closed").length,
    [palletStorageCycles]
  );
  const adminManualPalletCount = useMemo(
    () =>
      (palletStorageCycles || []).filter(
        (c) => c.status !== "closed" && String((c as { source?: string }).source || "") === "admin_manual"
      ).length,
    [palletStorageCycles]
  );

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

    const weeklyOrderStats = (() => {
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const weeklyOrders = (shippedOrders || []).filter((order) => {
        const timestamp = order.date ?? order.createdAt;
        const ms = toMs(timestamp);
        return ms >= sevenDaysAgo && ms <= now;
      }).length;
      const avgDailyOrders = weeklyOrders / 7;
      return { weeklyOrders, avgDailyOrders };
    })();

    const currentRange = fbmRangeForDailyOrders(weeklyOrderStats.avgDailyOrders);
    const currentRangeIndex = rows.findIndex((r) => r.range === currentRange);
    const nextRange = currentRangeIndex >= 0 && currentRangeIndex < rows.length - 1 ? rows[currentRangeIndex + 1] : null;

    return (
      <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
        <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-indigo-50 pb-3 dark:from-slate-900 dark:to-slate-900">
          <CardTitle className="text-xl text-violet-700 dark:text-violet-300">FBM Fulfillment Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5 text-sm">
          <div className="relative overflow-hidden rounded-lg border border-amber-300/80 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 px-3 py-2.5 text-sm text-amber-900 shadow-sm dark:border-amber-700/60 dark:from-amber-950/50 dark:via-yellow-950/40 dark:to-amber-900/30 dark:text-amber-200">
            <div className="pointer-events-none absolute -left-10 top-0 h-full w-1/3 -skew-x-12 bg-white/40 blur-sm animate-pulse dark:bg-white/10" />
            <div className="relative flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 animate-pulse dark:text-amber-300" />
              <div className="space-y-0.5">
                <div className="font-medium">
                  You are currently in: <span className="font-semibold">{currentRange} orders/day</span>{" "}
                  {"->"}{" "}
                  <span className="font-semibold">{money(getFbmPrice(currentRange, "Standard"))}</span> (Standard)
                </div>
                {nextRange ? (
                  <div>
                    Weekly avg: <span className="font-semibold">{weeklyOrderStats.avgDailyOrders.toFixed(1)} orders/day</span>. Reach{" "}
                    <span className="font-semibold">{nextRange.range} orders/day</span> to unlock:{" "}
                    <span className="font-semibold">{money(getFbmPrice(nextRange.range, "Standard"))}</span> pricing.
                  </div>
                ) : (
                  <div>
                    Weekly avg: <span className="font-semibold">{weeklyOrderStats.avgDailyOrders.toFixed(1)} orders/day</span>. You are already at the highest FBM tier.
                  </div>
                )}
              </div>
            </div>
          </div>

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
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Storage Pricing</CardTitle>
           </CardHeader>
          <CardContent className="max-w-md space-y-1.5 pt-0 text-sm">
             {latestStorage ? (
               <>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                  <span className="text-muted-foreground">Storage Type</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-medium">{latestStorage.storageType || (userProfile as any)?.storageType || "-"}</span>
                 </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                  <span className="text-muted-foreground">Price</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-semibold tabular-nums">{money(latestStorage.price)}</span>
                 </div>
                 {(latestStorage.storageType === "pallet_base" || (userProfile as any)?.storageType === "pallet_base") && (
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                    <span className="text-muted-foreground">Pallet Count</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium tabular-nums">{activePalletCount || latestStorage.palletCount || 0}</span>
                   </div>
                 )}
                 {(latestStorage.storageType === "pallet_base" || (userProfile as any)?.storageType === "pallet_base") &&
                   adminManualPalletCount > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {adminManualPalletCount} admin-assigned pallet{adminManualPalletCount === 1 ? "" : "s"}; the rest follow inventory.
                    </div>
                  )}
                 {(latestStorage.storageType === "pallet_base" || (userProfile as any)?.storageType === "pallet_base") && sortedPalletCycles.length > 0 && (
                  <div className="pt-2 mt-1 border-t space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">Recent Pallet Logs</div>
                    {sortedPalletCycles.slice(0, 5).map((cycle) => (
                      <div key={cycle.id} className="text-xs text-muted-foreground flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-foreground">{cycle.status === "closed" ? "Closed" : "Active"}</span>
                        <span className="rounded bg-muted px-1.5 py-0 text-[10px] uppercase tracking-wide">
                          {String((cycle as PalletStorageCycleDoc).source || "") === "admin_manual" ? "Admin" : "Inv"}
                        </span>
                        <span>Added: {formatUpdated(cycle.assignedAt) || "-"}</span>
                        <span>Next invoice: {formatUpdated(cycle.nextInvoiceDate) || "-"}</span>
                      </div>
                    ))}
                  </div>
                 )}
                 {formatUpdated(latestStorage.updatedAt || latestStorage.createdAt) && (
                  <div className="text-xs text-muted-foreground pt-2 mt-1 border-t">
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
                   <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                     <span className="text-muted-foreground">Assigned Type</span>
                     <span className="text-muted-foreground">·</span>
                     <span className="font-medium">{(userProfile as any).storageType}</span>
                   </div>
                 )}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Box Forwarding" className="mt-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Box Forwarding</CardTitle>
           </CardHeader>
          <CardContent className="max-w-md space-y-1.5 pt-0 text-sm">
             <div className="text-xs text-muted-foreground">
               Applies when you select shipment type <span className="font-medium">Box Forwarding</span>.
             </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
              <span className="text-muted-foreground">Forwarding Price</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums">{latestBox ? money(latestBox.price) : "-"}</span>
             </div>
             {!latestBox && (
               <div className="text-xs text-muted-foreground">
                 Not configured by admin yet.
               </div>
             )}
            {latestBox && formatUpdated(latestBox.updatedAt || latestBox.createdAt) && (
              <div className="text-xs text-muted-foreground pt-2 mt-1 border-t">
                 Last updated: {formatUpdated(latestBox.updatedAt || latestBox.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Pallet Forwarding" className="mt-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pallet Forwarding</CardTitle>
           </CardHeader>
          <CardContent className="max-w-md space-y-1.5 pt-0 text-sm">
             <div className="text-xs text-muted-foreground">
               Applies when you select shipment type <span className="font-medium">Pallet</span> and sub-type <span className="font-medium">Forwarding</span>.
             </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
              <span className="text-muted-foreground">Forwarding Price</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums">{latestPallet ? money(latestPallet.price) : "-"}</span>
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
              <div className="text-xs text-muted-foreground pt-2 mt-1 border-t">
                 Last updated: {formatUpdated(latestPallet.updatedAt || latestPallet.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>

       <TabsContent value="Container Handling" className="mt-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Container Handling</CardTitle>
           </CardHeader>
          <CardContent className="max-w-md space-y-1.5 pt-0 text-sm">
             <div className="text-xs text-muted-foreground">
               Container handling rates are set by admin per container size.
             </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
              <span className="text-muted-foreground">20 ft</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums">{money(containerBySize.get("20feet")?.price)}</span>
             </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
              <span className="text-muted-foreground">40 ft</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-semibold tabular-nums">{money(containerBySize.get("40feet")?.price)}</span>
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
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Additional Services</CardTitle>
           </CardHeader>
          <CardContent className="max-w-md space-y-1.5 pt-0 text-sm">
             <div className="text-xs text-muted-foreground">
               These rates are used for invoicing when you request additional services.
             </div>
             {latestAdditional ? (
              <div className="space-y-1">
                 {additionalServicesCatalogRows.map((row) => (
                   <div
                     key={row.key}
                    className="border-b border-border/50 py-2 last:border-0 last:pb-0"
                   >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium leading-tight">{row.name}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-semibold tabular-nums">{money(row.price)}</span>
                    </div>
                    {row.description ? (
                      <div className="text-[11px] text-muted-foreground">{row.description}</div>
                    ) : null}
                   </div>
                 ))}
               </div>
             ) : (
               <div className="text-xs text-muted-foreground">Not configured by admin yet.</div>
             )}
            {latestAdditional && formatUpdated(latestAdditional.updatedAt || latestAdditional.createdAt) && (
              <div className="text-xs text-muted-foreground pt-2 mt-1 border-t">
                 Last updated: {formatUpdated(latestAdditional.updatedAt || latestAdditional.createdAt)}
               </div>
             )}
           </CardContent>
         </Card>
       </TabsContent>
     </Tabs>
   );
 }


