import { auth } from "@/auth";
import { runMigration } from "@/lib/migration";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/token-store";
import { getReferenceDateForDateKey, isDateKey, shiftDateKey } from "@/lib/timezone";

function parseLocalDateInput(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return isDateKey(value.trim()) ? value.trim() : null;
}

export async function POST(req: NextRequest) {
  // Allow internal cron calls (with CRON_SECRET) OR authenticated user calls
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isCronCall =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  try {
    const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    let accessToken: string | null = null;

    if (isCronCall) {
      accessToken = await getValidAccessToken();
      if (!accessToken) {
        return NextResponse.json(
          { error: "No stored token available for cron migration" },
          { status: 400 }
        );
      }
    } else {
      // Check user session as fallback (manual trigger from UI)
      const session = await auth();
      if (!session?.accessToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      accessToken = session.accessToken;
    }
    if (!accessToken) {
      return NextResponse.json({ error: "No access token for migration" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    // Se vier fromDate na requisição, migra fromDate → fromDate+1
    // Caso contrário (cron automático), migra ontem → hoje
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (body.fromDate) {
      const fromDateKey = parseLocalDateInput(body.fromDate);
      if (!fromDateKey) {
        return NextResponse.json(
          { error: "Invalid fromDate format. Use yyyy-MM-dd." },
          { status: 400 }
        );
      }
      const toDateKey = shiftDateKey(fromDateKey, 1);
      fromDate = getReferenceDateForDateKey(fromDateKey, timeZone);
      toDate = getReferenceDateForDateKey(toDateKey, timeZone);
    }

    const result = await runMigration(accessToken, timeZone, fromDate, toDate);
    console.log("[FLOW] Migration complete:", result);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[FLOW] Migration error:", err);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
