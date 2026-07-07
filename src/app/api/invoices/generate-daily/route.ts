import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";

import { adminDb } from "@/lib/firebase-admin";
import { generateInvoiceNumber } from "@/lib/invoice-utils";
import { applyClientInvoiceLifecycleFields } from "@/lib/client-invoice-lifecycle";
import type { ShippedItem } from "@/types";
import { normalizeShipmentItems } from "@/lib/shipment-utils";

const CRON_SECRET = process.env.INVOICE_CRON_SECRET;

function isAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${CRON_SECRET}`) return true;

  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  return secretParam === CRON_SECRET;
}

function resolveDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds !== undefined) {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function formatShipDate(value: any, fallback: string): string {
  const resolved = resolveDate(value);
  if (!resolved) return fallback;
  try {
    return format(resolved, "dd/MM/yyyy");
  } catch {
    return fallback;
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Handle both GET (for testing) and POST (for cron)
export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = adminDb();
    const usersSnapshot = await db.collection("users").get();
    const results: Array<Record<string, unknown>> = [];
    const today = new Date();
    const formattedDate = format(today, "yyyy-MM-dd");

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};

      // Get ALL shipments for this user (not just today's)
      const shipmentsSnapshot = await db
        .collection(`users/${userId}/shipped`)
        .orderBy("date", "asc") // Order by date for sequence
        .get();

      if (shipmentsSnapshot.empty) {
        results.push({ userId, status: "skipped_no_shipments" });
        continue;
      }

      // Get all existing invoices for this user to find already invoiced shipments
      const invoicesSnapshot = await db
        .collection(`users/${userId}/invoices`)
        .get();

      // Extract all shipmentIds that are already invoiced
      const invoicedShipmentIds = new Set<string>();
      invoicesSnapshot.docs.forEach((invoiceDoc) => {
        const invoiceData = invoiceDoc.data();
        if (invoiceData.items && Array.isArray(invoiceData.items)) {
          invoiceData.items.forEach((item: any) => {
            if (item.shipmentId) {
              invoicedShipmentIds.add(item.shipmentId);
            }
          });
        }
      });

      // Filter out shipments that are already invoiced
      const uninvoicedShipments = shipmentsSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...(doc.data() as ShippedItem),
        }))
        .filter((shipment) => !invoicedShipmentIds.has(shipment.id));

      if (uninvoicedShipments.length === 0) {
        results.push({ userId, status: "skipped_all_invoiced" });
        continue;
      }

      // Fetch inventory to get SKU information
      const inventorySnapshot = await db
        .collection(`users/${userId}/inventory`)
        .get();
      const inventoryMap = new Map();
      inventorySnapshot.docs.forEach((doc) => {
        const data = doc.data();
        inventoryMap.set(doc.id, data);
      });

      // Build invoice items from all uninvoiced shipments
      const allItems: Array<{
        quantity: number;
        productName: string;
        sku?: string;
        shipDate: string;
        packaging: string;
        unitPrice: number;
        amount: number;
        shipmentId: string;
      }> = [];
      
      // Aggregate additional services across all shipments
      let totalBubbleWrapFeet = 0;
      let totalStickerRemovalItems = 0;
      let totalWarningLabels = 0;
      let pricePerFoot = 0;
      let pricePerItem = 0;
      let pricePerLabel = 0;

      uninvoicedShipments.forEach((shipment) => {
        const shipDate = formatShipDate(shipment.date, "N/A");
        const normalizedItems = normalizeShipmentItems(shipment);

        normalizedItems.forEach((product) => {
          const quantity = Number(product.boxesShipped || 0);
          const unitPrice = Number(product.unitPrice || 0);
          const amount = quantity * unitPrice;

          if (quantity <= 0) {
            return;
          }

          // Get SKU from inventory if productId is available
          let sku: string | undefined;
          if (product.productId && inventoryMap.has(product.productId)) {
            const inventoryItem = inventoryMap.get(product.productId);
            sku = inventoryItem?.sku || undefined;
          }

          // Build item object, only including sku if it's defined
          const item: {
            quantity: number;
            productName: string;
            sku?: string;
            shipDate: string;
            packaging: string;
            unitPrice: number;
            amount: number;
            shipmentId: string;
          } = {
            quantity,
            productName: product.productName || "Unknown Item",
            shipDate,
            packaging: `${product.packOf ?? 1} Nos.`,
            unitPrice,
            amount,
            shipmentId: shipment.id,
          };

          // Only include sku field if it has a value (Firestore doesn't allow undefined)
          if (sku) {
            item.sku = sku;
          }

          allItems.push(item);
        });
        
        // Aggregate additional services
        if (shipment.additionalServices) {
          const services = shipment.additionalServices as any;
          totalBubbleWrapFeet += Number(services.bubbleWrapFeet || 0);
          totalStickerRemovalItems += Number(services.stickerRemovalItems || 0);
          totalWarningLabels += Number(services.warningLabels || 0);
          if (services.pricePerFoot && !pricePerFoot) pricePerFoot = Number(services.pricePerFoot);
          if (services.pricePerItem && !pricePerItem) pricePerItem = Number(services.pricePerItem);
          if (services.pricePerLabel && !pricePerLabel) pricePerLabel = Number(services.pricePerLabel);
        }
      });

      const items = allItems.filter((item) => item.quantity > 0);

      if (items.length === 0) {
        results.push({ userId, status: "skipped_no_billable_items" });
        continue;
      }

      const productSubtotal = items.reduce((sum, item) => sum + item.amount, 0);
      
      // Calculate additional services total
      const additionalServicesTotal = 
        (totalBubbleWrapFeet * pricePerFoot) +
        (totalStickerRemovalItems * pricePerItem) +
        (totalWarningLabels * pricePerLabel);
      
      const subtotal = productSubtotal + additionalServicesTotal;
      
      if (subtotal <= 0) {
        results.push({ userId, status: "skipped_zero_total" });
        continue;
      }

      const invoiceNumber = generateInvoiceNumber();
      const orderNumber = `ORD-${format(today, "yyyyMMdd")}-${Date.now()
        .toString()
        .slice(-4)}`;

      const invoicesRef = db.collection(`users/${userId}/invoices`);
      const baseInvoice: any = {
        invoiceNumber,
        date: formattedDate,
        orderNumber,
        soldTo: {
          name: userData.name || userData.companyName || "Client",
          email: userData.email || "",
          phone: userData.phone || "",
          address: userData.address || "",
        },
        fbm: "Standard Shipping",
        items,
        subtotal: productSubtotal,
        grandTotal: subtotal,
        status: "pending",
        createdAt: new Date(),
        userId,
        autoGenerated: true,
        autoGeneratedAt: new Date(),
      };
      
      // Include additional services if any
      if (additionalServicesTotal > 0) {
        baseInvoice.additionalServices = {
          bubbleWrapFeet: totalBubbleWrapFeet,
          stickerRemovalItems: totalStickerRemovalItems,
          warningLabels: totalWarningLabels,
          pricePerFoot,
          pricePerItem,
          pricePerLabel,
          total: additionalServicesTotal,
        };
      }

      const invoiceDoc = applyClientInvoiceLifecycleFields(baseInvoice);
      await invoicesRef.add(invoiceDoc);

      results.push({
        userId,
        status: "invoice_created",
        invoiceNumber,
        shipmentsProcessed: uninvoicedShipments.length,
        itemsProcessed: items.length,
        total: subtotal,
      });
    }

    return NextResponse.json({
      success: true,
      invoiceDate: formattedDate,
      results,
    });
  } catch (error: any) {
    console.error("Auto invoice generation failed:", error);
    return NextResponse.json(
      {
        error: "Auto invoice generation failed",
        details: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

