import { adminDb } from "@/lib/firebase-admin";
import { getSubAdminManagedUserIds, hasRole } from "@/lib/permissions";
import type { UserProfile } from "@/types";

function mapUserDoc(docId: string, data: FirebaseFirestore.DocumentData): UserProfile {
  const uid = String(data.uid ?? docId).trim() || docId;
  return { ...data, uid } as UserProfile;
}

function displayName(user: UserProfile): string {
  return String(user.name ?? user.email ?? user.uid ?? "Unknown User").trim();
}

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

/** Resolve a client to the canonical Firestore users/{uid} doc id + display name. */
export async function resolveLexiClient(
  adminProfile: UserProfile,
  clientUserId: string,
  clientUserName?: string
): Promise<{ uid: string; name: string }> {
  const id = String(clientUserId ?? "").trim();
  const nameHint = String(clientUserName ?? "").trim();

  if (id) {
    const snap = await adminDb().collection("users").doc(id).get();
    if (snap.exists) {
      await assertLexiCanManageClient(adminProfile, snap.id);
      const profile = mapUserDoc(snap.id, snap.data()!);
      return { uid: snap.id, name: displayName(profile) };
    }
  }

  const query = norm(nameHint || id);
  if (!query) {
    throw new Error("Client not found. Use find_clients and pass the exact uid as clientUserId.");
  }

  const managed = await loadManagedClientProfiles(adminProfile);
  const matches = managed.filter((u) => {
    const name = norm(u.name);
    const email = norm(u.email);
    return name.includes(query) || email.includes(query) || query.includes(name);
  });

  if (matches.length === 1) {
    return { uid: matches[0].uid!, name: displayName(matches[0]) };
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple clients match "${nameHint || id}". Ask LEXI to pick one uid from find_clients.`
    );
  }

  throw new Error(
    `No client account found for "${nameHint || id}". Use find_clients and pass the exact uid.`
  );
}

export async function loadLexiAdminProfile(adminUid: string): Promise<UserProfile | null> {
  const snap = await adminDb().collection("users").doc(adminUid).get();
  if (!snap.exists) return null;
  return mapUserDoc(snap.id, snap.data()!);
}

export async function loadManagedClientProfiles(adminProfile: UserProfile): Promise<UserProfile[]> {
  const snap = await adminDb().collection("users").get();
  const all = snap.docs
    .map((d: FirebaseFirestore.QueryDocumentSnapshot) => mapUserDoc(d.id, d.data()))
    .filter((u: UserProfile) => Boolean(u.uid?.trim()) && u.uid !== adminProfile.uid);

  const managedIds = getSubAdminManagedUserIds(adminProfile, all);
  if (managedIds === null) return all;
  return all.filter((u: UserProfile) => u.uid && managedIds.includes(u.uid));
}

export async function assertLexiCanManageClient(
  adminProfile: UserProfile,
  clientUserId: string
): Promise<void> {
  if (hasRole(adminProfile, "admin")) return;
  const managed = await loadManagedClientProfiles(adminProfile);
  if (!managed.some((u) => u.uid === clientUserId)) {
    throw new Error("You do not have permission to act for this client.");
  }
}
