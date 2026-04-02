import { auth } from "@/auth";
import { runMigration } from "@/lib/migration";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/token-store";
import { getDateKeyInTimeZone, getReferenceDateForDateKey, isDateKey, shiftDateKey } from "@/lib/timezone";
import { setMigrationError, setMigrationRunning, setMigrationSuccess } from "@/lib/migration-status";

function parseLocalDateInput(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return isDateKey(value.trim()) ? value.trim() : null;
}

function parseTimeZoneInput(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value.trim() });
    return value.trim();
  } catch {
    return null;
  }
}

function buildErrorPayload(
  error: string,
  timeZone: string,
  sourceDateKey: string | null,
  targetDateKey: string | null
) {
  return {
    success: false,
    error,
    migrated: 0,
    skipped: 0,
    details: [] as string[],
    diagnostics: {
      sourceDateKey,
      targetDateKey,
      sourceDate: null,
      targetDate: null,
      timeZone,
      sourceEvents: 0,
      targetEvents: 0,
      pendingEvents: 0,
      completedEvents: 0,
      allDayEvents: 0,
    },
  };
}

export async function POST(req: NextRequest) {
  // Allow internal cron calls (with CRON_SECRET) OR authenticated user calls
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isCronCall =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  const source = isCronCall ? "auto" : "manual";
  setMigrationRunning(source);

  try {
    const body = await req.json().catch(() => ({}));
    const defaultTimeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const manualTimeZone = parseTimeZoneInput(body.tz);
    const timeZone = !isCronCall && manualTimeZone ? manualTimeZone : defaultTimeZone;

    const todayDateKey = getDateKeyInTimeZone(new Date(), timeZone);
    let sourceDateKey: string | null = shiftDateKey(todayDateKey, -1);
    let targetDateKey: string | null = todayDateKey;
    let accessToken: string | null = null;

    const errorResponse = (message: string, status: number) => {
      setMigrationError(source, message);
      return NextResponse.json(
        buildErrorPayload(message, timeZone, sourceDateKey, targetDateKey),
        { status }
      );
    };

    if (isCronCall) {
      accessToken = await getValidAccessToken();
      if (!accessToken) {
        return errorResponse("No stored token available for cron migration", 400);
      }
    } else {
      // Check user session as fallback (manual trigger from UI)
      const session = await auth();
      const sessionError = (session as { error?: string } | null)?.error;
      if (sessionError === "RefreshAccessTokenError") {
        return errorResponse("TokenExpired", 401);
      }
      if (!session?.accessToken) {
        return errorResponse("Unauthorized", 401);
      }
      accessToken = session.accessToken;
    }
    if (!accessToken) {
      return errorResponse("No access token for migration", 400);
    }

    // Se vier fromDate na requisição, migra fromDate → fromDate+1
    // Caso contrário (cron automático), migra ontem → hoje
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (body.fromDate) {
      sourceDateKey = parseLocalDateInput(body.fromDate);
      if (!sourceDateKey) {
        return errorResponse("Invalid fromDate format. Use yyyy-MM-dd.", 400);
      }
      targetDateKey = shiftDateKey(sourceDateKey, 1);
      fromDate = getReferenceDateForDateKey(sourceDateKey, timeZone);
      toDate = getReferenceDateForDateKey(targetDateKey, timeZone);
    }

    const result = await runMigration(accessToken, timeZone, fromDate, toDate);
    setMigrationSuccess(source, result);
    console.log("[FLOW] Migration complete:", result);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    setMigrationError(source, err);
    console.error("[FLOW] Migration error:", err);
    const defaultTimeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    return NextResponse.json(
      buildErrorPayload("Migration failed", defaultTimeZone, null, null),
      { status: 500 }
    );
  }
}
