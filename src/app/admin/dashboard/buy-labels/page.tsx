"use client";

import { BuyLabelsForm } from "@/components/dashboard/buy-labels-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "lucide-react";

export default function AdminBuyLabelsPage() {
  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Tag className="h-6 w-6" />
                Buy Label
              </CardTitle>
              <CardDescription className="text-cyan-100 mt-2">
                Purchase shipping labels from the admin dashboard.
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Tag className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <BuyLabelsForm />
        </CardContent>
      </Card>
    </div>
  );
}
