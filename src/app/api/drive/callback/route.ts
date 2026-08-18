/**
 * API Route: Handle Google Drive OAuth Callback
 * Exchanges authorization code for refresh token
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from "@/lib/firebase-admin";
import { verifyGoogleDriveOAuthState } from "@/lib/google-drive-oauth-state";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    const error = request.nextUrl.searchParams.get('error');
    const errorDescription = request.nextUrl.searchParams.get('error_description');
    const oauthState = verifyGoogleDriveOAuthState(
      request.nextUrl.searchParams.get("state") || ""
    );

    if (!oauthState) {
      return NextResponse.json(
        { error: "Google Drive connection expired or was not started by an admin" },
        { status: 403 }
      );
    }

    // Handle OAuth errors
    if (error) {
      const errorHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #ea4335; }
              .error { color: #ea4335; font-weight: bold; }
              .info { background: #fce8e6; padding: 15px; border-radius: 4px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>❌ OAuth Error</h1>
              <p class="error">Error: ${error}</p>
              ${errorDescription ? `<p>${errorDescription}</p>` : ''}
              <div class="info">
                <p><strong>Common issues:</strong></p>
                <ul>
                  <li>Redirect URI mismatch - Check Google Cloud Console</li>
                  <li>Route not deployed - Make sure /api/drive/callback is deployed</li>
                  <li>Invalid client credentials</li>
                </ul>
              </div>
            </div>
          </body>
        </html>
      `;
      return new NextResponse(errorHtml, {
        headers: { 'Content-Type': 'text/html' },
        status: 400,
      });
    }

    if (!code) {
      // Show helpful message if accessed directly without code
      const noCodeHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Callback</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #4285f4; }
              .info { background: #e8f0fe; padding: 15px; border-radius: 4px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>OAuth Callback</h1>
              <p>This page handles Google OAuth callbacks.</p>
              <div class="info">
                <p><strong>If you see this page directly:</strong></p>
                <p>You should be redirected here automatically after signing in with Google.</p>
                <p>If you're getting a 404 error, make sure:</p>
                <ul>
                  <li>The redirect URI in Google Cloud Console matches: <code>${request.nextUrl.origin}/api/drive/callback</code></li>
                  <li>The route is deployed to production</li>
                </ul>
              </div>
            </div>
          </body>
        </html>
      `;
      return new NextResponse(noCodeHtml, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/drive/callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Google OAuth credentials not configured' },
        { status: 500 }
      );
    }

    // Exchange code for tokens
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange error:', errorData);
      return NextResponse.json(
        { error: 'Failed to exchange code for tokens', details: errorData },
        { status: 500 }
      );
    }

    const tokenData = await tokenResponse.json();
    const driveRef = adminDb().collection("system").doc("googleDrive");
    const existing = await driveRef.get();
    const refreshToken =
      tokenData.refresh_token || (existing.exists ? existing.data()?.refreshToken : null);

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'No refresh token received. Make sure to include access_type=offline and prompt=consent in the authorization URL.' },
        { status: 500 }
      );
    }

    await driveRef.set(
      {
        refreshToken,
        accessToken: tokenData.access_token || null,
        expiresAt: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000,
        connectedAt: new Date(),
        connectedBy: oauthState.uid,
        updatedAt: new Date(),
        disabled: false,
      },
      { merge: true }
    );

    // Return success page
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google Drive Connected</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 { color: #34a853; }
            .success { color: #34a853; font-weight: bold; }
            .info { background: #e8f5e9; padding: 15px; border-radius: 4px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Google Drive Connected Successfully!</h1>
            <p class="success">Your Google Drive account has been connected.</p>
            <div class="info">
              <p>The refresh token was stored securely in Firestore at
              <strong>system/googleDrive</strong>. No manual environment-variable update is required.</p>
            </div>
            <p>This window will close automatically.</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: "google-drive-connected" }, window.location.origin);
              window.setTimeout(() => window.close(), 1200);
            }
          </script>
        </body>
      </html>
    `;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process OAuth callback' },
      { status: 500 }
    );
  }
}

