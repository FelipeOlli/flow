import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import { listWritableCalendars } from "@/lib/google-calendar";
import { transcribeAudio, extractEventFields } from "@/lib/openai-event-parser";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const formData = await req.formData();
  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: "Áudio inválido" }, { status: 400 });
  }
  if (audioFile.size === 0) {
    return NextResponse.json({ error: "Áudio vazio" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google Calendar não conectado" }, { status: 503 });
    }

    const calendars = await listWritableCalendars(accessToken);

    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const mimeType = audioFile.type || "audio/webm";

    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

    const transcript = await transcribeAudio(audioBuffer, mimeType);
    if (!transcript) {
      return NextResponse.json({ error: "Não foi possível transcrever o áudio" }, { status: 400 });
    }

    const parsed = await extractEventFields(
      transcript,
      now,
      tz,
      calendars.map((c) => ({ id: c.id, name: c.name }))
    );

    return NextResponse.json({ transcript, parsed });
  } catch (err) {
    console.error("[voice-event]", err);
    return NextResponse.json(
      { error: "Erro ao processar o áudio. Verifique a configuração da API." },
      { status: 500 }
    );
  }
}
