import { google, type drive_v3 } from "googleapis";
import { adminDb } from "@/lib/firebase-admin";
import { cleanCameraLabel } from "@/lib/warehouse-camera-server";

export async function getGoogleDriveRefreshToken(): Promise<string> {
  const snap = await adminDb().collection("system").doc("googleDrive").get();
  const data = snap.exists ? snap.data() : null;
  if (data?.disabled === true) {
    throw new Error("Google Drive is disconnected");
  }
  const token =
    String(data?.refreshToken || "") || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "";
  if (!token) {
    throw new Error("Google Drive is not connected");
  }
  return token;
}

export async function getGoogleDriveClient(): Promise<{
  drive: drive_v3.Drive;
  accessToken: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth credentials are not configured");
  }
  const auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: await getGoogleDriveRefreshToken() });
  const access = await auth.getAccessToken();
  if (!access.token) {
    throw new Error("Google Drive access token could not be created");
  }
  return {
    drive: google.drive({ version: "v3", auth }),
    accessToken: access.token,
  };
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  const safeName = cleanCameraLabel(name, "Unknown");
  const result = await drive.files.list({
    q: `'${escapeDriveQuery(parentId)}' in parents and name='${escapeDriveQuery(
      safeName
    )}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
    spaces: "drive",
  });
  const existing = result.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Could not create Drive folder ${safeName}`);
  return created.data.id;
}

export async function ensureWarehouseVideoFolder(input: {
  drive: drive_v3.Drive;
  warehouseLabel: string;
  clientLabel: string;
  clientUserId: string;
  requestFolderName: string;
}): Promise<{ folderId: string; storagePath: string }> {
  let parentId = process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID || "root";
  const parts: string[] = [];
  if (!process.env.GOOGLE_DRIVE_VIDEO_FOLDER_ID) {
    const rootName = "PrepCorex Warehouse Recordings";
    parentId = await ensureFolder(input.drive, parentId, rootName);
    parts.push(rootName);
  }
  const folderNames = [
    input.warehouseLabel,
    `${input.clientLabel} (${input.clientUserId})`,
    "Receiving",
    input.requestFolderName,
  ];
  for (const folderName of folderNames) {
    parentId = await ensureFolder(input.drive, parentId, folderName);
    parts.push(cleanCameraLabel(folderName, "Unknown"));
  }
  return { folderId: parentId, storagePath: parts.join("/") };
}

export async function startGoogleDriveResumableVideoUpload(input: {
  accessToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  origin: string;
}): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.sizeBytes),
        Origin: input.origin,
      },
      body: JSON.stringify({
        name: input.fileName,
        parents: [input.folderId],
        description: "PrepCorex warehouse receiving recording",
      }),
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive upload could not start (${response.status}): ${detail}`);
  }
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload URL");
  return uploadUrl;
}
