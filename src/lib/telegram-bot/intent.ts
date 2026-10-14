// Wrapper de Claude específico pra frases curtas de chat. NÃO reusa
// extractEventFieldsFromMedia (cujo prompt é otimizado pra conteúdo colado /
// print / transcrição longa).

import Anthropic from "@anthropic-ai/sdk";
import type { ParsedEvent } from "@/lib/openai-event-parser";
import type { ChatIntent, TgEventTarget } from "./types";

const client = new Anthropic();

const INTENT_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: {
      type: "string",
      enum: ["create", "query", "complete", "delete", "unknown"],
    },
    // create
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          calendarId: { anyOf: [{ type: "string" }, { type: "null" }] },
          description: { anyOf: [{ type: "string" }, { type: "null" }] },
          isImportant: { type: "boolean" },
          isAllDay: { type: "boolean" },
          pillar: {
            anyOf: [
              { type: "string", enum: ["trabalho", "saude", "familia", "espiritualidade"] },
              { type: "null" },
            ],
          },
          category: {
            anyOf: [
              { type: "string", enum: ["operational", "strategic"] },
              { type: "null" },
            ],
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
      },
    },
    // query
    scope: { type: "string", enum: ["today", "tomorrow", "week", "search"] },
    q: { anyOf: [{ type: "string" }, { type: "null" }] },
    // complete / delete target
    target: {
      type: "object",
      properties: {
        byIndex: { anyOf: [{ type: "number" }, { type: "null" }] },
        byQuery: { anyOf: [{ type: "string" }, { type: "null" }] },
        eventId: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: false,
    },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["kind"],
  additionalProperties: false,
};

function buildSystemPrompt(now: Date, tz: string, calendars: { id: string; name: string }[]): string {
  const dayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const monthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const nowStr = `${dayNames[now.getDay()]}, ${now.getDate()} de ${monthNames[now.getMonth()]} de ${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const calList = calendars.length
    ? calendars.map((c) => `- id: "${c.id}", nome: "${c.name}"`).join("\n")
    : `- id: "primary", nome: "Principal"`;

  return `Você é o parser de intenção do bot do Flow Calendar. Recebe uma mensagem curta de chat em português brasileiro do Felipe e classifica em UMA das 5 categorias:

1. **create** — usuário quer CRIAR evento(s). Extrai lista de eventos. Use quando a frase diz "marca", "agenda", "cria", "anota", "lembra de", "tenho", "vou", "marcou", "é dia", "às X horas", ou descreve um compromisso futuro.
2. **query** — usuário quer CONSULTAR a agenda. Use quando pede pra ver o que tem ("o que tenho hoje", "e amanhã?", "busca reunião com João").
3. **complete** — usuário quer MARCAR COMO FEITO. Use "conclui", "terminei", "feito", "já fiz", "concluído".
4. **delete** — usuário quer APAGAR/CANCELAR. Use "cancela", "apaga", "remove", "esquece", "desmarca".
5. **unknown** — não é nenhuma das anteriores (saudação, pergunta genérica, ambiguidade real). Use isso pra "oi", "tudo bem", "obrigado", "como funciona?".

REGRAS:
- Fuso: ${tz}. Agora: ${nowStr}.
- "amanhã" = data de hoje + 1 dia. "depois de amanhã" = +2. "próxima [dia]" = próxima ocorrência. "daqui a Xh" = now + X horas.
- Datas em ISO 8601 com offset do fuso, ex: "2026-10-14T15:00:00-03:00".
- Duração default: ligação/call=15min, almoço=1h, reunião=30min, treino=1h, genérico=1h. Se o usuário disse duração explícita, use.
- Múltiplos eventos na mesma frase → kind=create com array. "reunião seg 10h e consulta qua 16h" → 2 eventos.
- "hoje" se já passou da hora → kind=create com data de amanhã (suposição razoável).
- Calendários disponíveis: ${calList}
- Para query: scope=today/tomorrow/week/search. search requer q.
- Para complete/delete: target.byIndex (se disse "o 1", "primeiro"), target.byQuery (se descreveu — "a reunião das 15h"), ou target.eventId (se colou ID Google).
- Se a frase for ambígua entre criar e consultar, prefira create (mais acionável).

Responda APENAS JSON conforme schema.`;
}

export async function parseChatIntent(
  text: string,
  now: Date,
  tz: string,
  calendars: { id: string; name: string }[],
): Promise<ChatIntent> {
  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: INTENT_SCHEMA as never },
      },
      system: buildSystemPrompt(now, tz, calendars),
      messages: [{ role: "user", content: text }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return { kind: "unknown" };
    const parsed = JSON.parse(textBlock.text);

    if (parsed.kind === "create") {
      const events: ParsedEvent[] = Array.isArray(parsed.events) ? parsed.events : [];
      if (events.length === 0) return { kind: "unknown" };
      return { kind: "create", events };
    }
    if (parsed.kind === "query") {
      return {
        kind: "query",
        scope: parsed.scope ?? "today",
        q: parsed.q ?? undefined,
      };
    }
    if (parsed.kind === "complete" || parsed.kind === "delete") {
      const t = parsed.target ?? {};
      let target: TgEventTarget;
      if (typeof t.eventId === "string") target = { eventId: t.eventId };
      else if (typeof t.byIndex === "number") target = { byIndex: t.byIndex };
      else if (typeof t.byQuery === "string") target = { byQuery: t.byQuery };
      else return { kind: "unknown" };
      return { kind: parsed.kind, target };
    }
    return { kind: "unknown" };
  } catch (err) {
    console.error("[TELEGRAM-BOT] parseChatIntent falhou:", err);
    return { kind: "unknown" };
  }
}
