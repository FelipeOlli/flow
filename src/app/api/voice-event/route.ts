import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import { transcribeAudio } from "@/lib/openai-event-parser";

// Step 1: audio → transcript only (fast, ~1-2s)
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
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    const mimeType = audioFile.type || "audio/webm";

    const transcript = await transcribeAudio(audioBuffer, mimeType);
    if (!transcript) {
      return NextResponse.json({ error: "Não foi possível transcrever o áudio" }, { status: 400 });
    }

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[voice-event transcribe]", err);
    return NextResponse.json(
      { error: "Erro ao transcrever o áudio. Verifique a configuração da API." },
      { status: 500 }
    );
  }
}
