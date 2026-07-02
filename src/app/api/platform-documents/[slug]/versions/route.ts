import { NextResponse } from "next/server";
import { listPlatformDocumentVersions } from "@/lib/platform-documents-server";
import { isPlatformDocumentSlug } from "@/lib/platform-documents-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  if (!isPlatformDocumentSlug(slug)) {
    return NextResponse.json({ error: "Invalid document slug." }, { status: 400 });
  }

  try {
    const versions = await listPlatformDocumentVersions(slug);
    return NextResponse.json({ versions });
  } catch (e) {
    console.error("[GET /api/platform-documents/versions]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list versions." },
      { status: 500 }
    );
  }
}
