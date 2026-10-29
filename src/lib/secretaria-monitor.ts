import fs from "fs";
import path from "path";
import { getEventsForDateKey, getEventsInRange } from "./google-calendar";
import {
  diffDateKeysInDays,
  getDateKeyInTimeZone,
  getTimePartsInTimeZone,
  getUtcRangeForDateKey,
  getWeekdayForDateKey,
  shiftDateKey,
} from "./timezone";
import { sendTelegramMessage } from "./telegram";
import { pushEventContext } from "./telegram-bot/undo";
import { markReminderSent } from "./notifier";
import { computeDaysOpen } from "./aging";
import { normalizeText } from "./text";
import {
  agendaPermiteAviso,
  dentroDoSilencio,
  horarioCobranca,
  horarioFechamento,
  horarioResumo,
  minutosDeHHMM,
  rotuloDaAgenda,
  secretariaAtiva,
} from "./secretaria-regras";
import { DEFAULT_REMINDER_MINUTES } from "./reminder";
import type { FlowTask } from "@/types/task";

/**
 * Monitoramento proativo da secretária — roda a cada minuto pelo cron.
 *
 * Quatro tipos de aviso:
 * 1. **Lembretes de proximidade** — 1 dia antes, 1 hora antes e 10 min antes.
 * 2. **Cobrança** (diária, 08:00) — delegações atrasadas, escalando com o atraso.
 * 3. **Resumo da manhã** (diário, 07:30) — o dia por agenda, com conflitos.
 * 4. **Fechamento do dia** (diário, 20:00) — pendências e o que vem amanhã.
 *
 * Estado em /app/data/.secretaria-notified.json (dedup por evento e por dia).
 */

const DATA_DIR = process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();
const STATE_FILE = path.join(DATA_DIR, ".secretaria-notified.json");

/** Degraus dos lembretes de proximidade, em minutos antes do evento. */
const DEGRAUS_PROXIMIDADE = [
  { minutos: 1440, rotulo: "Amanhã", emoji: "📅" },
  { minutos: 60, rotulo: "Em 1h", emoji: "⏰" },
  { minutos: 10, rotulo: "Em 10 min", emoji: "🔔" },
];

interface SecretariaState {
  /** Chaves de proximidade já enviadas: "id@startTime#minutos". */
  proximidade: string[];
  /** id do evento → maior degrau de cobrança já enviado (3, 7 ou 14). */
  escalonamento: Record<string, number>;
  /** Marcadores diários já enviados: "resumo" → "2026-10-28". */
  diarios: Record<string, string>;
}

function carregarEstado(): SecretariaState {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      proximidade: Array.isArray(data?.proximidade) ? data.proximidade : [],
      escalonamento: data?.escalonamento ?? {},
      diarios: data?.diarios ?? {},
    };
  } catch {
    return { proximidade: [], escalonamento: {}, diarios: {} };
  }
}

function salvarEstado(estado: SecretariaState): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(estado, null, 2), "utf-8");
  } catch (err) {
    console.error("[SECRETARIA] Falha ao salvar estado:", err);
  }
}

function horaLocal(date: Date, timeZone: string): number {
  const { hour, minute } = getTimePartsInTimeZone(date, timeZone);
  return hour * 60 + minute;
}

function formatarHora(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function formatarData(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  });
}

/** Eventos que ocupam horário (ignora dia inteiro, cancelado, recusado, concluído). */
function eventosComHorario(tasks: FlowTask[]): FlowTask[] {
  return tasks.filter(
    (t) =>
      !t.isAllDay &&
      !t.isCancelled &&
      !t.isComplete &&
      t.selfResponseStatus !== "declined" &&
      !!t.startTime &&
      !!t.endTime
  );
}

/** Detecta sobreposição de horário entre eventos. */
function conflitoEntre(a: FlowTask, b: FlowTask): boolean {
  const inicioA = new Date(a.startTime!).getTime();
  const fimA = new Date(a.endTime!).getTime();
  const inicioB = new Date(b.startTime!).getTime();
  const fimB = new Date(b.endTime!).getTime();
  return inicioA < fimB && fimA > inicioB;
}

/** Eventos que não bloqueiam o horário: tempo aberto/marcador (ex.: 08:30–22:30). */
const DURACAO_MAX_BLOQUEIO_MS = 4 * 60 * 60 * 1000;

