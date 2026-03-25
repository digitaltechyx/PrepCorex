/**
 * API Route: Get viewable URL for file from Google Drive
 * Returns viewable URL (for iframe) instead of download URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fileId = searchParams.get('fileId');
    const filePath = searchParams.get('filePath');

    if (!fileId && !filePath) {
      return NextResponse.json(
        { error: 'Either fileId or filePath is required' },
        { status: 400 }
      );
    }

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

    let targetFileId = fileId;

    // If filePath is provided, find the file
    if (!targetFileId && filePath) {
      const pathParts = filePath.split('/');
      const fileName = pathParts.pop()!;
      
      // Start from PrepCorex Labels folder if provided, otherwise root
      const psfLabelsFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      let currentFolderId = psfLabelsFolderId || 'root';

      // Navigate through folder structure
      for (const folderName of pathParts) {
        const folders = await drive.files.list({
          q: `'${currentFolderId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id)',
          spaces: 'drive',
        });
        
        if (!folders.data.files || folders.data.files.length === 0) {
          return NextResponse.json(
            { error: `Folder not found: ${folderName}` },
            { status: 404 }
          );
        }
        
        currentFolderId = folders.data.files[0].id!;
      }

      // Find the file in the final folder
      const files = await drive.files.list({
        q: `'${currentFolderId}' in parents and name='${fileName}' and mimeType='application/pdf' and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
      });

      if (!files.data.files || files.data.files.length === 0) {
        return NextResponse.json(
          { error: `File not found: ${fileName}` },
          { status: 404 }
        );
      }

      targetFileId = files.data.files[0].id!;
    }

    // Get file info
    const fileInfo = await drive.files.get({
      fileId: targetFileId!,
      fields: 'id, name, webViewLink, webContentLink, size',
    });

    // Use embed URL for viewing in iframe (prevents download)
    // Embed URL format: https://drive.google.com/file/d/{fileId}/preview
    // This URL is specifically designed for iframe embedding and prevents downloads
    const viewUrl = `https://drive.google.com/file/d/${targetFileId}/preview`;

    return NextResponse.json({
      success: true,
      fileId: fileInfo.data.id,
      fileName: fileInfo.data.name,
      viewURL: viewUrl, // URL for viewing in iframe
      downloadURL: fileInfo.data.webContentLink, // Keep download URL for reference
      webUrl: fileInfo.data.webViewLink,
      size: fileInfo.data.size,
    });
  } catch (error: any) {
    console.error('Google Drive view error:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to get view URL from Google Drive',
        details: error.toString()
      },
      { status: 500 }
    );
  }
}

