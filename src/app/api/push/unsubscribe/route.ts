import { NextRequest, NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push-store";

export async function POST(req: NextRequest) {
  const { endpoint } = await req.json();
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint obrigatório" }, { status: 400 });
  }
  removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
