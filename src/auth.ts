import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";

function isEdgeRuntime(): boolean {
  return typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined";
}

async function persistTokensSafe(
  context: "login inicial" | "refresh",
  accessToken: string,
  refreshToken: string,
  expiresAt: number
): Promise<void> {
  if (isEdgeRuntime()) {
    // Middleware/auth can run on Edge; token-store uses fs/path and must stay on Node runtime.
    return;
  }
  try {
    const { saveTokens } = await import("@/lib/token-store");
    saveTokens({
      accessToken,
      refreshToken,
      expiresAt,
    });
    console.log(
      context === "login inicial"
        ? "[AUTH] Tokens persistidos no login inicial"
        : "[AUTH] Tokens persistidos após refresh"
    );
  } catch (err) {
    console.warn("[AUTH] Não foi possível persistir tokens:", String(err));
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw data;
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? token.refreshToken,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const config: NextAuthConfig = {
  // Required for deployments behind a reverse proxy (EasyPanel/Nginx)
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token as string;
        token.refreshToken = account.refresh_token as string;
        token.expiresAt = (account.expires_at as number) * 1000;
        await persistTokensSafe(
          "login inicial",
          token.accessToken as string,
          token.refreshToken as string,
          token.expiresAt as number
        );
      }

      // Token still valid (with 5min buffer)
      if (Date.now() < (token.expiresAt as number) - 5 * 60 * 1000) {
        return token;
      }

      const refreshed = await refreshAccessToken(token);

      if (!refreshed.error) {
        await persistTokensSafe(
          "refresh",
          refreshed.accessToken as string,
          refreshed.refreshToken as string,
          refreshed.expiresAt as number
        );
      }

      return refreshed;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