function bloqueiaHorario(task: FlowTask): boolean {
  const duracao = new Date(task.endTime!).getTime() - new Date(task.startTime!).getTime();
  return duracao > 0 && duracao <= DURACAO_MAX_BLOQUEIO_MS;
}

function acharConflitos(tasks: FlowTask[]): { hora: string; titulos: string[] }[] {
  const bloqueantes = tasks.filter(bloqueiaHorario);

  // Union-find: junta eventos que se sobrepõem em grupos.
  const pai = bloqueantes.map((_, i) => i);
  const achar = (i: number): number => (pai[i] === i ? i : (pai[i] = achar(pai[i])));
  const juntar = (i: number, j: number) => {
    const a = achar(i);
    const b = achar(j);
    if (a !== b) pai[b] = a;
  };

  for (let i = 0; i < bloqueantes.length; i++) {
    for (let j = i + 1; j < bloqueantes.length; j++) {
      if (conflitoEntre(bloqueantes[i], bloqueantes[j])) juntar(i, j);
    }
  }

  const grupos = new Map<number, FlowTask[]>();
  bloqueantes.forEach((task, i) => {
    const raiz = achar(i);
    const lista = grupos.get(raiz) ?? [];
    lista.push(task);
    grupos.set(raiz, lista);
  });

  return Array.from(grupos.values())
    .filter((lista) => lista.length > 1)
    .map((lista) => {
      const maiscedo = lista.reduce((a, b) => (a.startTime! <= b.startTime! ? a : b));
      const titulos = Array.from(new Set(lista.map((t) => t.title)));
      return {
        hora: new Date(maiscedo.startTime!).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        titulos:
          titulos.length > 5 ? [...titulos.slice(0, 5), `+${titulos.length - 5} outras`] : titulos,
      };
    })
    .sort((a, b) => a.hora.localeCompare(b.hora));
}

/* ------------------------------------------------------------------ */
/* 1. Lembretes de proximidade                                          */
/* ------------------------------------------------------------------ */

