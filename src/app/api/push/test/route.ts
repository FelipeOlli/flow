import { NextResponse } from "next/server";
import webpush from "web-push";
import { listSubscriptions, removeSubscription } from "@/lib/push-store";

export async function POST() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json({ error: "VAPID não configurado" }, { status: 500 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const subs = listSubscriptions();
  if (subs.length === 0) {
    return NextResponse.json({ error: "Nenhum dispositivo inscrito" }, { status: 400 });
  }

  const payload = JSON.stringify({
    title: "FLOW — Teste",
    body: "Notificações funcionando! 🎉",
    tag: "flow-test",
    url: "/today",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) removeSubscription(sub.endpoint);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
