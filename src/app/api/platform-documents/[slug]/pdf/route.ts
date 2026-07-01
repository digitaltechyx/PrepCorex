import { NextRequest, NextResponse } from "next/server";
import {
  generatePlatformDocumentPDF,
  platformDocumentPdfFilename,
} from "@/lib/platform-document-pdf";
import { getPlatformDocument } from "@/lib/platform-documents-server";
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
    const blob = await generatePlatformDocumentPDF(document);
    const buffer = Buffer.from(await blob.arrayBuffer());
    const filename = platformDocumentPdfFilename(document);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate PDF" },
      { status: 500 }
    );
  }
}
