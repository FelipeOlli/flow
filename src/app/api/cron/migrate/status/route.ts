import { NextResponse } from "next/server";
import { getMigrationStatus } from "@/lib/migration-status";

export async function GET() {
  return NextResponse.json(getMigrationStatus());
}
