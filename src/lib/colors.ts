const DEFAULT_EVENT_COLOR = "#4285f4";
const COMPLETE_EVENT_COLOR = "#188038";
const EVENT_SURFACE_ALPHA = 0.9;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeHex(color: string): string | null {
  const value = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return value.split("").map((c) => c + c).join("").toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  return null;
}

export function lightenHexColor(color: string, amount: number): string {
  const normalized = normalizeHex(color);
  if (!normalized) return color;

  const ratio = clamp01(amount);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  const mixedR = Math.round(r + (255 - r) * ratio);
  const mixedG = Math.round(g + (255 - g) * ratio);
  const mixedB = Math.round(b + (255 - b) * ratio);

  return `#${[mixedR, mixedG, mixedB].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function toRgba(color: string, alpha: number): string {
  const normalized = normalizeHex(color);
  if (!normalized) return color;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
}

export function getEventSurfaceColor(calendarColor?: string, isComplete?: boolean): string {
  const base = isComplete
    ? lightenHexColor(COMPLETE_EVENT_COLOR, 0.18)
    : lightenHexColor(calendarColor ?? DEFAULT_EVENT_COLOR, 0.22);
  return toRgba(base, EVENT_SURFACE_ALPHA);
}
