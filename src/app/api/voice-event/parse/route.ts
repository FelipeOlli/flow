import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import { listWritableCalendars } from "@/lib/google-calendar";
import { extractEventFieldsFromMedia } from "@/lib/claude-event-parser";

// Step 2: transcript → parsed event fields (Claude, mesma lógica do file-event)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { transcript } = await req.json() as { transcript?: string };
  if (!transcript?.trim()) {
    return NextResponse.json({ error: "Transcrição inválida" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google Calendar não conectado" }, { status: 503 });
    }

    const calendars = await listWritableCalendars(accessToken);
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

    const events = await extractEventFieldsFromMedia(
      { kind: "transcript", text: transcript },
      now,
      tz,
      calendars.map((c) => ({ id: c.id, name: c.name }))
    );

    return NextResponse.json({ parsed: events[0] });
  } catch (err) {
    console.error("[voice-event parse]", err);
    return NextResponse.json(
      { error: "Erro ao analisar o evento. Verifique a configuração da API." },
      { status: 500 }
    );
  }
}
