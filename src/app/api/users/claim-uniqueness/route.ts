import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, verifyBearerToken } from "@/lib/api-admin-auth";
import { claimUserFieldUniques } from "@/lib/user-uniqueness-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  companyName: z.string().max(200).optional(),
  ein: z.string().max(32).optional(),
  phone: z.string().max(32).optional(),
  uid: z.string().max(128).optional(),
});

export async function POST(request: NextRequest) {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const targetUid = body.uid?.trim() || decoded.uid;
  if (targetUid !== decoded.uid) {
    const auth = await requireAdmin(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  try {
    const result = await claimUserFieldUniques(targetUid, {
      companyName: body.companyName,
      ein: body.ein,
      phone: body.phone,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[POST /api/users/claim-uniqueness]", e);
    return NextResponse.json({ error: "Failed to claim unique fields." }, { status: 500 });
  }
}
