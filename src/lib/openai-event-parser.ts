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
  "title": "string — resumo curto e direto do evento (máx. 5 palavras). Ex: 'Reunião com Pedro', 'Consulta dentista', 'Treino academia'. Nunca inclua data, hora ou detalhes no título.",
  "description": "string ou null — informações adicionais que não cabem no título (local, pauta, nome completo, link, observações). Deixe null se não houver nada relevante a acrescentar.",
  "startTime": "string — ISO 8601 com offset do fuso ${tz}, ex: 2026-06-11T14:00:00-03:00",
  "endTime": "string — ISO 8601 com offset do fuso ${tz}, calcule com base na duração abaixo",
  "calendarId": "string ou null — id da agenda que melhor combina com o nome dito (veja regras abaixo); null se ambíguo",
  "isImportant": "boolean — true se mencionar 'importante', 'urgente', 'prioridade'",
  "isAllDay": "boolean — true se mencionar 'o dia todo', 'dia inteiro', sem horário específico",
  "pillar": "null | 'trabalho' | 'saude' | 'familia' | 'espiritualidade' — inferir pelo contexto (veja exemplos abaixo)",
  "category": "null | 'operational' | 'strategic' — inferir pelo tipo (veja exemplos abaixo)",
  "isDelegable": "boolean — true se mencionar 'delegar', 'pedir para', 'mandar alguém'",
  "recurrenceType": "null | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'"
}

DURAÇÃO ESTIMADA (use quando o usuário não informar duração explícita):
- Ligação / ligar para / call → 15 min
- Reunião / standup / alinhamento / check-in → 30 min
- Consulta médica / dentista / exame / terapia → 1 h
- Treino / academia / corrida / exercício → 1 h
- Almoço / café / jantar → 1 h
- Responder / revisar / conferir / cadastrar / organizar → 30 min
- Bloco de foco / deep work / codificar / estudar → 2 h
- Aula / curso / workshop / treinamento → 1h30
- Default (qualquer outro) → 1 h

MATCH DE AGENDA (calendarId):
- Compare o nome dito com os nomes das agendas ignorando maiúsculas, acentos e artigos.
- Prioridade: palavra inteira > prefixo > substring.
- Ex: "agendar no DevPoint" → agenda com nome "DevPoint"; "colocar no pessoal" → agenda cujo nome contenha "pessoal".
- Se nenhum nome for dito ou houver ambiguidade, retorne null.

PILAR — exemplos de inferência:
- trabalho: reunião, cliente, projeto, código, planejamento, proposta, nota fiscal, contrato, apresentação
- saude: médico, dentista, treino, terapia, exame, farmácia, academia, corrida, psicólogo
- familia: aniversário, escola dos filhos, jantar familiar, viagem com família, buscar/levar filho
- espiritualidade: igreja, meditação, oração, retiro, leitura espiritual, culto, missa

CATEGORIA — exemplos:
- operational: responder e-mails, cadastrar nota fiscal, organizar, conferir, ligar para fulano, rotina
- strategic: reunião 1:1, planejamento, tomada de decisão, criação de produto, alinhamento estratégico

REGRAS DE DATA:
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
