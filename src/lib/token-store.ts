import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), ".token-store.json");

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function saveTokens(tokens: StoredTokens): void {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens), "utf-8");
  } catch (err) {
    console.error("[TOKEN STORE] Failed to save tokens:", err);
  }
}

function loadTokens(): StoredTokens | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens?.refreshToken) {
    console.error("[TOKEN STORE] No stored tokens found. User needs to log in first.");
    return null;
  }

  // Token still valid (with 5min buffer)
  if (Date.now() < tokens.expiresAt - 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  // Refresh expired token
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw data;

    const refreshed: StoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    saveTokens(refreshed);
    console.log("[TOKEN STORE] Token refreshed successfully");
    return refreshed.accessToken;
  } catch (err) {
    console.error("[TOKEN STORE] Failed to refresh token:", err);
    return null;
  }
}
