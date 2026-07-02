import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { deletePlatformDocumentVersion } from "@/lib/platform-documents-server";
import { isPlatformDocumentSlug } from "@/lib/platform-documents-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string; version: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { slug, version: versionParam } = await context.params;
  if (!isPlatformDocumentSlug(slug)) {
    return NextResponse.json({ error: "Invalid document slug." }, { status: 400 });
  }

  const version = Number(versionParam);
  if (!Number.isFinite(version) || version <= 0) {
    return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
  }

  try {
    await deletePlatformDocumentVersion(slug, version);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete archived version." },
      { status: 400 }
    );
  }
}
