import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  buildUserUniqueFieldKeys,
  type UniqueFieldKind,
  UNIQUE_FIELD_MESSAGES,
  uniqueRegistryDocId,
  type UserUniqueFieldInput,
  type UserUniqueFieldKeys,
} from "@/lib/user-unique-fields";

const REGISTRY_COLLECTION = "userFieldUniques";

export type UniqueFieldConflict = {
  field: UniqueFieldKind;
  message: string;
};

export type CheckUserUniquenessResult = {
  ok: boolean;
  conflicts: UniqueFieldConflict[];
};

type RegistryEntry = {
  uid: string;
  field: UniqueFieldKind;
  value: string;
  updatedAt: FirebaseFirestore.Timestamp;
};

function fieldKeyMap(
  keys: UserUniqueFieldKeys
): Partial<Record<UniqueFieldKind, string>> {
  const map: Partial<Record<UniqueFieldKind, string>> = {};
  if (keys.companyNameKey) map.companyName = keys.companyNameKey;
  if (keys.einKey) map.ein = keys.einKey;
  if (keys.phoneKey) map.phone = keys.phoneKey;
  return map;
}

function storedKeysFromUser(data: FirebaseFirestore.DocumentData | undefined): UserUniqueFieldKeys {
  if (!data) return {};
  return {
    companyNameKey: (data.companyNameKey as string | undefined) ?? null,
    einKey: (data.einKey as string | undefined) ?? null,
    phoneKey: (data.phoneKey as string | undefined) ?? null,
  };
}

async function isUserActive(uid: string): Promise<boolean> {
  const snap = await adminDb().collection("users").doc(uid).get();
  if (!snap.exists) return false;
  const status = String(snap.data()?.status || "approved");
  return status !== "deleted";
}

export async function checkUserFieldsUnique(
  input: UserUniqueFieldInput,
  excludeUid?: string | null
): Promise<CheckUserUniquenessResult> {
  const keys = buildUserUniqueFieldKeys(input);
  const conflicts: UniqueFieldConflict[] = [];

  for (const [field, key] of Object.entries(fieldKeyMap(keys)) as [UniqueFieldKind, string][]) {
    const regRef = adminDb().collection(REGISTRY_COLLECTION).doc(uniqueRegistryDocId(field, key));
    const regSnap = await regRef.get();
    if (!regSnap.exists) continue;

    const ownerUid = String((regSnap.data() as RegistryEntry).uid || "");
    if (excludeUid && ownerUid === excludeUid) continue;
    if (!(await isUserActive(ownerUid))) continue;

    conflicts.push({ field, message: UNIQUE_FIELD_MESSAGES[field] });
  }

  return { ok: conflicts.length === 0, conflicts };
}

export async function claimUserFieldUniques(
  uid: string,
  input: UserUniqueFieldInput
): Promise<CheckUserUniquenessResult> {
  const userRef = adminDb().collection("users").doc(uid);
  const keys = buildUserUniqueFieldKeys(input);

  return adminDb().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const conflicts: UniqueFieldConflict[] = [];
    const toClaim = fieldKeyMap(keys);
    const priorStored = storedKeysFromUser(userSnap.exists ? userSnap.data() : undefined);

    for (const [field, key] of Object.entries(toClaim) as [UniqueFieldKind, string][]) {
      const regRef = adminDb().collection(REGISTRY_COLLECTION).doc(uniqueRegistryDocId(field, key));
      const regSnap = await tx.get(regRef);
      if (regSnap.exists) {
        const ownerUid = String(regSnap.data()?.uid || "");
        if (ownerUid !== uid) {
          conflicts.push({ field, message: UNIQUE_FIELD_MESSAGES[field] });
        }
      }
    }

    if (conflicts.length > 0) {
      return { ok: false, conflicts };
    }

    for (const [field, oldKey] of Object.entries(fieldKeyMap(priorStored)) as [
      UniqueFieldKind,
      string,
    ][]) {
      const newKey = toClaim[field];
      if (!oldKey || oldKey === newKey) continue;
      const regRef = adminDb()
        .collection(REGISTRY_COLLECTION)
        .doc(uniqueRegistryDocId(field, oldKey));
      const regSnap = await tx.get(regRef);
      if (regSnap.exists && String(regSnap.data()?.uid) === uid) {
        tx.delete(regRef);
      }
    }

    for (const [field, key] of Object.entries(toClaim) as [UniqueFieldKind, string][]) {
      const regRef = adminDb().collection(REGISTRY_COLLECTION).doc(uniqueRegistryDocId(field, key));
      tx.set(regRef, {
        uid,
        field,
        value: key,
        updatedAt: Timestamp.now(),
      } satisfies RegistryEntry);
    }

    tx.set(
      userRef,
      {
        companyNameKey: keys.companyNameKey ?? FieldValue.delete(),
        einKey: keys.einKey ?? FieldValue.delete(),
        phoneKey: keys.phoneKey ?? FieldValue.delete(),
      },
      { merge: true }
    );

    return { ok: true, conflicts: [] };
  });
}

export function formatUniquenessError(conflicts: UniqueFieldConflict[]): string {
  if (conflicts.length === 0) return "One or more fields are already in use.";
  return conflicts.map((c) => c.message).join(" ");
}
