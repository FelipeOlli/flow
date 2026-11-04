/**
 * Convites em aberto — o registro que liga o botão do Telegram ao evento.
 *
 * O aviso de convite é enviado pelo **monitor** (que roda no cron, dentro do
 * `instrumentation.ts`) e o clique no botão chega no **webhook** (que roda no
 * bundle da rota). Esses dois lados são instâncias de módulo diferentes do
 * Next — o estado em memória de um não é visível pro outro. Por isso o
 * vínculo entre o botão e o evento vive num arquivo, como os outros estados
 * do app (`.novos-eventos.json`, `.secretaria-notified.json`).
 *
 * O token é **determinístico** (hash de `agenda|evento`): reavisar o mesmo
 * convite reusa o mesmo botão, e o registro nunca duplica.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR =
  process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();

const ARQUIVO =
  process.env.CONVITES_RSVP_ARQUIVO ??
  path.join(DATA_DIR, ".convites-pendentes.json");

/** Convites guardados por 6 meses — um convite pode ser de daqui a muito tempo. */
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Teclado inline — mesma forma que o Telegram espera.
 *
 * Definido aqui (e não importado de `telegram-bot/types`) pra esse módulo
 * não depender do bot: o registro de convites é usado pelo monitor (cron)
 * e pelo bot (webhook), que são bundles diferentes. A forma é a mesma do
 * `TgInlineKeyboardMarkup` — compatível na hora de passar pro Telegram.
 */
export interface TecladoInline {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface ConvitePendente {
  /** Id do evento na agenda onde o RSVP deve ser gravado. */
  eventId: string;
  /** Agenda desse evento (tem que ser a mesma do `eventId`). */
  calendarId: string;
  titulo: string;
  criadoEm: string;
  expiraEm: string;
}

interface Estado {
  convites: Record<string, ConvitePendente>;
}

function carregar(): Estado {
  try {
    const data = JSON.parse(fs.readFileSync(ARQUIVO, "utf-8"));
    const convites =
      typeof data?.convites === "object" && data.convites ? data.convites : {};
    return { convites };
  } catch {
    return { convites: {} };
  }
}

function salvar(estado: Estado): void {
  // Grava em arquivo temporário e renomeia: o `rename` é atômico no
  // disco, então quem lê (o webhook) nunca vê um JSON pela metade.
  const tmp = `${ARQUIVO}.tmp`;
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), "utf-8");
    fs.renameSync(tmp, ARQUIVO);
  } catch (err) {
    console.error("[CONVITES] Falha ao salvar estado:", err);
    try {
      fs.unlinkSync(tmp);
    } catch {
      // arquivo temporário não existiu — nada a limpar
    }
  }
}

/**
 * Token do botão — determinístico pro mesmo par agenda/evento.
 *
 * 16 caracteres de base64url cabem folgados no `callback_data` do Telegram
 * (limite de 64 bytes), mesmo com o prefixo e a ação.
 */
export function tokenDoConvite(calendarId: string, eventId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${calendarId}|${eventId}`)
    .digest("base64url")
    .slice(0, 16);
}

/** Os três botões de resposta do convite. */
export function tecladoDeConvite(token: string): TecladoInline {
  return {
    inline_keyboard: [
      [
        { text: "✅ Aceitar", callback_data: `convite:${token}:aceitar` },
        { text: "❔ Talvez", callback_data: `convite:${token}:talvez` },
        { text: "❌ Recusar", callback_data: `convite:${token}:recusar` },
      ],
    ],
  };
}

/**
 * Registra um convite em aberto e devolve o token do botão.
 *
 * Registrar o mesmo par de novo renova o prazo — não duplica a entrada.
 */
export function registrarConvite(dados: {
  eventId: string;
  calendarId: string;
  titulo: string;
}): string {
  const token = tokenDoConvite(dados.calendarId, dados.eventId);
  const estado = carregar();
  const agora = Date.now();

  estado.convites[token] = {
    eventId: dados.eventId,
    calendarId: dados.calendarId,
    titulo: dados.titulo,
    criadoEm: new Date(agora).toISOString(),
    expiraEm: new Date(agora + TTL_MS).toISOString(),
  };

  // Limpa o que expirou — o arquivo não pode crescer sem parar.
  for (const [chave, convite] of Object.entries(estado.convites)) {
    if (Date.parse(convite.expiraEm) <= agora) delete estado.convites[chave];
  }

  salvar(estado);
  return token;
}

/** O convite do token — `null` se não existe ou expirou. */
export function buscarConvite(token: string): ConvitePendente | null {
  const estado = carregar();
  const convite = estado.convites[token];
  if (!convite) return null;
  if (Date.parse(convite.expiraEm) <= Date.now()) {
    delete estado.convites[token];
    salvar(estado);
    return null;
  }
  return convite;
}

/** Tirar o convite do registro depois de responder — evita responder duas vezes. */
export function removerConvite(token: string): void {
  const estado = carregar();
  if (!estado.convites[token]) return;
  delete estado.convites[token];
  salvar(estado);
}
