import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";

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

        // Persiste tokens para o cron de migração noturna.
        // Wrapped in try-catch: middleware runs on Edge Runtime where fs is unavailable.
        try {
          const { saveTokens } = await import("@/lib/token-store");
          saveTokens({
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
          });
        } catch {
          // Edge runtime — token-store persistence skipped
        }
      }

      // Token still valid (with 5min buffer)
      if (Date.now() < (token.expiresAt as number) - 5 * 60 * 1000) {
        return token;
      }

      const refreshed = await refreshAccessToken(token);

      // Atualiza tokens persistidos após refresh.
      // Wrapped in try-catch: middleware runs on Edge Runtime where fs is unavailable.
      if (!refreshed.error) {
        try {
          const { saveTokens } = await import("@/lib/token-store");
          saveTokens({
            accessToken: refreshed.accessToken as string,
            refreshToken: refreshed.refreshToken as string,
            expiresAt: refreshed.expiresAt as number,
          });
        } catch {
          // Edge runtime — token-store persistence skipped
        }
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
