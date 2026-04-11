/**
 * Export Firestore `users` collection to JSON (one file, local only).
 *
 * Requires the same Admin env vars as the app (.env.local):
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY  (with \n for newlines)
 *
 * Usage (from repo root):
 *   node scripts/export-firestore-users.js
 *
 * Optional:
 *   set OUT_FILE=./my-users.json
 *   set COLLECTION=users   (default: users)
 */

const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const admin = require("firebase-admin");

function deepSerialize(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) return value.map(deepSerialize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepSerialize(v);
    }
    return out;
  }
  return value;
}

async function main() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing env. Ensure .env.local has NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY."
    );
    process.exit(1);
  }

  const collectionName = process.env.COLLECTION || "users";
  const outFile = path.resolve(process.cwd(), process.env.OUT_FILE || "users-collection-export.json");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  const db = admin.firestore();
  const snap = await db.collection(collectionName).get();

  const rows = snap.docs.map((doc) => ({
    id: doc.id,
    ...deepSerialize(doc.data()),
  }));

  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2), "utf8");
  console.log(`Wrote ${rows.length} documents from "${collectionName}" to:\n  ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
