import Anthropic from "@anthropic-ai/sdk";
import { Pillar } from "@/types/task";
import { ParsedEvent } from "@/lib/openai-event-parser";

const client = new Anthropic();

export type MediaInput =
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string }
  | { kind: "transcript"; text: string };

const EVENT_OBJECT_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" },
    startTime: { type: "string" },
    endTime: { type: "string" },
    calendarId: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    isImportant: { type: "boolean" },
    isAllDay: { type: "boolean" },
    pillar: {
      anyOf: [{ type: "string", enum: ["trabalho", "saude", "familia", "espiritualidade"] }, { type: "null" }],
    },
    category: {
      anyOf: [{ type: "string", enum: ["operational", "strategic"] }, { type: "null" }],
    },
    isDelegable: { type: "boolean" },
    recurrenceType: {
      anyOf: [
        { type: "string", enum: ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"] },
        { type: "null" },
      ],
    },
    attendees: { type: "array", items: { type: "string" } },
  },
  required: ["title", "startTime", "endTime"],
  additionalProperties: false,
};

const EVENT_SCHEMA = {
  type: "object" as const,
  properties: {
    events: { type: "array" as const, items: EVENT_OBJECT_SCHEMA },
  },
  required: ["events"],
  additionalProperties: false,
};

function buildSystemPrompt(
  now: Date,
  tz: string,
  calendars: { id: string; name: string }[],
  source: "media" | "voice"
): string {
  const dayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const nowStr = `${dayNames[now.getDay()]}, ${now.getDate()} de ${monthNames[now.getMonth()]} de ${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const calendarList = calendars.length
    ? calendars.map((c) => `- id: "${c.id}", nome: "${c.name}"`).join("\n")
    : "- id: \"primary\", nome: \"Principal\"";

  const intro =
    source === "voice"
      ? "Você é um assistente de agenda. Extraia os detalhes do evento (normalmente um único) a partir de um texto transcrito de voz em português brasileiro, ditado pelo usuário."
      : "Você é um assistente de agenda. Extraia os detalhes de todos os eventos presentes em uma imagem, PDF, arquivo ou texto colado pelo usuário (convite, print de conversa, comprovante, e-mail, mensagem copiada, post de divulgação com vários eventos).";

  const durationRules =
    source === "voice"
      ? `DURAÇÃO ESTIMADA (use quando o usuário não informar duração explícita):
- Ligação / ligar para / call → 15 min
- Reunião / standup / alinhamento / check-in → 30 min
- Consulta médica / dentista / exame / terapia → 1 h
- Treino / academia / corrida / exercício → 1 h
- Almoço / café / jantar → 1 h
- Responder / revisar / conferir / cadastrar / organizar → 30 min
- Bloco de foco / deep work / codificar / estudar → 2 h
- Aula / curso / workshop / treinamento → 1h30
- Default (qualquer outro) → 1 h`
      : `DURAÇÃO ESTIMADA (use quando não houver duração explícita):
- Ligação / call → 15 min
- Reunião / standup / alinhamento / check-in → 30 min
- Consulta médica / dentista / exame / terapia → 1 h
- Treino / academia / corrida / exercício → 1 h
- Almoço / café / jantar → 1 h
- Aula / curso / workshop / treinamento → 1h30
- Default (qualquer outro) → 1 h`;

  const dateRules =
    source === "voice"
      ? `REGRAS DE DATA:
- "amanhã" = próximo dia
- "próxima [dia]" = o [dia] da semana que vem (nunca o da semana atual)
- "semana que vem" = mesma hora, +7 dias
- "daqui a Xh" = agora + X horas
- Se sem horário e isAllDay=false, use 08:00 como padrão
- Para eventos all-day: startTime e endTime devem ter T00:00:00 com o offset correto
- Se a data mencionada (dia/mês) já passou neste ano, use o mesmo dia/mês do ano seguinte`
      : `REGRAS DE DATA:
- "amanhã" = próximo dia
- "próxima [dia]" = o [dia] da semana que vem (nunca o da semana atual)
- Se sem horário e isAllDay=false, use 08:00 como padrão
- Para eventos all-day: startTime e endTime devem ter T00:00:00 com o offset correto
- Se a data mencionada (dia/mês) já passou neste ano, use o mesmo dia/mês do ano seguinte
- "21 e 22 de agosto" ou "21 a 22 de agosto" com um único horário (ex: "08h às 20h") descreve o MESMO evento ocorrendo em cada um dos dias — gere um item por dia, repetindo título e horário. Só gere um único item atravessando os dias se o texto indicar explicitamente evento contínuo (pernoite, viagem, hospedagem)`;

  const isDelegableRule =
    source === "voice"
      ? `- isDelegable: true se o usuário disser "delegar", "pedir para", "mandar alguém"`
      : `- isDelegable: true se o conteúdo sugerir que a tarefa pode ser delegada`;

  const attendeesLine =
    source === "voice"
      ? ""
      : `\n- attendees: lista de e-mails de convidados/participantes visíveis no documento/imagem. Lista vazia se nenhum e-mail estiver visível.`;

  return `${intro}

Data/hora atual: ${nowStr} (fuso: ${tz})

Agendas disponíveis:
${calendarList}

Retorne um array \`events\`, com um item por evento encontrado. Se houver apenas um evento, retorne um array com 1 item. Cada item tem os campos abaixo — todos são opcionais exceto title, startTime e endTime.

- title: resumo curto e direto do evento (máx. 5 palavras). Nunca inclua data, hora ou detalhes no título.
- description: informações adicionais que não cabem no título (local, pauta, nome completo, link, observações). Deixe vazio se não houver nada relevante.
- startTime: ISO 8601 com offset do fuso ${tz}, ex: 2026-06-11T14:00:00-03:00
- endTime: ISO 8601 com offset do fuso ${tz}, calcule com base na duração abaixo
- calendarId: id da agenda que melhor combina com o nome mencionado (veja regras abaixo); null se ambíguo
- isImportant: true se mencionar "importante", "urgente", "prioridade"
- isAllDay: true se o evento não tiver horário específico (o dia todo)
- pillar: 'trabalho' | 'saude' | 'familia' | 'espiritualidade' — inferir pelo contexto (veja exemplos abaixo)
- category: 'operational' | 'strategic' — inferir pelo tipo (veja exemplos abaixo)
${isDelegableRule}
- recurrenceType: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly', ou null se não houver recorrência${attendeesLine}

${durationRules}

MATCH DE AGENDA (calendarId):
- Compare o nome mencionado com os nomes das agendas ignorando maiúsculas, acentos e artigos.
- Prioridade: palavra inteira > prefixo > substring.
- Se nenhum nome for mencionado ou houver ambiguidade, retorne null.

PILAR — exemplos de inferência:
- trabalho: reunião, cliente, projeto, código, planejamento, proposta, nota fiscal, contrato, apresentação
- saude: médico, dentista, treino, terapia, exame, farmácia, academia, corrida, psicólogo
- familia: aniversário, escola dos filhos, jantar familiar, viagem com família, buscar/levar filho
- espiritualidade: igreja, meditação, oração, retiro, leitura espiritual, culto, missa

CATEGORIA — exemplos:
- operational: responder e-mails, cadastrar nota fiscal, organizar, conferir, ligar para fulano, rotina
- strategic: reunião 1:1, planejamento, tomada de decisão, criação de produto, alinhamento estratégico

${dateRules}`;
}

