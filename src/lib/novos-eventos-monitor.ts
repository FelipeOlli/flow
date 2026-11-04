import fs from "fs";
import path from "path";
import {
  listarConvites,
  listarEmailDoUsuario,
  listarEventosModificados,
  listarTodosEventos,
} from "./google-calendar";
import { sendTelegramMessage } from "./telegram";
import { sendPushNotification } from "./push-notifier";
import { registrarConvite, tecladoDeConvite, type TecladoInline } from "./convites-rsvp";
import {
  montarMensagem,
  podarVistos,
  registrarVisto,
  selecionarConvitesPendentes,
  selecionarNovas,
  seriesRespondidas,
  identidadeDoEvento,
  type Chegada,
  type Registro,
} from "./novos-eventos";

const DATA_DIR =
  process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();

/**
 * Caminho do arquivo de estado. Configurável pra_instances isoladas não
 * compartilharem o mesmo registro (dev local com dois servidores, testes).
 */
const ESTADO_FILE =
  process.env.NOVOS_EVENTOS_ESTADO_FILE ??
  path.join(DATA_DIR, ".novos-eventos.json");

/**
 * Janela de varredura. O Google devolve o que mudou depois de `updatedMin`;
 * a janela é folgada pra cobrir app fora do ar, e o registro de vistos
 * garante que nada seja avisado duas vezes.
 *
 * Limitada a 14 dias: o Google **rejeita** `updatedMin` muito antigo com
 * `updatedMinTooLongAgo` (HTTP 410) — e uma janela longa demais quebraria a
 * varredura inteira, não só o aviso.
 */
const JANELA_HORAS = Math.min(
  Number(process.env.NOVOS_EVENTOS_JANELA_HORAS ?? 24),
  14 * 24
);

/**
 * Janela da varredura de convites pendentes.
 *
 * O Google **rejeita** `updatedMin` com mais de ~14 dias
 * (`updatedMinTooLongAgo`), mas `timeMin`/`timeMax` aceitam janelas bem
 * maiores — então a varredura de convites usa data do evento, não data de
 * modificação.
 */
const CONVITES_JANELA_DIAS = Number(process.env.NOVOS_EVENTOS_CONVITES_JANELA_DIAS ?? 90);

/**
 * Convite pendente = o Felipe foi convidado e ainda não respondeu.
 *
 * A varredura de chegadas (o que mudou) **não** pega esses convites: quem
 * adiciona o Felipe a um evento que já estava na agenda só muda o evento
 * numa agenda — e o filtro de "já apareceu em agenda nenhuma" descarta.
 * Pior: na primeira execução (bootstrap) todos os eventos são registrados
 * como vistos, então um convite que já estava pendente antes do monitor
 * existir jamais seria avisado.
 *
 * A varredura de convites é o complemento: pergunta direto ao Google "em
 * quais eventos eu tenho convite em aberto", e avisa cada série uma vez só.
 */
export interface EstadoMonitor {
  /** Por evento, em quais agendas ele já apareceu. */
  registro: Registro;
  /**
   * Convites já avisados, pelo `iCalUID` da série.
   *
   * Separado do `registro` de propósito: o `registro` diz "esse evento já
   * apareceu na agenda" (usado pra distinguir "chegou" de "mudou de
   * agenda"), e não serve pra isso — um convite pendente que já estava na
   * agenda antes do primeiro registro do monitor é justamente o que nunca
   * pode ser engolido em silêncio.
   */
  convitesAvisados: string[];
  inicializadoEm?: string;
  ultimaVarredura?: string;
}

export interface ResultadoMonitor {
  /** Chegadas novas detectadas (já filtradas). */
  chegadas: Chegada[];
  /** Mensagens que seriam enviadas (dry-run) ou foram enviadas. */
  mensagens: { telegram: string; pushTitulo: string; pushCorpo: string }[];
  /** Primeira execução — só registrei o estado, sem avisar ninguém. */
  bootstrap: boolean;
}

/**
 * As duas varreduras (chegadas e convites) leem e escrevem o mesmo arquivo
 * de estado. Sem serializar, elas correm juntas no cron (a cada 30 min os
 * jobs de 5 e de 30 minutos caem no mesmo minuto) e uma sobrescreve a
 * gravação da outra — o que faria um convite ser avisado duas vezes.
 *
 * Fila simples: cada varredura espera a anterior terminar.
 */
