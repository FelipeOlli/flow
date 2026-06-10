import fs from "fs";
import path from "path";

const DATA_DIR =
  process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();

const PUSH_FILE = path.join(DATA_DIR, ".push-subscriptions.json");

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
  createdAt: string;
}

function load(): PushSubscriptionRecord[] {
  try {
    if (!fs.existsSync(PUSH_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(PUSH_FILE, "utf-8"));
    return Array.isArray(data.subscriptions) ? data.subscriptions : [];
  } catch {
    return [];
  }
}

function save(subscriptions: PushSubscriptionRecord[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PUSH_FILE, JSON.stringify({ subscriptions }, null, 2), "utf-8");
  } catch (err) {
    console.error("[PUSH STORE] Falha ao salvar subscriptions:", err);
  }
}

export function addSubscription(record: PushSubscriptionRecord): void {
  const list = load().filter((s) => s.endpoint !== record.endpoint);
  list.push(record);
  save(list);
}

export function removeSubscription(endpoint: string): void {
  save(load().filter((s) => s.endpoint !== endpoint));
}

export function listSubscriptions(): PushSubscriptionRecord[] {
  return load();
}
