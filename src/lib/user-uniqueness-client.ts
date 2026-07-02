import type { UserUniqueFieldInput } from "@/lib/user-unique-fields";

export type UniquenessApiResult = {
  ok: boolean;
  conflicts?: { field: string; message: string }[];
  error?: string;
};

export async function checkUserFieldsUniqueClient(
  fields: UserUniqueFieldInput,
  excludeUid?: string
): Promise<UniquenessApiResult> {
  const res = await fetch("/api/users/check-uniqueness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, excludeUid }),
  });
  const data = (await res.json()) as UniquenessApiResult;
  if (!res.ok) {
    return { ok: false, error: data.error || "Could not validate uniqueness." };
  }
  return data;
}

export async function claimUserFieldUniquesClient(
  token: string,
  fields: UserUniqueFieldInput,
  uid?: string
): Promise<UniquenessApiResult> {
  const res = await fetch("/api/users/claim-uniqueness", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...fields, uid }),
  });
  const data = (await res.json()) as UniquenessApiResult;
  if (!res.ok) {
    return { ok: false, error: data.error || "Could not reserve unique fields." };
  }
  return data;
}

export function uniquenessConflictMessage(result: UniquenessApiResult): string {
  if (result.conflicts?.length) {
    return result.conflicts.map((c) => c.message).join(" ");
  }
  return result.error || "One or more fields are already in use.";
}
