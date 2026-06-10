import { NextRequest, NextResponse } from "next/server";
import { addSubscription } from "@/lib/push-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { subscription, userAgent } = body;

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Subscription inválida" }, { status: 400 });
  }

  addSubscription({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    userAgent: userAgent ?? "",
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
