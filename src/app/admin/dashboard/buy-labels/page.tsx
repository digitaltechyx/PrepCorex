import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AdminBuyLabelsPageContent from "./content";

function BuyLabelsFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export default function AdminBuyLabelsPage() {
  return (
    <Suspense fallback={<BuyLabelsFallback />}>
      <AdminBuyLabelsPageContent />
    </Suspense>
  );
}
