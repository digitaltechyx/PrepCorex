import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

const COLLECTION = "crmAddressBook";

type LeadBody = {
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  notes?: string;
  source?: string;
};

function clean(value: unknown, max = 200): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LeadBody;
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const email = clean(body.email, 120).toLowerCase();
    const company = clean(body.company, 120);
    const notes = clean(body.notes, 500);
    const source = clean(body.source || "form", 40) || "form";

    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    if (!phone && !email) {
      return NextResponse.json(
        { error: "Phone or email is required." },
        { status: 400 }
      );
    }

    const ref = await adminDb().collection(COLLECTION).add({
      name,
      phone: phone || null,
      email: email || null,
      company: company || null,
      notes: notes || null,
      source,
      channel: "digital_b_card",
      ownerCard: "arshad-iqbal",
      createdAt: adminFieldValue().serverTimestamp(),
      updatedAt: adminFieldValue().serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err: unknown) {
    console.error("[b-card/leads]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save contact." },
      { status: 500 }
    );
  }
}
