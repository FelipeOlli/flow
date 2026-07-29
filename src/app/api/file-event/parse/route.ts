import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import { listWritableCalendars } from "@/lib/google-calendar";
import { extractEventFieldsFromMedia, MediaInput } from "@/lib/claude-event-parser";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const TEXT_MIME_TYPES = ["text/plain", "message/rfc822"];

// Imagem, PDF ou texto (.txt/.eml) → campos do evento (Claude, análise multimodal)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Arquivo inválido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo muito grande (máx. 10 MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "";
  const fileName = file instanceof File ? file.name : "";

  let input: MediaInput;
  if (mimeType.startsWith("image/")) {
    input = { kind: "image", mimeType, base64: buffer.toString("base64") };
  } else if (mimeType === "application/pdf") {
    input = { kind: "pdf", base64: buffer.toString("base64") };
  } else if (TEXT_MIME_TYPES.includes(mimeType) || /\.(txt|eml)$/i.test(fileName)) {
    input = { kind: "text", text: buffer.toString("utf-8") };
  } else {
    return NextResponse.json(
      { error: "Tipo de arquivo não suportado. Envie uma imagem, PDF ou arquivo .txt/.eml." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return NextResponse.json({ error: "Google Calendar não conectado" }, { status: 503 });
    }

    const calendars = await listWritableCalendars(accessToken);
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));

    const parsed = await extractEventFieldsFromMedia(
      input,
      now,
      tz,
      calendars.map((c) => ({ id: c.id, name: c.name }))
    );

    return NextResponse.json({ parsed });
  } catch (err) {
    console.error("[file-event parse]", err);
    return NextResponse.json(
      { error: "Erro ao analisar o arquivo. Verifique a configuração da API." },
      { status: 500 }
    );
  }
}
