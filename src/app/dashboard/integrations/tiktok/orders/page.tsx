import { redirect } from "next/navigation";

/** Legacy URL — client TikTok orders live at /dashboard/tiktok-orders */
export default async function LegacyTikTokOrdersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ connectionId?: string }>;
}) {
  const sp = await searchParams;
  const qs = sp.connectionId ? `?connectionId=${encodeURIComponent(sp.connectionId)}` : "";
  redirect(`/dashboard/tiktok-orders${qs}`);
}
