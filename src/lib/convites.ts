/**
 * Convites em aberto — a ponte entre o aviso no Telegram e o RSVP no Google.
 *
 * O texto do aviso e o botão que responde o convite precisam concordar sobre
 * **qual** evento é o alvo. O botão carrega só um token (por limite de 64
 * bytes do `callback_data` do Telegram); o par evento+agenda fica no
 * arquivo de estado.
 *
 * A gravação do RSVP em si vive aqui — e não no `telegram-bot` — porque a
 * mesma lógica serve pro botão e pro comando `/convites`.
 */

import {
  listarConvites,
  listarEmailDoUsuario,
  updateEventRsvp,
} from "./google-calendar";
import { selecionarConvitesPendentes, type Chegada } from "./novos-eventos";
import {
  buscarConvite,
  registrarConvite,
  removerConvite,
  tecladoDeConvite,
  tokenDoConvite,
  type ConvitePendente,
  type TecladoInline,
} from "./convites-rsvp";

/** Convite aberto, pronto pra virar botão. */
export interface ConviteComBotao {
  chegada: Chegada;
  token: string;
  teclado: TecladoInline;
}

/** Janela de busca dos convites: de ontem até 90 dias à frente. */
const JANELA_DIAS = 90;

export function emailDoUsuario(): string | undefined {
  return process.env.AUTH_USER_EMAIL?.trim() || undefined;
}

/**
 * Convites em aberto, com o token do botão já registrado.
 *
 * Registrar é o que faz o botão funcionar: o token é determinístico
 * (hash de agenda+evento), então rodar isso de novo não duplica nada.
 */
export async function listarConvitesComBotao(
  accessToken: string
): Promise<ConviteComBotao[]> {
  const email = emailDoUsuario() ?? (await listarEmailDoUsuario(accessToken));
  if (!email) return [];

  const agora = Date.now();
  const inicio = new Date(agora - 24 * 60 * 60 * 1000);
  const fim = new Date(agora + JANELA_DIAS * 24 * 60 * 60 * 1000);

  const eventos = await listarConvites(accessToken, email, inicio, fim);
  const pendentes = selecionarConvitesPendentes(eventos, { emailUsuario: email });

  const comBotao: ConviteComBotao[] = [];
  for (const chegada of pendentes) {
    const rsvp = chegada.rsvp;
    if (!rsvp) continue;
    const token = registrarConvite({
      eventId: rsvp.eventId,
      calendarId: rsvp.calendarId,
      titulo: chegada.evento.summary,
    });
    comBotao.push({ chegada, token, teclado: tecladoDeConvite(token) });
  }
  return comBotao;
}

/** O alvo do botão: qual evento+agenda o token responde. */
export function alvoDoBotao(token: string): ConvitePendente | null {
  return buscarConvite(token);
}

/** Token determinístico — o mesmo par agenda+evento dá o mesmo token. */
export { tokenDoConvite };

export type StatusRsvp = "accepted" | "tentative" | "declined";

/**
 * Grava a resposta do convite no Google Calendar.
 *
 * O `attendees` do Google é uma **substituição**, não um merge — a lista
 * inteira vai no patch, com o status do Felipe trocado. Por isso o
 * `updateEventRsvp` lê o evento antes de gravar.
 *
 * Recorrência: a resposta de um convite recorrente mora na série (o
 * `master`), não na ocorrência — o Google guarda o RSVP do participante no
 * evento que tem a `recurrence`. Por isso a gravação principal é no
 * `master` e, se o Google recusar, ela cai pra ocorrência.
 */
export async function responderConvite(
  accessToken: string,
  token: string,
  status: StatusRsvp
): Promise<{ titulo: string; status: StatusRsvp }> {
  const convite = buscarConvite(token);
  if (!convite) {
    throw new Error("Convite expirado ou desconhecido");
  }

  const email = emailDoUsuario();
  try {
    await updateEventRsvp(
      accessToken,
      convite.eventId,
      convite.calendarId,
      status,
      email,
      "all"
    );
  } catch (err) {
    // Ocorrência isolada de uma série (o master não é gravável): tenta
    // na própria ocorrência.
    await updateEventRsvp(
      accessToken,
      convite.eventId,
      convite.calendarId,
      status,
      email,
      "this"
    );
  }

  removerConvite(token);
  return { titulo: convite.titulo, status };
}
