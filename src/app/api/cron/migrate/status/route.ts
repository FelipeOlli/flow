import { NextResponse } from "next/server";
import { getMigrationStatus } from "@/lib/migration-status";
import { getTokenStoreFilePath, hasStoredTokens } from "@/lib/token-store";

export async function GET() {
  const timezone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
  return NextResponse.json({
    ...getMigrationStatus(),
    automation: {
      internalCronSchedule: "1 0 * * *",
      internalCronTimeLabel: "00:01",
      timezone,
      externalCronRecommended: true,
      externalCronEndpoint: "/api/cron/migrate",
    },
    readiness: {
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      tokenStorePath: getTokenStoreFilePath(),
      hasStoredTokens: hasStoredTokens(),
    },
  });
}