function normalizeEvent(raw: Record<string, unknown>): ParsedEvent {
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
    attendees: Array.isArray(raw.attendees) ? raw.attendees.map(String) : undefined,
  };
}

export async function extractEventFieldsFromMedia(
  input: MediaInput,
  now: Date,
  tz: string,
  calendars: { id: string; name: string }[]
): Promise<ParsedEvent[]> {
  const systemPrompt = buildSystemPrompt(now, tz, calendars, input.kind === "transcript" ? "voice" : "media");

  const content: Anthropic.Messages.ContentBlockParam[] =
    input.kind === "image"
      ? [
          { type: "image", source: { type: "base64", media_type: input.mimeType as "image/jpeg", data: input.base64 } },
          { type: "text", text: "Extraia os dados do evento a partir desta imagem." },
        ]
      : input.kind === "pdf"
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } },
          { type: "text", text: "Extraia os dados do evento a partir deste documento." },
        ]
      : input.kind === "transcript"
      ? [{ type: "text", text: `Transcrição de voz: "${input.text}"` }]
      : [{ type: "text", text: `Conteúdo do arquivo:\n"""\n${input.text}\n"""` }];

  const message = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8192,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: EVENT_SCHEMA },
    },
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });

  const textBlock = message.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  if (!textBlock) {
    throw new Error("Claude não retornou conteúdo de texto");
  }
  const raw = JSON.parse(textBlock.text) as { events?: unknown };
  if (!Array.isArray(raw.events) || raw.events.length === 0) {
    throw new Error("Nenhum evento encontrado");
  }

  return raw.events.map((e) => normalizeEvent(e as Record<string, unknown>));
}