let filaMonitor: Promise<unknown> = Promise.resolve();

function emFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const resultado = filaMonitor.then(tarefa, tarefa);
  // A fila não pode quebrar por causa de uma tarefa que falhou.
  filaMonitor = resultado.catch(() => undefined);
  return resultado;
}

export function carregarEstado(): EstadoMonitor {
  try {
    const data = JSON.parse(fs.readFileSync(ESTADO_FILE, "utf-8"));
    return {
      registro:
        typeof data.registro === "object" && data.registro ? data.registro : {},
      convitesAvisados: Array.isArray(data.convitesAvisados) ? data.convitesAvisados : [],
      inicializadoEm: typeof data.inicializadoEm === "string" ? data.inicializadoEm : undefined,
      ultimaVarredura: typeof data.ultimaVarredura === "string" ? data.ultimaVarredura : undefined,
    };
  } catch {
    return { registro: {}, convitesAvisados: [] };
  }
}

export function salvarEstado(estado: EstadoMonitor): void {
  try {
    fs.mkdirSync(path.dirname(ESTADO_FILE), { recursive: true });
    fs.writeFileSync(ESTADO_FILE, JSON.stringify(estado, null, 2), "utf-8");
  } catch (err) {
    console.error("[NOVOS EVENTOS] Falha ao salvar estado:", err);
  }
}

/**
 * E-mail do dono do token. O `AUTH_USER_EMAIL` é a fonte oficial, mas pode
 * não estar configurado — aí usamos o id da agenda principal, que no Google
 * é o próprio e-mail da conta.
 */
function emailDoUsuarioDoEnv(): string | undefined {
  const doEnv = process.env.AUTH_USER_EMAIL?.trim();
  return doEnv || undefined;
}

