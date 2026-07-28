import { redirect } from "next/navigation";

export default function AdminPurchasedLabelsPage() {
  redirect("/admin/dashboard/buy-labels?tab=purchased");
}
