import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const ROLES_PERMISSIONS_AUDIT_COLLECTION = "rolesPermissionsAudit";

export type RolesPermissionsAuditAction =
  | "roles_features_updated"
  | "access_reset_to_default"
  | "locations_assigned"
  | "locations_removed_from_users"
  | "location_updated"
  | "location_removed"
  | "default_location_changed";

export const ROLES_PERMISSIONS_AUDIT_ACTION_LABELS: Record<RolesPermissionsAuditAction, string> = {
  roles_features_updated: "Roles / features updated",
  access_reset_to_default: "Access reset to default",
  locations_assigned: "Locations assigned",
  locations_removed_from_users: "Locations removed from users",
  location_updated: "Location edited",
  location_removed: "Location deleted",
  default_location_changed: "Default location changed",
};

export type RolesPermissionsAuditEvent = {
  id: string;
  action: RolesPermissionsAuditAction;
  description: string;
  actorUid?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  targetUserIds?: string[];
  targetUserLabels?: string[];
  locationIds?: string[];
  locationLabels?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: Date | { seconds: number; nanoseconds?: number } | string | null;
};

export function rolesPermissionsAuditCreatedAtMs(
  createdAt: RolesPermissionsAuditEvent["createdAt"]
): number {
  if (!createdAt) return 0;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "string") {
    const t = Date.parse(createdAt);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof createdAt === "object" && typeof createdAt.seconds === "number") {
    return createdAt.seconds * 1000;
  }
  return 0;
}

export async function logRolesPermissionsEvent(input: {
  action: RolesPermissionsAuditAction;
  description: string;
  actorUid?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  targetUserIds?: string[];
  targetUserLabels?: string[];
  locationIds?: string[];
  locationLabels?: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await addDoc(collection(db, ROLES_PERMISSIONS_AUDIT_COLLECTION), {
      action: input.action,
      description: input.description,
      actorUid: input.actorUid ?? null,
      actorName: input.actorName ?? null,
      actorEmail: input.actorEmail ?? null,
      targetUserIds: input.targetUserIds ?? [],
      targetUserLabels: input.targetUserLabels ?? [],
      locationIds: input.locationIds ?? [],
      locationLabels: input.locationLabels ?? [],
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    });
  } catch {
    // Non-blocking — audit must not break admin flows
  }
}
