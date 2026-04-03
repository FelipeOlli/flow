import { NextResponse } from "next/server";
import { getMigrationStatus } from "@/lib/migration-status";
import { getTokenStoreFilePath, hasStoredTokens } from "@/lib/token-store";
import { isCronInitialized, getCronInitError } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET() {
  const timezone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
  return NextResponse.json(
    {
      ...getMigrationStatus(),
      automation: {
        internalCronSchedule: "1 0 * * *",
        internalCronTimeLabel: "00:01",
        timezone,
        cronInitialized: isCronInitialized(),
        cronInitError: getCronInitError(),
        externalCronRecommended: true,
        externalCronEndpoint: "/api/cron/migrate",
      },
      readiness: {
        cronSecretConfigured: Boolean(process.env.CRON_SECRET),
        tokenStorePath: getTokenStoreFilePath(),
        hasStoredTokens: hasStoredTokens(),
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    }
  );
}
