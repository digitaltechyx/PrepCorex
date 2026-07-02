import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkUserFieldsUnique } from "@/lib/user-uniqueness-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  companyName: z.string().max(200).optional(),
  ein: z.string().max(32).optional(),
  phone: z.string().max(32).optional(),
  excludeUid: z.string().max(128).optional(),
});

export async function POST(request: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await checkUserFieldsUnique(
      {
        companyName: body.companyName,
        ein: body.ein,
        phone: body.phone,
      },
      body.excludeUid
    );
    return NextResponse.json(result);
  } catch (e) {
    console.error("[POST /api/users/check-uniqueness]", e);
    return NextResponse.json({ error: "Failed to check uniqueness." }, { status: 500 });
  }
}
