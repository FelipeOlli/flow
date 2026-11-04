import webpush from "web-push";
import { listSubscriptions, removeSubscription } from "./push-store";

/**
 * Envio de Web Push — extraído do notifier pra ser reaproveitado por outros
 * avisadores (chegadas de evento externo).
 *
 * O VAPID é configurado uma vez por chamada: `webpush.setVapidDetails` é
 * global, mas cada processo pode ter seu próprio par de chaves.
 */
export function pushHabilitado(): boolean {
  const subs = listSubscriptions();
  return (
    !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) &&
    subs.length > 0
  );
}

/**
 * Manda um push para todas as subscriptions. Subscription expirada (404/410)
 * é removida do registro — o app não deve insistir em endpoint morto.
 *
 * Devolve `true` quando o push foi entregue a pelo menos uma subscription,
 * `false` quando falhou em todas. Sem subscriptions (ou sem VAPID), é no-op
 * e devolve `true`: não há canal configurado, o que não é falha de envio.
 */
export async function sendPushNotification(
  title: string,
  body: string,
  tag: string
): Promise<boolean> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return true;

  const subs = listSubscriptions();
  if (subs.length === 0) return true;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({ title, body, tag, url: "/today" });

  let entregue = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      entregue = true;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        removeSubscription(sub.endpoint);
        console.log(`[PUSH] Subscription expirada removida: ${sub.endpoint.slice(0, 60)}…`);
      } else {
        console.error("[PUSH] Falha ao enviar push:", err);
      }
    }
  }
  return entregue;
}
