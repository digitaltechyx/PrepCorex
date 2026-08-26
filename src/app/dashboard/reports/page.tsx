"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { ClientReportsDashboard } from "@/components/dashboard/client-reports-dashboard";

export default function ClientReportsPage() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900 pb-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl font-bold text-white">
                <BarChart3 className="h-6 w-6" />
                Reports
              </CardTitle>
              <CardDescription className="mt-2 text-slate-200">
                See how much you save on labels and prep — plus inventory, invoices, and detailed
                savings breakdowns
              </CardDescription>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
              <BarChart3 className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <ClientReportsDashboard />
        </CardContent>
      </Card>
    </div>
  );
}
