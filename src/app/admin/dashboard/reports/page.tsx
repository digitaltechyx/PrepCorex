"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { ReportsDashboard } from "@/components/admin/reports-dashboard";
import { useManagedUsers } from "@/hooks/use-managed-users";

export default function AdminReportsPage() {
  const { managedUsers: users } = useManagedUsers();

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900 pb-3 text-white sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                <BarChart3 className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                Reports & Analytics
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-slate-200 sm:mt-2 sm:text-sm">
                Financial, commission, client activity, operations, and audit reporting with CSV and PDF exports
              </CardDescription>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm sm:flex">
              <BarChart3 className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <ReportsDashboard users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
