import Anthropic from "@anthropic-ai/sdk";
import { Pillar } from "@/types/task";
import { ParsedEvent } from "@/lib/openai-event-parser";

const client = new Anthropic();

export type MediaInput =
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string };

const EVENT_SCHEMA = {
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

function buildSystemPrompt(now: Date, tz: string, calendars: { id: string; name: string }[]): string {
  const dayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const nowStr = `${dayNames[now.getDay()]}, ${now.getDate()} de ${monthNames[now.getMonth()]} de ${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const calendarList = calendars.length
    ? calendars.map((c) => `- id: "${c.id}", nome: "${c.name}"`).join("\n")
    : "- id: \"primary\", nome: \"Principal\"";

  return `Você é um assistente de agenda. Extraia os detalhes de um evento a partir de uma imagem, PDF ou texto de um arquivo enviado pelo usuário (convite, print de conversa, comprovante, e-mail).

Data/hora atual: ${nowStr} (fuso: ${tz})

Agendas disponíveis:
${calendarList}

Retorne os campos abaixo. Todos são opcionais exceto title, startTime e endTime.

- title: resumo curto e direto do evento (máx. 5 palavras). Nunca inclua data, hora ou detalhes no título.
- description: informações adicionais que não cabem no título (local, pauta, nome completo, link, observações). Deixe vazio se não houver nada relevante.
- startTime: ISO 8601 com offset do fuso ${tz}, ex: 2026-06-11T14:00:00-03:00
- endTime: ISO 8601 com offset do fuso ${tz}, calcule com base na duração abaixo
- calendarId: id da agenda que melhor combina com o nome mencionado (veja regras abaixo); null se ambíguo
- isImportant: true se mencionar "importante", "urgente", "prioridade"
- isAllDay: true se o evento não tiver horário específico (o dia todo)
- pillar: 'trabalho' | 'saude' | 'familia' | 'espiritualidade' — inferir pelo contexto (veja exemplos abaixo)
- category: 'operational' | 'strategic' — inferir pelo tipo (veja exemplos abaixo)
- isDelegable: true se o conteúdo sugerir que a tarefa pode ser delegada
- recurrenceType: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly', ou null se não houver recorrência
- attendees: lista de e-mails de convidados/participantes visíveis no documento/imagem. Lista vazia se nenhum e-mail estiver visível.

DURAÇÃO ESTIMADA (use quando não houver duração explícita):
- Ligação / call → 15 min
- Reunião / standup / alinhamento / check-in → 30 min
- Consulta médica / dentista / exame / terapia → 1 h
- Treino / academia / corrida / exercício → 1 h
- Almoço / café / jantar → 1 h
- Aula / curso / workshop / treinamento → 1h30
- Default (qualquer outro) → 1 h

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

REGRAS DE DATA:
- "amanhã" = próximo dia
- "próxima [dia]" = o [dia] da semana que vem (nunca o da semana atual)
- Se sem horário e isAllDay=false, use 08:00 como padrão
- Para eventos all-day: startTime e endTime devem ter T00:00:00 com o offset correto`;
}

export async function extractEventFieldsFromMedia(
  input: MediaInput,
  now: Date,
  tz: string,
  calendars: { id: string; name: string }[]
): Promise<ParsedEvent> {
  const systemPrompt = buildSystemPrompt(now, tz, calendars);

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
      : [{ type: "text", text: `Conteúdo do arquivo:\n"""\n${input.text}\n"""` }];

  const message = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
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
  const raw = JSON.parse(textBlock.text) as Record<string, unknown>;

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
