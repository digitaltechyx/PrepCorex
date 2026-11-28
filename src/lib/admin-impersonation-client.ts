"use client";

import { auth } from "@/lib/firebase";

/**
 * Open a client dashboard preview in a new tab while keeping the admin Firebase
 * session unchanged. Multiple tabs can use different ?viewAs= uids at once.
 *
 * Never navigates the current admin tab away (popup-blocked → throw, keep admin).
 */
export async function beginViewAsClient(targetUid: string): Promise<void> {
  const uid = targetUid?.trim();
  if (!uid) throw new Error("User id is required.");

  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not authenticated.");

  const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}/impersonate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "preview" }),
  });

  const raw = await res.text();
  let data: { error?: string; client?: { uid?: string } } = {};
  try {
    data = raw ? (JSON.parse(raw) as { error?: string; client?: { uid?: string } }) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || raw?.slice(0, 180) || `HTTP ${res.status}`);
  }

  const clientUid = data.client?.uid || uid;
  const url = `/dashboard?viewAs=${encodeURIComponent(clientUid)}`;
  const opened = window.open(url, "_blank");

  if (!opened) {
    throw new Error(
      "Popup blocked. Allow popups for this site, then try again — your admin tab must stay open."
    );
  }

  try {
    opened.focus();
  } catch {
    // ignore
  }
}
