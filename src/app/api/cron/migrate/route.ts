import { auth } from "@/auth";
import {
  runMigration,
  MIGRATION_AUTO_FILTER,
  MIGRATION_MANUAL_DEFAULT_FILTER,
  type MigrationFilterOptions,
} from "@/lib/migration";
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

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return defaultValue;
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
      eligibleTimed: 0,
      eligibleAllDay: 0,
      includeCompletedTimed: false,
      includeAllDayFilter: false,
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
      // Check user session (manual trigger from UI)
      const session = await auth();
      if (!session) {
        return errorResponse("Unauthorized", 401);
      }
      accessToken = await getValidAccessToken();
      if (!accessToken) {
        return errorResponse("GoogleCalendarNotConnected", 503);
      }
    }
    if (!accessToken) {
      return errorResponse("No access token for migration", 400);
    }

    // Se vier fromDate na requisição:
    // - com toDate opcional: migra fromDate → toDate (ex.: correção pontual)
    // - sem toDate: migra fromDate → dia seguinte (comportamento do botão)
    // Caso contrário (cron automático), migra ontem → hoje
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    let migrationFilter: MigrationFilterOptions = MIGRATION_AUTO_FILTER;

    if (body.fromDate) {
      sourceDateKey = parseLocalDateInput(body.fromDate);
      if (!sourceDateKey) {
        return errorResponse("Invalid fromDate format. Use yyyy-MM-dd.", 400);
      }
      const toDateRaw = body.toDate;
      const explicitToKey = parseLocalDateInput(toDateRaw);
      if (
        typeof toDateRaw === "string" &&
        toDateRaw.trim() &&
        !explicitToKey
      ) {
        return errorResponse("Invalid toDate format. Use yyyy-MM-dd.", 400);
      }
      if (explicitToKey) {
        targetDateKey = explicitToKey;
      } else {
        targetDateKey = shiftDateKey(sourceDateKey, 1);
      }
      fromDate = getReferenceDateForDateKey(sourceDateKey, timeZone);
      toDate = getReferenceDateForDateKey(targetDateKey, timeZone);

      if (!isCronCall) {
        migrationFilter = {
          includeCompletedTimed: parseBool(
            body.includeCompleted,
            MIGRATION_MANUAL_DEFAULT_FILTER.includeCompletedTimed
          ),
          includeAllDay: parseBool(body.includeAllDay, MIGRATION_MANUAL_DEFAULT_FILTER.includeAllDay),
        };
      }
    }

    const result = await runMigration(
      accessToken,
      timeZone,
      fromDate,
      toDate,
      isCronCall ? MIGRATION_AUTO_FILTER : migrationFilter
    );
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
