/**
 * API Route: Get Google Drive Access Token
 * Uses refresh token to get a new access token
 */

import { NextResponse } from 'next/server';
import { getGoogleDriveClient } from "@/lib/google-drive-video-server";

export async function GET() {
  try {
    const { accessToken } = await getGoogleDriveClient();
    return NextResponse.json({
      accessToken,
      expiresIn: 3600,
    });
  } catch (error: unknown) {
    console.error('Error getting access token:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to get access token',
        hint: "Connect Google Drive from the admin dashboard.",
      },
      { status: 500 }
    );
  }
}

