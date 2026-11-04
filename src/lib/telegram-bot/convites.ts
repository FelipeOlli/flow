/**
 * Resposta a convite pelo botão do Telegram.
 *
 * O botão carrega um token (limite de 64 bytes do `callback_data`), e o
 * token aponta pro evento + agenda onde a resposta deve ser gravada.
 *
 * Um detalhe do Telegram: `callback_data` **não sobrevive ao reinício do
 * contêiner** — os botões pendentes morrem com o processo. O registro em
 * arquivo cobre o outro lado (o aviso é enviado pelo cron, o clique chega
 * pela rota — bundles diferentes, memória diferente).
 */

import {
  answerTelegramCallbackQuery,
  editTelegramMessage,
  sendTelegramMessage,
} from "@/lib/telegram";
import { getValidAccessToken } from "@/lib/token-store";
import { listarConvitesComBotao, responderConvite, type StatusRsvp } from "@/lib/convites";
import { escapeHtml } from "./formatter";
import type { TgCallbackQuery } from "./types";

const ROTULO: Record<StatusRsvp, string> = {
  accepted: "✅ Convite aceito",
  tentative: "❔ Convite marcado como talvez",
  declined: "❌ Convite recusado",
};

function statusDaAcao(acao: string): StatusRsvp | null {
  if (acao === "aceitar") return "accepted";
  if (acao === "talvez") return "tentative";
  if (acao === "recusar") return "declined";
  return null;
}

/**
 * Trata o clique num botão de convite.
 *
 * Devolve `true` quando o clique era de convite (mesmo em caso de erro) —
 * o dispatcher usa isso pra saber que não deve seguir pro fluxo de criação.
 */
export async function handleConviteCallback(cb: TgCallbackQuery): Promise<boolean> {
  const partes = (cb.data ?? "").split(":");
  if (partes[0] !== "convite") return false;

  const token = partes[1];
  const status = statusDaAcao(partes[2] ?? "");
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;

  if (!token || !status) {
    await answerTelegramCallbackQuery(cb.id);
    return true;
  }

  const tokenGoogle = await getValidAccessToken();
  if (!tokenGoogle) {
    await answerTelegramCallbackQuery(cb.id, "Google não autorizado", {
      showAlert: true,
    });
    if (chatId && messageId) {
      await editTelegramMessage(
        chatId,
        messageId,
        "Google não autorizado. Abra o Flow e reautorize."
      );
    }
    return true;
  }

  try {
    const resultado = await responderConvite(tokenGoogle, token, status);
    await answerTelegramCallbackQuery(cb.id, "Resposta registrada");
    if (chatId && messageId) {
      // Editar sem `reply_markup` remove os botões — a resposta já foi dada.
      await editTelegramMessage(
        chatId,
        messageId,
        `${ROTULO[resultado.status]}\n<b>${escapeHtml(resultado.titulo)}</b>`
      );
    }
  } catch (err) {
    console.error("[TELEGRAM-BOT] Falha ao responder convite:", err);
    const mensagem =
      err instanceof Error && err.message.includes("expirado")
        ? "Este convite expirou. Mande /convites pra ver os pendentes."
        : "Não consegui registrar a resposta. Tente de novo.";
    await answerTelegramCallbackQuery(cb.id, "Erro", { showAlert: true });
    if (chatId && messageId) {
      await editTelegramMessage(chatId, messageId, mensagem);
    }
  }
  return true;
}

/**
 * Lista os convites em aberto, cada um com seus botões.
 *
 * Existe porque um convite avisado antes desta funcionalidade já foi
 * enviado **sem** botões — e um convite pendente que ninguém vê não é
 * respondsido. O comando devolve a lista com os botões, então a resposta
 * não depende de quando o convite chegou.
 */
export async function enviarListaDeConvites(
  chatId: number,
  accessToken: string
): Promise<number> {
  const convites = await listarConvitesComBotao(accessToken);

  if (convites.length === 0) {
    await sendTelegramMessage("Nenhum convite pendente. ✅", { chatId });
    return 0;
  }

  for (const { chegada, teclado } of convites) {
    const quando = chegada.evento.diaInteiro
      ? ""
      : ` · ${chegada.evento.inicio.slice(11, 16)}`;
    await sendTelegramMessage(
      `📩 <b>${escapeHtml(chegada.evento.summary)}</b>\n` +
        `📂 ${escapeHtml(chegada.evento.agendaNome)}${quando}\n\n` +
        `Responda:`,
      { chatId, replyMarkup: teclado }
    );
  }
  return convites.length;
}
