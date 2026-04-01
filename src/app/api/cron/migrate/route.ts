import { auth } from "@/auth";
import { runMigration } from "@/lib/migration";
import { NextRequest, NextResponse } from "next/server";
import { addDays } from "date-fns";

function parseLocalDateInput(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const localDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (localDateMatch) {
    const [, year, month, day] = localDateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export async function POST(req: NextRequest) {
  // Allow internal cron calls (with CRON_SECRET) OR authenticated user calls
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isCronCall =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronCall) {
    // Check user session as fallback (manual trigger from UI)
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

    // For cron calls, we need the user's access token
    // Get it from session (user must be logged in, or we use a stored token strategy)
    const session = await auth();
    if (!session?.accessToken) {
      return NextResponse.json(
        { error: "No active session to migrate" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Se vier fromDate na requisição, migra fromDate → fromDate+1
    // Caso contrário (cron automático), migra ontem → hoje
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (body.fromDate) {
      fromDate = parseLocalDateInput(body.fromDate) ?? undefined;
      if (!fromDate) {
        return NextResponse.json(
          { error: "Invalid fromDate format. Use yyyy-MM-dd." },
          { status: 400 }
        );
      }
      toDate = new Date(); // sempre migra para o dia atual
    }

    const result = await runMigration(session.accessToken, timeZone, fromDate, toDate);
    console.log("[FLOW] Migration complete:", result);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[FLOW] Migration error:", err);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
