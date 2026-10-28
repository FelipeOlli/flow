import { auth } from "@/auth";
import { listDelegateContacts } from "@/lib/delegate-contacts";
import { NextResponse } from "next/server";

/** Nomes de pessoas que você já delegou — alimenta o seletor "Delegar para". */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(listDelegateContacts(), {
    headers: { "Cache-Control": "no-store" },
  });
}