async function enviarProximidade(
  tasks: FlowTask[],
  timeZone: string,
  agora: Date,
  estado: SecretariaState
): Promise<void> {
  const hojeKey = getDateKeyInTimeZone(agora, timeZone);

  const agoraMs = agora.getTime();
  const { hour, minute } = getTimePartsInTimeZone(agora, timeZone);
  const diaSemana = getWeekdayForDateKey(hojeKey);

  for (const task of eventosComHorario(tasks)) {
    const inicio = new Date(task.startTime!).getTime();
    const minutosFaltam = (inicio - agoraMs) / 60_000;

    for (const degrau of DEGRAUS_PROXIMIDADE) {
      // Janela de ±2 min: o cron roda a cada minuto e pode atrasar um pouco
      // (container ocupado, relógio do Google).
      if (Math.abs(minutosFaltam - degrau.minutos) > 2) continue;

      // O evento já tem lembrete próprio pelo menos tão cedo quanto este degrau?
      if (task.reminderMinutes !== null && task.reminderMinutes !== undefined) {
        if (task.reminderMinutes >= degrau.minutos) continue;
      }

      // A agenda avisa nessa hora?
      if (!agendaPermiteAviso(task.calendarName, hour, minute, diaSemana)) continue;

      const chave = `${task.id}@${task.startTime}#${degrau.minutos}`;
      if (estado.proximidade.includes(chave)) continue;
      estado.proximidade.push(chave);

      const quando =
        degrau.minutos === 1440
          ? `Amanhã ${formatarHora(task.startTime!, timeZone)}`
          : formatarHora(task.startTime!, timeZone);
      const agenda = task.calendarName ? ` • ${task.calendarName}` : "";
      const texto =
        `${degrau.emoji} <b>${degrau.rotulo}:</b> ${task.title}\n` +
        `Começa às ${quando}${agenda}\n` +
        `<i>#ev_${task.id}</i>`;

      await sendTelegramMessage(texto);
      console.log(`[SECRETARIA] Proximidade (${degrau.rotulo}): "${task.title}"`);

      // Contexto pro bot resolver "já fiz" sem o usuário colar o id.
      const chatIdNum = Number(process.env.TELEGRAM_CHAT_ID);
      if (Number.isFinite(chatIdNum) && task.startTime) {
        pushEventContext(chatIdNum, {
          eventId: task.id,
          calendarId: task.calendarId ?? "primary",
          title: task.title,
          startTime: task.startTime,
        });
      }

      // Se o degrau de 10 min disparou, o lembrete próprio do evento (5 min por
      // padrão) não deve sair em seguida — marca como já enviado.
      if (degrau.minutos === 10 && task.reminderMinutes !== null) {
        const minutosProprio = task.reminderMinutes ?? DEFAULT_REMINDER_MINUTES;
        markReminderSent(task, minutosProprio, hojeKey);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 2. Cobrança de delegações atrasadas                                   */
/* ------------------------------------------------------------------ */

interface Pendencia {
  task: FlowTask;
  diasAtraso: number;
  responsavel: string;
}

function agruparPorResponsavel(pendencias: Pendencia[]): Map<string, Pendencia[]> {
  const grupos = new Map<string, Pendencia[]>();
  for (const p of pendencias) {
    const chave = normalizeText(p.responsavel);
    const lista = grupos.get(chave) ?? [];
    lista.push(p);
    grupos.set(chave, lista);
  }
  return grupos;
}

async function enviarCobranca(
  accessToken: string,
  timeZone: string,
  hojeKey: string,
  estado: SecretariaState,
  dryRun = false
): Promise<string | null> {
  const inicio = shiftDateKey(hojeKey, -180);
  const fim = shiftDateKey(hojeKey, 60);
  const { startUtc } = getUtcRangeForDateKey(inicio, timeZone);
  const { endUtc } = getUtcRangeForDateKey(fim, timeZone);
  const tasks = await getEventsInRange(accessToken, startUtc, endUtc, timeZone);

  const pendencias: Pendencia[] = [];
  for (const task of tasks) {
    const responsavel = task.delegateTo?.name?.trim() || task.delegateTo?.email?.trim();
    if (!responsavel) continue;
    if (task.isComplete || task.isCancelled || task.selfResponseStatus === "declined") continue;
    // A migração noturna empurra as pendências pra hoje, então a data do
    // evento não serve pra medir atraso: o que importa é há quanto tempo a
    // tarefa está em aberto (openSince).
    const diasAtraso = computeDaysOpen(task, timeZone);
    if (diasAtraso < 3) continue; // cobrar só depois de 3 dias

    pendencias.push({ task, diasAtraso, responsavel });
  }

  if (pendencias.length === 0) return null;

  // Escalonamento: 3 dias → 7 dias → 14 dias. Cada degrau dispara uma vez.
  const degraus = pendencias.filter((p) => {
    const degrau = p.diasAtraso >= 14 ? 14 : p.diasAtraso >= 7 ? 7 : 3;
    const enviado = estado.escalonamento[p.task.id] ?? 0;
    if (degrau <= enviado) return false;
    estado.escalonamento[p.task.id] = degrau;
    return true;
  });

  if (degraus.length === 0) return null;

  const grupos = agruparPorResponsavel(degraus);
  const linhas: string[] = [];
  const maxDiasGeral = Math.max(...degraus.map((d) => d.diasAtraso));
  const emojiGeral = maxDiasGeral >= 14 ? "🚨" : maxDiasGeral >= 7 ? "⚠️" : "🔎";

  for (const [, itens] of grupos) {
    const pessoa = itens[0].responsavel;
    const maxDias = Math.max(...itens.map((i) => i.diasAtraso));
    const um = itens.length === 1;
    const emoji = maxDias >= 14 ? "🚨" : maxDias >= 7 ? "⚠️" : "🔎";
    const tom = maxDias >= 14
      ? um
        ? "parada há semanas"
        : "paradas há semanas"
      : maxDias >= 7
        ? um
          ? "parada há mais de uma semana"
          : "paradas há mais de uma semana"
        : um
          ? "atrasada"
          : "atrasadas";
    linhas.push(`<b>${pessoa}</b> — ${itens.length} ${itens.length === 1 ? "pendência" : "pendências"} ${tom}:`);
    for (const item of itens.sort((a, b) => b.diasAtraso - a.diasAtraso)) {
      linhas.push(`  • ${item.task.title} — ${item.diasAtraso}d em aberto`);
    }
    linhas.push("");
  }

  const total = degraus.length;
  const texto =
    `${emojiGeral} <b>Cobrança — ${total} ${total === 1 ? "pendência atrasada" : "pendências atrasadas"}</b>\n\n` +
    `${linhas.join("\n")}` +
    `<i>Fecha, reagenda ou cancela?</i>`;

  if (!dryRun) await sendTelegramMessage(texto);
  console.log(`[SECRETARIA] Cobrança: ${total} pendência(s) atrasada(s)`);
  return texto;
}

/* ------------------------------------------------------------------ */
/* 3. Resumo da manhã                                                   */
/* ------------------------------------------------------------------ */

async function enviarResumo(
  accessToken: string,
  timeZone: string,
  hojeKey: string,
  estado: SecretariaState,
  dryRun = false
): Promise<string | null> {
  const tasks = await getEventsForDateKey(accessToken, hojeKey, timeZone);
  const doDia = tasks.filter(
    (t) => !t.isCancelled && t.selfResponseStatus !== "declined"
  );
  const comHorario = eventosComHorario(doDia);
  const porAgenda = new Map<string, FlowTask[]>();
  for (const task of comHorario) {
    const rotulo = rotuloDaAgenda(task.calendarName);
    const lista = porAgenda.get(rotulo) ?? [];
    lista.push(task);
    porAgenda.set(rotulo, lista);
  }

  const partes: string[] = [];
  for (const [rotulo, lista] of porAgenda) {
    partes.push(`<b>${rotulo}</b>`);
    for (const task of lista.sort((a, b) => a.startTime!.localeCompare(b.startTime!))) {
      partes.push(`• ${formatarHora(task.startTime!, timeZone)} ${task.title}`);
    }
    partes.push("");
  }

  const conflitos = acharConflitos(comHorario);
  for (const conflito of conflitos) {
    partes.push(`⚠️ <b>Conflito às ${conflito.hora}:</b> ${conflito.titulos.join(" e ")}`);
    partes.push("");
  }

  const texto =
    `☀️ <b>Bom dia! ${formatarData(`${hojeKey}T12:00:00Z`, timeZone)} — ` +
    `${comHorario.length} ${comHorario.length === 1 ? "compromisso" : "compromissos"}</b>\n\n` +
    (partes.length ? `${partes.join("\n")}` : "Sem compromissos hoje.\n");

  if (!dryRun) await sendTelegramMessage(texto.trim());
  console.log("[SECRETARIA] Resumo da manhã enviado");
  return texto.trim();
}

/* ------------------------------------------------------------------ */
/* 4. Fechamento do dia                                                 */
/* ------------------------------------------------------------------ */

async function enviarFechamento(
  accessToken: string,
  timeZone: string,
  hojeKey: string,
  estado: SecretariaState,
  dryRun = false
): Promise<string | null> {
  const [hoje, amanha] = await Promise.all([
    getEventsForDateKey(accessToken, hojeKey, timeZone),
    getEventsForDateKey(accessToken, shiftDateKey(hojeKey, 1), timeZone),
  ]);

  const concluidos = hoje.filter((t) => t.isComplete).length;
  const pendentes = hoje.filter(
    (t) => !t.isComplete && !t.isCancelled && t.selfResponseStatus !== "declined" && t.startTime
  );
  const deAmanha = eventosComHorario(amanha);
  const conflitosAmanha = acharConflitos(deAmanha);

  const linhas: string[] = [];
  linhas.push(`✅ ${concluidos} concluído(s)`);
  if (pendentes.length) {
    linhas.push(`⏳ ${pendentes.length} pendente(s):`);
    for (const task of pendentes.slice(0, 10)) {
      linhas.push(`  • ${task.title} (${formatarHora(task.startTime!, timeZone)})`);
    }
  } else {
    linhas.push("⏳ Nada pendente.");
  }
  linhas.push(`📅 Amanhã: ${deAmanha.length} compromisso(s)`);
  for (const conflito of conflitosAmanha) {
    linhas.push(`⚠️ Conflito às ${conflito.hora}: ${conflito.titulos.join(" e ")}`);
  }

  const texto = `🌙 <b>Fechamento de ${formatarData(`${hojeKey}T12:00:00Z`, timeZone)}</b>\n\n${linhas.join("\n")}`;

  if (!dryRun) await sendTelegramMessage(texto);
  console.log("[SECRETARIA] Fechamento do dia enviado");
  return texto;
}

/* ------------------------------------------------------------------ */
/* Entrada principal — chamada pelo cron a cada minuto                 */
/* ------------------------------------------------------------------ */

export async function sendSecretariaReminders(
  accessToken: string,
  timeZone: string,
  /** Eventos de hoje + amanhã já buscados (evita segunda ida à API do Google). */
  preloadedTasks?: FlowTask[]
): Promise<void> {
  if (!secretariaAtiva()) return;

  const agora = new Date();
  const hojeKey = getDateKeyInTimeZone(agora, timeZone);
  const { hour, minute } = getTimePartsInTimeZone(agora, timeZone);
  const minutoAgora = horaLocal(agora, timeZone);

  // Silêncio: nada sai fora da janela permitida.
  if (dentroDoSilencio(hour, minute)) return;

  const estado = carregarEstado();
  let mudou = false;

  // Mensagens diárias — cada uma uma vez por dia, no horário dela.
  const diarios: { chave: string; hora: string; rodar: () => Promise<string | null> }[] = [
    {
      chave: "resumo",
      hora: horarioResumo(),
      rodar: () => enviarResumo(accessToken, timeZone, hojeKey, estado),
    },
    {
      chave: "cobranca",
      hora: horarioCobranca(),
      rodar: () => enviarCobranca(accessToken, timeZone, hojeKey, estado),
    },
    {
      chave: "fechamento",
      hora: horarioFechamento(),
      rodar: () => enviarFechamento(accessToken, timeZone, hojeKey, estado),
    },
  ];

  for (const diario of diarios) {
    if (estado.diarios[diario.chave] === hojeKey) continue;
    if (minutoAgora !== minutosDeHHMM(diario.hora)) continue;
    try {
      await diario.rodar();
      estado.diarios[diario.chave] = hojeKey;
      mudou = true;
    } catch (err) {
      console.error(`[SECRETARIA] Erro no ${diario.chave}:`, err);
    }
  }

  // Lembretes de proximidade — a cada minuto.
  try {
    const antes = estado.proximidade.length;
    const candidatos =
      preloadedTasks ??
      [
        ...(await getEventsForDateKey(accessToken, hojeKey, timeZone)),
        ...(await getEventsForDateKey(accessToken, shiftDateKey(hojeKey, 1), timeZone)),
      ];
    await enviarProximidade(candidatos, timeZone, agora, estado);
    if (estado.proximidade.length !== antes) mudou = true;
  } catch (err) {
    console.error("[SECRETARIA] Erro nos lembretes de proximidade:", err);
  }

  if (mudou) {
    // Limpa chaves antigas (mais de 3 dias) pra não crescer sem parar.
    estado.proximidade = estado.proximidade.slice(-500);
    salvarEstado(estado);
  }
}

/**
 * Dispara só os lembretes de proximidade, sem os guardas de silêncio/config —
 * usado pela rota de disparo manual (pra testar mesmo sem Telegram configurado).
 */
export async function dispararLembretesDeProximidade(
  accessToken: string,
  timeZone: string
): Promise<void> {
  const agora = new Date();
  const hojeKey = getDateKeyInTimeZone(agora, timeZone);
  const estado = carregarEstado();
  const candidatos = [
    ...(await getEventsForDateKey(accessToken, hojeKey, timeZone)),
    ...(await getEventsForDateKey(accessToken, shiftDateKey(hojeKey, 1), timeZone)),
  ];
  await enviarProximidade(candidatos, timeZone, agora, estado);
  salvarEstado(estado);
}

/** Teste/manual: força o envio de uma mensagem diária (usado no debug). */
export async function rodarMensagemDiaria(
  accessToken: string,
  timeZone: string,
  qual: "resumo" | "cobranca" | "fechamento",
  dryRun = false
): Promise<string | null> {
  const hojeKey = getDateKeyInTimeZone(new Date(), timeZone);
  const estado = carregarEstado();
  let texto: string | null = null;
  if (qual === "resumo") texto = await enviarResumo(accessToken, timeZone, hojeKey, estado, dryRun);
  else if (qual === "cobranca") texto = await enviarCobranca(accessToken, timeZone, hojeKey, estado, dryRun);
  else texto = await enviarFechamento(accessToken, timeZone, hojeKey, estado, dryRun);
  salvarEstado(estado);
  return texto;
}
