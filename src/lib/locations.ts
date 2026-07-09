import { collection, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { invalidateDefaultWarehouseLocationCache } from "@/lib/default-warehouse";
import type { Location } from "@/types";

const COLLECTION = "locations";

type LocationFields = {
  name: string;
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
};

/** Firestore rejects `undefined` field values — omit empty optional fields. */
function buildLocationDocPayload(fields: LocationFields): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    name: fields.name,
    active: true,
    createdAt: new Date(),
  };
  const optional: (keyof Omit<LocationFields, "name">)[] = [
    "country",
    "stateOrProvince",
    "street1",
    "street2",
    "city",
    "zip",
  ];
  for (const key of optional) {
    const value = fields[key]?.trim();
    if (value) doc[key] = value;
  }
  return doc;
}

type CreateLocationInput =
  | string
  | LocationFields;

export async function createLocation(input: CreateLocationInput): Promise<string> {
  const fields: LocationFields =
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
  const ref = await addDoc(collection(db, COLLECTION), buildLocationDocPayload(fields));
  invalidateDefaultWarehouseLocationCache();
  return ref.id;
}

export async function removeLocation(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
  invalidateDefaultWarehouseLocationCache();
}

export type LocationAddressUpdate = {
  name?: string;
  active?: boolean;
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
};

export async function updateLocation(id: string, data: LocationAddressUpdate): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.active !== undefined) payload.active = Boolean(data.active);
  if (data.country !== undefined) payload.country = data.country.trim() || null;
  if (data.stateOrProvince !== undefined) payload.stateOrProvince = data.stateOrProvince.trim() || null;
  if (data.street1 !== undefined) payload.street1 = data.street1.trim() || null;
  if (data.street2 !== undefined) payload.street2 = data.street2.trim() || null;
  if (data.city !== undefined) payload.city = data.city.trim() || null;
  if (data.zip !== undefined) payload.zip = data.zip.trim() || null;
  if (!Object.keys(payload).length) return;
  await updateDoc(doc(db, COLLECTION, id), payload);
  invalidateDefaultWarehouseLocationCache();
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
