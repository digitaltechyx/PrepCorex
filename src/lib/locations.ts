import { collection, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { invalidateDefaultWarehouseLocationCache } from "@/lib/default-warehouse";
import type { Location } from "@/types";

const COLLECTION = "locations";

type CreateLocationInput =
  | string
  | {
      name: string;
      country?: string;
      stateOrProvince?: string;
      street1?: string;
      street2?: string;
      city?: string;
      zip?: string;
    };

export async function createLocation(input: CreateLocationInput): Promise<string> {
  const payload =
    typeof input === "string"
      ? { name: input.trim(), country: "", stateOrProvince: "" }
      : {
          name: input.name.trim(),
          country: (input.country || "").trim(),
          stateOrProvince: (input.stateOrProvince || "").trim(),
          street1: (input.street1 || "").trim(),
          street2: (input.street2 || "").trim(),
          city: (input.city || "").trim(),
          zip: (input.zip || "").trim(),
        };
  const ref = await addDoc(collection(db, COLLECTION), {
    name: payload.name,
    country: payload.country || undefined,
    stateOrProvince: payload.stateOrProvince || undefined,
    street1: payload.street1 || undefined,
    street2: payload.street2 || undefined,
    city: payload.city || undefined,
    zip: payload.zip || undefined,
    active: true,
    createdAt: new Date(),
  });
  invalidateDefaultWarehouseLocationCache();
  return ref.id;
}

export async function removeLocation(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
  invalidateDefaultWarehouseLocationCache();
}

export async function updateLocation(id: string, data: { name?: string; active?: boolean }): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), data as Record<string, unknown>);
  if (data.name !== undefined || data.active !== undefined) {
    invalidateDefaultWarehouseLocationCache();
  }
}

/** Map Firestore doc to Location (doc id = location id) */
export function docToLocation(docData: { id: string } & Record<string, unknown>): Location {
  return {
    id: docData.id,
    name: String(docData.name ?? ""),
    country: docData.country ? String(docData.country) : undefined,
    stateOrProvince: docData.stateOrProvince ? String(docData.stateOrProvince) : undefined,
    street1: docData.street1 ? String(docData.street1) : undefined,
    street2: docData.street2 ? String(docData.street2) : undefined,
    city: docData.city ? String(docData.city) : undefined,
    zip: docData.zip ? String(docData.zip) : undefined,
    active: Boolean(docData.active !== false),
    createdAt: docData.createdAt instanceof Date ? docData.createdAt : undefined,
  };
}
