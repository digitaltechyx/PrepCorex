import { adminDb } from "@/lib/firebase-admin";
import { getSubAdminManagedUserIds, hasRole } from "@/lib/permissions";
import type { UserProfile } from "@/types";

function mapUserDoc(uid: string, data: FirebaseFirestore.DocumentData): UserProfile {
  return { uid, ...data } as UserProfile;
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
    .filter((u: UserProfile) => u.uid && u.uid !== adminProfile.uid);

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
