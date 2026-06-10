export type PushStatus = "granted" | "denied" | "default" | "unsupported";

export function getPushStatus(): PushStatus {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return (Notification.permission as PushStatus) ?? "default";
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.publicKey === "string" ? data.publicKey : null;
  } catch {
    return null;
  }
}

export async function registerPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    console.error("[PUSH] Não foi possível obter VAPID public key do servidor");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: publicKey,
  });

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      userAgent: navigator.userAgent,
    }),
  });

  return res.ok;
}

export async function unregisterPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;

  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return false;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;

  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });

  return sub.unsubscribe();
}

export async function getActiveSubscription(): Promise<PushSubscription | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}
