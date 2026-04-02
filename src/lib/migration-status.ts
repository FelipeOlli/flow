import { MigrationResult } from "./migration";

export type MigrationSource = "auto" | "manual";
export type MigrationExecutionState = "idle" | "running" | "success" | "error";

export interface MigrationStatusSnapshot {
  state: MigrationExecutionState;
  source?: MigrationSource;
  startedAt?: string;
  finishedAt?: string;
  migrated?: number;
  skipped?: number;
  details?: string[];
  diagnostics?: MigrationResult["diagnostics"];
  error?: string;
  updatedAt: string;
}

let lastStatus: MigrationStatusSnapshot = {
  state: "idle",
  updatedAt: new Date().toISOString(),
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function setMigrationRunning(source: MigrationSource): MigrationStatusSnapshot {
  const now = new Date().toISOString();
  lastStatus = {
    state: "running",
    source,
    startedAt: now,
    updatedAt: now,
  };
  return lastStatus;
}

export function setMigrationSuccess(
  source: MigrationSource,
  result: MigrationResult
): MigrationStatusSnapshot {
  const now = new Date().toISOString();
  lastStatus = {
    state: "success",
    source,
    startedAt: lastStatus.state === "running" ? lastStatus.startedAt : now,
    finishedAt: now,
    migrated: result.migrated,
    skipped: result.skipped,
    details: result.details,
    diagnostics: result.diagnostics,
    updatedAt: now,
  };
  return lastStatus;
}

export function setMigrationError(
  source: MigrationSource,
  error: unknown
): MigrationStatusSnapshot {
  const now = new Date().toISOString();
  lastStatus = {
    state: "error",
    source,
    startedAt: lastStatus.state === "running" ? lastStatus.startedAt : now,
    finishedAt: now,
    error: toErrorMessage(error),
    updatedAt: now,
  };
  return lastStatus;
}

export function getMigrationStatus(): MigrationStatusSnapshot {
  return lastStatus;
}
