import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  veeqoGetOrder,
  veeqoGetRates,
  veeqoSetAllocationPackage,
  type VeeqoPackageInput,
} from "@/lib/veeqo-api";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

async function resolveCaller(request: NextRequest): Promise<{ callerUid: string; isAdmin: boolean }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
  return {
    callerUid: decoded.uid,
    isAdmin: isAdminOrSubAdmin(userDoc.data() as Record<string, unknown> | undefined),
  };
}

/**
 * POST: set package dims on allocation (optional) then fetch rates.
 * Body: userId?, connectionId, orderId, allocationId?, package: { weight, width, height, depth, ... }
 */
export async function POST(request: NextRequest) {
  try {
    const { callerUid, isAdmin } = await resolveCaller(request);
    const body = await request.json();
    const uid = String(body.userId || "").trim() || callerUid;
    if (uid !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const connectionId = String(body.connectionId || "").trim();
    const orderId = Number(body.orderId);
    if (!connectionId || !Number.isFinite(orderId)) {
      return NextResponse.json(
        { error: "connectionId and orderId are required" },
        { status: 400 }
      );
    }

    const connSnap = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("veeqoConnections")
      .doc(connectionId)
      .get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const apiKey = String(connSnap.data()?.apiKey || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Veeqo credentials missing" }, { status: 400 });
    }

    const creds = { apiKey };
    const order = await veeqoGetOrder(creds, orderId);
    const allocations = Array.isArray(order.allocations) ? order.allocations : [];
    let allocationId = Number(body.allocationId);
    if (!Number.isFinite(allocationId) || allocationId <= 0) {
      allocationId = allocations[0]?.id ?? 0;
    }
    if (!allocationId) {
      return NextResponse.json(
        { error: "No allocation found on this Veeqo order" },
        { status: 400 }
      );
    }

    const pkgRaw = body.package as Partial<VeeqoPackageInput> | undefined;
    if (pkgRaw) {
      const weight = Number(pkgRaw.weight);
      const width = Number(pkgRaw.width);
      const height = Number(pkgRaw.height);
      const depth = Number(pkgRaw.depth);
      if (![weight, width, height, depth].every((n) => Number.isFinite(n) && n > 0)) {
        return NextResponse.json(
          { error: "Package weight, width, height, and depth must be positive numbers" },
          { status: 400 }
        );
      }
      await veeqoSetAllocationPackage(creds, allocationId, {
        weight,
        width,
        height,
        depth,
        weightUnit: pkgRaw.weightUnit === "g" ? "g" : "oz",
        dimensionsUnit: pkgRaw.dimensionsUnit === "cm" ? "cm" : "inches",
      });
    }

    const rates = await veeqoGetRates(creds, allocationId);
    const available = Array.isArray(rates.available) ? rates.available : [];

    return NextResponse.json({
      ok: true,
      orderId,
      allocationId,
      available,
      unavailable: rates.unavailable || [],
      linkedAccounts: rates.linked_accounts || [],
      errorMessages: rates.error_messages || [],
    });
  } catch (error: unknown) {
    console.error("[veeqo rates]", error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get Veeqo rates" },
      { status: status === 401 ? 401 : status === 403 ? 403 : 500 }
    );
  }
}
