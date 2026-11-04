import fs from "fs";
import path from "path";
import {
  listarEmailDoUsuario,
  listarEventosModificados,
  listarTodosEventos,
} from "./google-calendar";
import { sendTelegramMessage } from "./telegram";
import { sendPushNotification } from "./push-notifier";
import {
  montarMensagem,
  podarVistos,
  registrarVisto,
  selecionarNovas,
  type Chegada,
  type EventoChegada,
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
 */
const JANELA_HORAS = Number(process.env.NOVOS_EVENTOS_JANELA_HORAS ?? 24);

export interface EstadoMonitor {
  /** Por evento, em quais agendas ele já apareceu. */
  registro: Registro;
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

export function carregarEstado(): EstadoMonitor {
  try {
    const data = JSON.parse(fs.readFileSync(ESTADO_FILE, "utf-8"));
    return {
      registro:
        typeof data.registro === "object" && data.registro ? data.registro : {},
      inicializadoEm: typeof data.inicializadoEm === "string" ? data.inicializadoEm : undefined,
      ultimaVarredura: typeof data.ultimaVarredura === "string" ? data.ultimaVarredura : undefined,
    };
  } catch {
    return { registro: {} };
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
      inicializadoEm: agora.toISOString(),
      ultimaVarredura: agora.toISOString(),
    };
    if (!options.dryRun) salvarEstado(novoEstado);
    console.log(
      `[NOVOS EVENTOS] Primeira execução: ${Object.keys(novoEstado.registro).length} eventos registrados, sem avisos.`
    );
    return { chegadas: [], mensagens: [], bootstrap: true };
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
  const mensagens = chegadas.map((c) => montarMensagem(c, timeZone));

  if (!options.dryRun) {
    for (let i = 0; i < chegadas.length; i++) {
      const chegada = chegadas[i];
      const msg = mensagens[i];
      try {
        await sendPushNotification(msg.pushTitulo, msg.pushCorpo, `flow-chegada-${chegada.evento.id}`);
        await sendTelegramMessage(msg.telegram);
        console.log(
          `[NOVOS EVENTOS] ${chegada.tipo === "convite" ? "Convite" : "Evento externo"}: "${chegada.evento.summary}" [${chegada.evento.agendaNome}]`
        );
      } catch (err) {
        console.error("[NOVOS EVENTOS] Falha ao enviar aviso:", err);
        // Não registra — tenta de novo na próxima varredura.
        continue;
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
    estado.ultimaVarredura = agora.toISOString();
    salvarEstado(estado);
  }

  return { chegadas, mensagens, bootstrap: false };
}