function agendasIgnoradas(): string[] {
  return (process.env.NOVOS_EVENTOS_AGENDAS_IGNORADAS ?? "feriado")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Varre as agendas procurando convites em aberto e avisa os que ainda não
 * foram avisados.
 *
 * Cada série é avisada uma vez só — a chave é o `iCalUID`. Um convite que
 * continua em aberto nasce um aviso novo só quando o estado muda (ex.: o
 * Felipe responde e depois é convidado de novo).
 */
export async function monitorarConvitesPendentes(
  accessToken: string,
  timeZone: string,
  options: { dryRun?: boolean } = {}
): Promise<{
  chegadas: Chegada[];
  mensagens: { telegram: string; pushTitulo: string; pushCorpo: string }[];
  bootstrap: boolean;
}> {
  return emFila(() => monitorarConvitesPendentesInterno(accessToken, timeZone, options));
}

async function monitorarConvitesPendentesInterno(
  accessToken: string,
  timeZone: string,
  options: { dryRun?: boolean }
): Promise<{
  chegadas: Chegada[];
  mensagens: { telegram: string; pushTitulo: string; pushCorpo: string }[];
  bootstrap: boolean;
}> {
  const agora = new Date();
  const estado = carregarEstado();

  const emailUsuario =
    emailDoUsuarioDoEnv() ?? (await listarEmailDoUsuario(accessToken));
  if (!emailUsuario) {
    return { chegadas: [], mensagens: [], bootstrap: false };
  }

  const opcoes = {
    emailUsuario,
    avisarProprios: process.env.NOVOS_EVENTOS_AVISAR_PROPRIOS === "on",
    agendasIgnoradas: agendasIgnoradas(),
  };

  // Janela pelo início do evento: do começo de ontem (pega o convite de
  // hoje que começou antes da meia-noite) até 90 dias à frente.
  const inicio = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const fim = new Date(agora.getTime() + CONVITES_JANELA_DIAS * 24 * 60 * 60 * 1000);

  const eventos = await listarConvites(accessToken, emailUsuario, inicio, fim);

  // Séries que o Felipe já respondeu saem do registro de avisos: se ele
  // for convidado de novo depois, o aviso volta a valer.
  const respondidas = new Set(seriesRespondidas(eventos, emailUsuario));
  if (respondidas.size > 0) {
    estado.convitesAvisados = estado.convitesAvisados.filter(
      (id) => !respondidas.has(id)
    );
  }

  const pendentes = selecionarConvitesPendentes(eventos, opcoes);

  // Cada série é avisada uma vez só.
  const novos = pendentes.filter(
    (c) => !estado.convitesAvisados.includes(identidadeDoEvento(c.evento))
  );
  const mensagens = novos.map((c) => montarMensagem(c, timeZone));

  if (!options.dryRun) {
    for (let i = 0; i < novos.length; i++) {
      const chegada = novos[i];
      const msg = mensagens[i];
      const entregue = await enviarAviso(
        msg,
        `flow-convite-${chegada.evento.id}`,
        tecladoDaChegada(chegada)
      );
      if (!entregue) {
        console.error(
          `[NOVOS EVENTOS] Falha ao enviar aviso de convite: "${chegada.evento.summary}"`
        );
        // Não registra — tenta de novo na próxima varredura.
        continue;
      }
      estado.convitesAvisados.push(identidadeDoEvento(chegada.evento));
      console.log(
        `[NOVOS EVENTOS] Convite: "${chegada.evento.summary}" [${chegada.evento.agendaNome}]`
      );
    }
    estado.convitesAvisados = estado.convitesAvisados.slice(-500);
    salvarEstado(estado);
  }

  return { chegadas: novos, mensagens, bootstrap: false };
}

/**
 * Envia o aviso pelos dois canais (Web Push + Telegram).
 *
 * Devolve `false` só quando **nenhum** canal entregou. Canal não
 * configurado (sem VAPID, sem subscriptions, sem token) não conta como
 * falha — é ausência de canal, não erro de envio.
 *
 * O teclado vai só no Telegram: push do navegador não tem botão de
 * resposta embutido, e o Web Push tem limite de payload.
 */
async function enviarAviso(
  msg: { telegram: string; pushTitulo: string; pushCorpo: string },
  tag: string,
  teclado?: TecladoInline
): Promise<boolean> {
  const [pushOk, telegramOk] = await Promise.all([
    sendPushNotification(msg.pushTitulo, msg.pushCorpo, tag),
    sendTelegramMessage(msg.telegram, teclado ? { replyMarkup: teclado } : {}),
  ]);
  return pushOk || telegramOk;
}

/**
 * Botões de resposta pra um convite.
 *
 * O token é o vínculo entre o botão e o evento — e precisa estar
 * registrado **antes** do envio, senão o clique chega e não acha o alvo.
 */
function tecladoDaChegada(chegada: Chegada): TecladoInline | undefined {
  if (chegada.tipo !== "convite" || !chegada.rsvp) return undefined;
  const token = registrarConvite({
    eventId: chegada.rsvp.eventId,
    calendarId: chegada.rsvp.calendarId,
    titulo: chegada.evento.summary,
  });
  return tecladoDeConvite(token);
}

/**
 * Varre as agendas e avisa sobre as chegadas novas.
 *
 * Na primeira execução não avisa ninguém: registra o estado atual da agenda
 * como já vista, pra não disparar uma avalanche de avisos com o histórico
 * inteiro.
 */
export async function monitorarNovosEventos(
  accessToken: string,
  timeZone: string,
  options: { dryRun?: boolean } = {}
): Promise<ResultadoMonitor> {
  return emFila(() => monitorarNovosEventosInterno(accessToken, timeZone, options));
}

async function monitorarNovosEventosInterno(
  accessToken: string,
  timeZone: string,
  options: { dryRun?: boolean }
): Promise<ResultadoMonitor> {
  const agora = new Date();
  const estado = carregarEstado();
  const bootstrap = !estado.inicializadoEm;

  const emailUsuario =
    emailDoUsuarioDoEnv() ?? (await listarEmailDoUsuario(accessToken));

  const opcoes = {
    emailUsuario,
    avisarProprios: process.env.NOVOS_EVENTOS_AVISAR_PROPRIOS === "on",
    agendasIgnoradas: agendasIgnoradas(),
  };

  if (bootstrap) {
    // Marca tudo como visto — o histórico não é "chegada nova".
    // Usa a listagem completa (não a janela de 24h): um evento antigo que a
    // migração noturna mexer vai reaparecer na próxima varredura, e ele
    // precisa já estar no registro.
    const todos = await listarTodosEventos(accessToken);
    const registro: Registro = {};
    for (const evento of todos) registrarVisto(registro, evento, agora.toISOString());
    const novoEstado: EstadoMonitor = {
      registro: podarVistos(registro, agora),
      convitesAvisados: [],
      inicializadoEm: agora.toISOString(),
      ultimaVarredura: agora.toISOString(),
    };
    if (!options.dryRun) salvarEstado(novoEstado);
    console.log(
      `[NOVOS EVENTOS] Primeira execução: ${Object.keys(novoEstado.registro).length} eventos registrados, sem avisos.`
    );

    // O histórico entra em silêncio, mas um **convite em aberto** não: ele
    // exige resposta do Felipe, e engoli-lo é perder a única informação
    // acionável da agenda. A varredura de convites é quem cuida disso.
    //
    // Chama a versão interna (não a pública): a pública entra na fila, e
    // esta já está na fila — entrar de novo esperaria por si mesma.
    const convites = await monitorarConvitesPendentesInterno(accessToken, timeZone, options);
    return { chegadas: convites.chegadas, mensagens: convites.mensagens, bootstrap: true };
  }

  // Varredura incremental: só o que mudou desde a última vez. A janela
  // máxima é o piso — cobre o app fora do ar por algumas horas.
  const piso = agora.getTime() - JANELA_HORAS * 60 * 60 * 1000;
  const ultima = estado.ultimaVarredura ? Date.parse(estado.ultimaVarredura) : NaN;
  // 2 min de folga: o `updated` do Google tem resolução de segundo e a
  // varredura pode ter rodado no meio da gravação.
  const desde = new Date(
    Number.isNaN(ultima) ? piso : Math.max(piso, ultima - 2 * 60 * 1000)
  );
  const eventos = await listarEventosModificados(accessToken, desde);

  const chegadas = selecionarNovas(eventos, estado.registro, opcoes);

  // A varredura de convites pendentes é a dona dos convites. Se um convite
  // foi avisado por ela, a varredura de chegadas não repete o aviso — e
  // vice-versa. Sem isso, o mesmo convite apareceria duas vezes.
  const semDuplicar = chegadas.filter((c) => {
    if (c.tipo !== "convite") return true;
    return !estado.convitesAvisados.includes(identidadeDoEvento(c.evento));
  });

  const mensagens = semDuplicar.map((c) => montarMensagem(c, timeZone));

  if (!options.dryRun) {
    for (let i = 0; i < semDuplicar.length; i++) {
      const chegada = semDuplicar[i];
      const msg = mensagens[i];
      const entregue = await enviarAviso(
        msg,
        `flow-chegada-${chegada.evento.id}`,
        tecladoDaChegada(chegada)
      );
      if (!entregue) {
        console.error(
          `[NOVOS EVENTOS] Falha ao enviar aviso: "${chegada.evento.summary}"`
        );
        // Não registra — tenta de novo na próxima varredura.
        continue;
      }
      console.log(
        `[NOVOS EVENTOS] ${chegada.tipo === "convite" ? "Convite" : "Evento externo"}: "${chegada.evento.summary}" [${chegada.evento.agendaNome}]`
      );
      // Convites são rastreados também na lista de convites avisados — é o
      // que impede a dupla notificação entre as duas varreduras.
      if (chegada.tipo === "convite") {
        estado.convitesAvisados.push(identidadeDoEvento(chegada.evento));
      }
      // Registra em todas as agendas onde o evento apareceu — senão a mesma
      // chegada seria avisada de novo no ciclo seguinte.
      registrarVisto(estado.registro, chegada.evento, agora.toISOString());
    }

    // Também registra o que apareceu mas não foi avisado (evento do Flow,
    // do próprio usuário, feriado). Sem isso, ele voltaria toda hora.
    for (const evento of eventos) {
      registrarVisto(estado.registro, evento, agora.toISOString());
    }

    estado.registro = podarVistos(estado.registro, agora);
    estado.convitesAvisados = estado.convitesAvisados.slice(-500);
    estado.ultimaVarredura = agora.toISOString();
    salvarEstado(estado);
  }

  return { chegadas: semDuplicar, mensagens, bootstrap: false };
}
