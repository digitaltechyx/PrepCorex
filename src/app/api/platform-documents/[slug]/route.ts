import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { parseDocumentVersionInput } from "@/lib/document-version-utils";
import { getPlatformDocument, savePlatformDocument } from "@/lib/platform-documents-server";
import { isPlatformDocumentSlug } from "@/lib/platform-documents-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  if (!isPlatformDocumentSlug(slug)) {
    return NextResponse.json({ error: "Invalid document slug." }, { status: 400 });
  }

  try {
    const document = await getPlatformDocument(slug);
    return NextResponse.json(
      { document },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load document" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { slug } = await context.params;
  if (!isPlatformDocumentSlug(slug)) {
    return NextResponse.json({ error: "Invalid document slug." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const title = String(body.title || "").trim();
    const subtitle = body.subtitle != null ? String(body.subtitle) : undefined;
    const sections = Array.isArray(body.sections) ? body.sections : [];
    let version: number;
    try {
      version = parseDocumentVersionInput(String(body.version ?? ""));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid version." },
        { status: 400 }
      );
    }

    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    if (sections.length === 0) {
      return NextResponse.json({ error: "At least one section is required." }, { status: 400 });
    }

    const document = await savePlatformDocument(
      slug,
      {
        title,
        subtitle,
        version,
        sections: sections.map((s: { title?: string; body?: string }) => ({
          title: String(s.title || ""),
          body: String(s.body || ""),
        })),
      },
      { uid: auth.uid, name: auth.name }
    );

    return NextResponse.json({ document });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save document" },
      { status: 500 }
    );
  }
}
