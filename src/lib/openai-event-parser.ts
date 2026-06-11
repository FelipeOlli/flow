import { Pillar } from "@/types/task";

export interface ParsedEvent {
  title: string;
  startTime: string;
  endTime: string;
  calendarId?: string | null;
  description?: string;
  isImportant?: boolean;
  isAllDay?: boolean;
  pillar?: Pillar;
  category?: "operational" | "strategic";
  isDelegable?: boolean;
  recurrenceType?: "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([audioBuffer.buffer as ArrayBuffer], { type: mimeType });
  formData.append("file", blob, `audio.${mimeType.split("/")[1]?.split(";")[0] ?? "webm"}`);
  formData.append("model", "whisper-1");
  formData.append("language", "pt");
  formData.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err}`);
  }
  return (await res.text()).trim();
}

export async function extractEventFields(
  transcript: string,
  now: Date,
  tz: string,
  calendars: { id: string; name: string }[]
): Promise<ParsedEvent> {
  const dayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const nowStr = `${dayNames[now.getDay()]}, ${now.getDate()} de ${monthNames[now.getMonth()]} de ${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const calendarList = calendars.length
    ? calendars.map((c) => `- id: "${c.id}", nome: "${c.name}"`).join("\n")
    : "- id: \"primary\", nome: \"Principal\"";

  const systemPrompt = `Você é um assistente de agenda. Extraia os detalhes de um evento a partir de texto transcrito de voz em português brasileiro.

Data/hora atual: ${nowStr} (fuso: ${tz})

Agendas disponíveis:
${calendarList}

Retorne um JSON com os campos abaixo. Todos os campos são opcionais exceto title, startTime e endTime.

{
  "title": "string — título do evento",
  "startTime": "string — ISO 8601 com offset do fuso ${tz}, ex: 2026-06-11T14:00:00-03:00",
  "endTime": "string — ISO 8601 com offset do fuso ${tz}, padrão = startTime + 1 hora se não informado",
  "calendarId": "string ou null — id da agenda acima que melhor combina; null se ambíguo",
  "description": "string ou null — detalhes extras mencionados",
  "isImportant": "boolean — true se mencionar 'importante', 'urgente', 'prioridade'",
  "isAllDay": "boolean — true se mencionar 'o dia todo', 'dia inteiro', sem horário específico",
  "pillar": "null | 'trabalho' | 'saude' | 'familia' | 'espiritualidade' — inferir pelo contexto",
  "category": "null | 'operational' | 'strategic' — operational = tarefas rotineiras; strategic = reuniões, planejamento",
  "isDelegable": "boolean — true se mencionar 'delegar', 'pedir para', 'mandar alguém'",
  "recurrenceType": "null | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'"
}

Regras de data:
- "amanhã" = próximo dia
- "próxima [dia]" = o [dia] da semana que vem (nunca o da semana atual)
- "semana que vem" = mesma hora, +7 dias
- "daqui a Xh" = agora + X horas
- Se sem horário e isAllDay=false, use 08:00 como padrão
- Para eventos all-day: startTime e endTime devem ter T00:00:00 com o offset correto

Retorne apenas o JSON, sem texto adicional.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Texto transcrito: "${transcript}"` },
      ],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GPT error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const raw = JSON.parse(data.choices[0].message.content) as Record<string, unknown>;

  return {
    title: String(raw.title ?? "Novo evento"),
    startTime: String(raw.startTime),
    endTime: String(raw.endTime),
    calendarId: raw.calendarId ? String(raw.calendarId) : null,
    description: raw.description ? String(raw.description) : undefined,
    isImportant: raw.isImportant === true,
    isAllDay: raw.isAllDay === true,
    pillar: (raw.pillar as Pillar) ?? undefined,
    category: (raw.category as "operational" | "strategic") ?? undefined,
    isDelegable: raw.isDelegable === true,
    recurrenceType: (raw.recurrenceType as ParsedEvent["recurrenceType"]) ?? undefined,
  };
}
