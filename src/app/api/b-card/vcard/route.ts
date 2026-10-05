import { NextResponse } from "next/server";
import { buildBCardVCard } from "@/lib/b-card-profile";

export const dynamic = "force-dynamic";

/**
 * Serve Arshad's vCard as an inline contact file.
 * Mobile Safari/Chrome open this as Add Contact (not a forced download).
 */
export async function GET() {
  const vcard = buildBCardVCard();
  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="Arshad-Iqbal-Prep-Services-FBA.vcf"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
