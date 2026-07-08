"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { ReportsDashboard } from "@/components/admin/reports-dashboard";
import { useManagedUsers } from "@/hooks/use-managed-users";

export default function AdminReportsPage() {
  const { managedUsers: users } = useManagedUsers();

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <BarChart3 className="h-6 w-6" />
                Reports & Analytics
              </CardTitle>
              <CardDescription className="text-slate-200 mt-2">
                Financial, commission, client activity, operations, and audit reporting with CSV detail exports and PDF executive summaries
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <ReportsDashboard users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
