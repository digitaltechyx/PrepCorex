 "use client";

 import { DollarSign } from "lucide-react";
 import { useCollection } from "@/hooks/use-collection";
 import type { UserProfile } from "@/types";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { Skeleton } from "@/components/ui/skeleton";
 import { PricingManagement } from "@/components/admin/pricing-management";
 import { PrepMarketRatesPanel } from "@/components/admin/prep-market-rates-panel";

 export default function AdminPricingPage() {
   const { data: users, loading: usersLoading } = useCollection<UserProfile>("users");

   return (
     <div className="space-y-6">
       <Card className="border-2 shadow-xl overflow-hidden">
         <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-600 text-white pb-4">
           <div className="flex items-center justify-between">
             <div>
               <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                 <DollarSign className="h-6 w-6" />
                 Pricing Management
               </CardTitle>
               <CardDescription className="text-amber-100 mt-2">
                 Configure user pricing and add-on rates
               </CardDescription>
             </div>
             <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
               <DollarSign className="h-7 w-7 text-white" />
             </div>
           </div>
         </CardHeader>
         <CardContent className="p-6">
           {usersLoading ? (
             <div className="space-y-3">
               <Skeleton className="h-6 w-48" />
               <Skeleton className="h-28 w-full" />
             </div>
           ) : (
             <PricingManagement users={users} />
           )}
         </CardContent>
       </Card>
       <PrepMarketRatesPanel />
     </div>
   );
 }

