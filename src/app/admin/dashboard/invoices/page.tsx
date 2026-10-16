"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign } from "lucide-react";
import { InvoiceManagement } from "@/components/admin/invoice-management";
import { useManagedUsers } from "@/hooks/use-managed-users";

export default function AdminInvoicesPage() {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab") as "pending" | "paid" | null;
  const { managedUsers: users } = useManagedUsers();

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-indigo-500 to-blue-600 pb-3 text-white sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                <FileText className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                Invoice Management
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-indigo-100 sm:mt-2 sm:text-sm">
                View and manage all invoices across all users
              </CardDescription>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
              <DollarSign className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="p-3 sm:p-6">
            <InvoiceManagement users={users} initialTab={tabFromUrl} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
