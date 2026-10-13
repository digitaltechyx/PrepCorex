"use client";

import { GofoSandboxTester } from "@/components/admin/gofo-sandbox-tester";

export default function AdminGofoSandboxPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">GOFO Sandbox</h1>
        <p className="text-sm text-muted-foreground">
          Internal admin tester for GOFO Buy Label API. Clients cannot see this page.
        </p>
      </div>
      <GofoSandboxTester />
    </div>
  );
}
