import { NextResponse } from "next/server";
import { listPlatformDocumentSummaries } from "@/lib/platform-documents-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const documents = await listPlatformDocumentSummaries();
    return NextResponse.json({ documents });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load documents" },
      { status: 500 }
    );
  }
}
