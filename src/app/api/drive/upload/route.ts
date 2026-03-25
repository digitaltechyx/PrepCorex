/**
 * API Route: Upload PDF to Google Drive
 * Handles file upload to admin's Google Drive with folder structure
 */

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';

export async function POST(request: NextRequest) {
  try {
    // Get access token using OAuth refresh token
    const tokenResponse = await fetch(`${request.nextUrl.origin}/api/drive/token`);
    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.json();
      return NextResponse.json(
        { 
          error: tokenError.error || 'Failed to get access token',
          details: tokenError.details,
          hint: tokenError.hint || 'Please authenticate with Google Drive first by visiting /api/drive/auth'
        },
        { status: tokenResponse.status || 500 }
      );
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.accessToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token received' },
        { status: 500 }
      );
    }

    // Authenticate with Google Drive using OAuth access token
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/drive/callback`;
    
    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: 'v3', auth });

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const clientName = formData.get('clientName') as string;
    const folderPath = formData.get('folderPath') as string;

    if (!file || !clientName || !folderPath) {
      return NextResponse.json(
        { error: 'Missing required fields: file, clientName, or folderPath' },
        { status: 400 }
      );
    }

    // Validate file type - allow PDFs and images
    const isValidType = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!isValidType) {
      return NextResponse.json(
        { error: 'Only PDF files and images (JPG, PNG) are allowed' },
        { status: 400 }
      );
    }

    // Convert file to buffer and then to stream
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Convert buffer to stream (Google Drive API requires a stream)
    const stream = Readable.from(buffer);

    // Parse folder path: Year/Month/Client Name/Date/FileName
    const pathParts = folderPath.split('/');
    const fileName = pathParts.pop()!;
    const folderParts = pathParts; // [Year, Month, Client Name, Date]

    // Create folder structure in Google Drive
    // Using OAuth, files will be uploaded to the authenticated user's Google Drive (uses their quota)
    // Start from the "PrepCorex Labels" folder if folder ID is provided, otherwise use root
    const psfLabelsFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    let parentFolderId = psfLabelsFolderId || 'root'; // Start from PrepCorex Labels folder or root

    for (const folderName of folderParts) {
      // Check if folder exists
      const existingFolders = await drive.files.list({
        q: `'${parentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      let folderId = existingFolders.data.files?.[0]?.id;

      // Create folder if it doesn't exist
      if (!folderId) {
        const folder = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
          },
          fields: 'id, name',
        });
        folderId = folder.data.id!;
      }

      parentFolderId = folderId!;
    }

    // Upload file to the final folder
    const fileMetadata = {
      name: fileName,
      parents: [parentFolderId],
    };

    const media = {
      mimeType: file.type, // Use the actual file type (PDF or image)
      body: stream,
    };

    const uploadedFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink, size',
    });

    // Make file accessible (optional - for direct download)
    await drive.permissions.create({
      fileId: uploadedFile.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    // Get file download URL
    const fileInfo = await drive.files.get({
      fileId: uploadedFile.data.id!,
      fields: 'id, name, webViewLink, webContentLink, size',
    });

    return NextResponse.json({
      success: true,
      fileId: uploadedFile.data.id,
      fileName: uploadedFile.data.name,
      storagePath: folderPath,
      downloadURL: fileInfo.data.webContentLink || fileInfo.data.webViewLink,
      webUrl: fileInfo.data.webViewLink,
      size: fileInfo.data.size,
    });
  } catch (error: any) {
    console.error('Google Drive upload error:', error);
    
    let errorMessage = error.message || 'Failed to upload file to Google Drive';
    let errorDetails = error.toString();
    
    // Handle specific Google API errors
    if (error.message?.includes('unregistered callers') || error.message?.includes('API consumer identity')) {
      errorMessage = 'Google Drive API authentication failed. Please check: 1) GOOGLE_SERVICE_ACCOUNT_KEY is set correctly, 2) Google Drive API is enabled, 3) Service account has access to the shared folder.';
      errorDetails = 'Authentication error: ' + error.message;
    } else if (error.message?.includes('Permission denied') || error.message?.includes('insufficient')) {
      errorMessage = 'Permission denied. Make sure you shared the Google Drive folder with the service account email and gave it Editor permissions.';
      errorDetails = 'Permission error: ' + error.message;
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: errorDetails
      },
      { status: 500 }
    );
  }
}
















