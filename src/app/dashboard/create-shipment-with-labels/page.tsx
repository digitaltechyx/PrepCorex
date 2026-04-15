 "use client";

 import { PackagePlus } from "lucide-react";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
 import { useAuth } from "@/hooks/use-auth";
 import { useCollection } from "@/hooks/use-collection";
 import type { InventoryItem } from "@/types";
 import { CreateShipmentWithLabelsForm } from "@/components/dashboard/create-shipment-with-labels-form";
 import { Skeleton } from "@/components/ui/skeleton";

 export default function CreateShipmentWithLabelsPage() {
   const { userProfile } = useAuth();
   const uid = userProfile?.uid || "";
   const { data: inventory, loading } = useCollection<InventoryItem>(uid ? `users/${uid}/inventory` : "");

   return (
     <div className="space-y-6">
       <Card className="border-2 shadow-xl overflow-hidden">
         <CardHeader className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white pb-4">
           <div className="flex items-center justify-between">
             <div>
               <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                 <PackagePlus className="h-6 w-6" />
                Create Outbound Shipment
               </CardTitle>
               <CardDescription className="text-blue-100 mt-2">
                 Create a shipment request and upload labels (if needed)
               </CardDescription>
             </div>
             <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
               <PackagePlus className="h-7 w-7 text-white" />
             </div>
           </div>
         </CardHeader>
         <CardContent className="p-6">
           {loading ? (
             <div className="space-y-3">
               <Skeleton className="h-6 w-48" />
               <Skeleton className="h-28 w-full" />
             </div>
           ) : (
             <CreateShipmentWithLabelsForm inventory={inventory} />
           )}
         </CardContent>
       </Card>
     </div>
   );
 }

