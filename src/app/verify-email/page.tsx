"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import VerifyEmailPage from "./verify-email-content";

export default function VerifyEmailRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <VerifyEmailPage />
    </Suspense>
  );
}
