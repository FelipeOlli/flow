import { getEventFromAnyCalendar, getEventsInRange, listReadableCalendars, listWritableCalendars, createEvent, updateEvent, markEventComplete, setEventDelegate, setEventCategory, setEventPillar } from "@/lib/google-calendar";
import {
  DEFAULT_LIMIT,
  MAX_RANGE_DAYS,
  filterEvents,
  findByResponsavel,
  findOpenTasks,
  findUpcoming,
  isDateKeyParam,
  paginate,
  parseStatusParam,
  toSecretariaEvent,
} from "@/lib/secretaria";
import {
  diffDateKeysInDays,
  getDateKeyInTimeZone,
  getTimePartsInTimeZone,
  getUtcRangeForDateKey,
  shiftDateKey,
  zonedDateTimeToUtc,
} from "@/lib/timezone";
import { HttpError } from "@/lib/secretaria-route";
import { getValidAccessToken } from "@/lib/token-store";
import { normalizeText } from "@/lib/text";
import type {
  AgendaSecretaria,
  CategoriaEvento,
  Escopo,
  EventoSecretaria,
  ParamsAtualizarEvento,
  ParamsCriarEvento,
  ParamsListarEmAberto,
  ParamsListarEventos,
  ParamsListarPorResponsavel,
  ParamsListarProximos,
  Pagina,
  PilarEvento,
  SecretariaBackend,
} from "@/lib/secretaria-backend";

/**
 * Lógica de consulta da secretária.
 *
 * Fica fora das rotas de propósito: as rotas HTTP e o MCP do app chamam as
 * mesmas funções, então a resposta é idêntica nos dois caminhos e não existe
 * uma segunda cópia da regra de negócio.
 */

export interface SecretariaCtx {
  accessToken: string;
  timeZone: string;
}

/** Lista as agendas visíveis pelo token (inclui compartilhadas só-leitura). */
export async function listarAgendas(ctx: SecretariaCtx): Promise<{ agendas: AgendaSecretaria[] }> {
  const agendas = await listReadableCalendars(ctx.accessToken);
  return {
    agendas: agendas.map((a) => ({
      id: a.id,
      nome: a.name,
      cor: a.bgColor ?? null,
    })),
  };
}

/**
 * Eventos por período, agenda e status.
 * Sem `de`/`ate`, cobre de 7 dias atrás a 60 dias à frente.
 */
export async function listarEventos(
  ctx: SecretariaCtx,
  params: ParamsListarEventos
): Promise<Pagina<EventoSecretaria>> {
  const { de, ate } = params;
  if (de && !isDateKeyParam(de)) throw new HttpError(400, "`de` deve ser YYYY-MM-DD");
  if (ate && !isDateKeyParam(ate)) throw new HttpError(400, "`ate` deve ser YYYY-MM-DD");

  const agenda = params.agenda?.trim() || undefined;
  const status = parseStatusParam(params.status ?? null) ?? undefined;

  const todayKey = getDateKeyInTimeZone(new Date(), ctx.timeZone);
  const fromKey = de ?? shiftDateKey(todayKey, -7);
  const toKey = ate ?? shiftDateKey(todayKey, 60);
  if (fromKey > toKey) throw new HttpError(400, "`de` não pode ser depois de `ate`");

  // Janela máxima: acima disso o Google vira a consulta em várias páginas
  // e a resposta demora demais.
  const dias = diffDateKeysInDays(fromKey, toKey);
  if (dias > MAX_RANGE_DAYS) {
    throw new HttpError(
      400,
      `Janela máxima de ${MAX_RANGE_DAYS} dias (pedido: ${dias}). Faça várias consultas.`
    );
  }

  const { startUtc } = getUtcRangeForDateKey(fromKey, ctx.timeZone);
  const endUtc = getUtcRangeForDateKey(toKey, ctx.timeZone).endUtc;

  const tasks = await getEventsInRange(ctx.accessToken, startUtc, endUtc, ctx.timeZone);
  const filtered = filterEvents(tasks, {
    agenda,
    de: fromKey,
    ate: toKey,
    status,
    incluirFeriados: params.incluirFeriados,
    timeZone: ctx.timeZone,
  });

  const sorted = [...filtered].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const { dados, paginacao } = paginate(
    sorted.map((t) => toSecretariaEvent(t, ctx.timeZone)),
    params.limite ?? DEFAULT_LIMIT,
    params.offset ?? 0
  );

  return { dados, paginacao };
}

/** Eventos que começam dentro da janela informada. */
export async function listarProximos(
  ctx: SecretariaCtx,
  params: ParamsListarProximos
): Promise<Pagina<EventoSecretaria>> {
  const minutos = Math.min(params.minutos, 60 * 24 * 7);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    throw new HttpError(400, "`minutos` deve ser um número positivo");
  }

  const now = new Date();
  // Busca desde 1h atrás pra não perder evento que começa na borda da janela.
  const searchStart = new Date(now.getTime() - 60 * 60_000);
  const searchEnd = new Date(now.getTime() + minutos * 60_000);

  const tasks = await getEventsInRange(ctx.accessToken, searchStart, searchEnd, ctx.timeZone);
  const upcoming = findUpcoming(
    tasks,
    now.getTime(),
    minutos,
    ctx.timeZone,
    params.incluirFeriados
  );

  const { dados, paginacao } = paginate(
    upcoming.map((t) => toSecretariaEvent(t, ctx.timeZone)),
    params.limite ?? DEFAULT_LIMIT,
    params.offset ?? 0
  );

  return { dados, paginacao };
}

/** Eventos em aberto: vencidos (início já passou) ou parados há X dias. */
export async function listarEmAberto(
  ctx: SecretariaCtx,
  params: ParamsListarEmAberto
): Promise<Pagina<EventoSecretaria>> {
  if (!Number.isFinite(params.diasParado) || params.diasParado < 0) {
    throw new HttpError(400, "`dias_parado` deve ser um número >= 0");
  }
  const diasParado = Math.floor(params.diasParado);

  // Janela ampla: atrasos antigos ainda importam para a cobrança.
  const todayKey = getDateKeyInTimeZone(new Date(), ctx.timeZone);
  const fromKey = shiftDateKey(todayKey, -180);
  const toKey = shiftDateKey(todayKey, 60);
  const { startUtc } = getUtcRangeForDateKey(fromKey, ctx.timeZone);
  const { endUtc } = getUtcRangeForDateKey(toKey, ctx.timeZone);

  const tasks = await getEventsInRange(ctx.accessToken, startUtc, endUtc, ctx.timeZone);
  const abertos = findOpenTasks(
    tasks,
    Date.now(),
    diasParado,
    ctx.timeZone,
    params.incluirFeriados
  );

  const { dados, paginacao } = paginate(
    abertos.map((t) => toSecretariaEvent(t, ctx.timeZone)),
    params.limite ?? DEFAULT_LIMIT,
    params.offset ?? 0
  );

  return { dados, paginacao };
}

/** Eventos delegados a uma pessoa (campo de delegação). */
export async function listarPorResponsavel(
  ctx: SecretariaCtx,
  params: ParamsListarPorResponsavel
): Promise<Pagina<EventoSecretaria>> {
  const pessoa = params.pessoa?.trim();
  if (!pessoa) throw new HttpError(400, "`pessoa` é obrigatório");

  const todayKey = getDateKeyInTimeZone(new Date(), ctx.timeZone);
  const { startUtc } = getUtcRangeForDateKey(shiftDateKey(todayKey, -180), ctx.timeZone);
  const { endUtc } = getUtcRangeForDateKey(shiftDateKey(todayKey, 60), ctx.timeZone);

  const tasks = await getEventsInRange(ctx.accessToken, startUtc, endUtc, ctx.timeZone);
  const encontrados = findByResponsavel(tasks, pessoa, params.incluirFeriados);

  const { dados, paginacao } = paginate(
    encontrados.map((t) => toSecretariaEvent(t, ctx.timeZone)),
    params.limite ?? DEFAULT_LIMIT,
    params.offset ?? 0
  );

  return { dados, paginacao };
}

/** Detalhe de um evento (procura em todas as agendas visíveis pelo token). */
export async function listarEventoPorId(
  ctx: SecretariaCtx,
  params: { id: string }
): Promise<{ evento: EventoSecretaria }> {
  const task = await getEventFromAnyCalendar(ctx.accessToken, params.id);
  if (!task) throw new HttpError(404, "Evento não encontrado");
  return { evento: toSecretariaEvent(task, ctx.timeZone) };
}

/**
 * Backend que consulta a agenda **dentro do processo do app**, sem passar por
 * rede. É o que a rota `/mcp` usa — no container, `localhost:3000` nem sempre
 * é alcançável (IPv6, porta trocada pelo proxy), e um hop interno não traz
 * nenhum ganho: o token do Google já está aqui.
 *
 * O token do Google é lido a cada chamada, porque `getValidAccessToken()`
 * renova quando ele expira.
 */
export function criarBackendDireto(): SecretariaBackend {
  async function ctx(): Promise<SecretariaCtx> {
    const accessToken = await getValidAccessToken();
    if (!accessToken) throw new HttpError(503, "Google Calendar não conectado");
    return {
      accessToken,
      timeZone: process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo",
    };
  }

  return {
    listarAgendas: async () => listarAgendas(await ctx()),
    listarEventos: async (params) => listarEventos(await ctx(), params),
    listarProximos: async (params) => listarProximos(await ctx(), params),
    listarEmAberto: async (params) => listarEmAberto(await ctx(), params),
    listarPorResponsavel: async (params) => listarPorResponsavel(await ctx(), params),
    listarEventoPorId: async (params) => listarEventoPorId(await ctx(), params),
    criarEvento: async (params) => criarEvento(await ctx(), params),
    atualizarEvento: async (params) => atualizarEvento(await ctx(), params),
  };
}

// ────────────────────────────── Escrita (Fase 4) ──────────────────────────────

/** "09:30" → { hora: 9, minuto: 30 }. */
function parseHora(hora: string): { hora: number; minuto: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!match) throw new HttpError(400, `Hora inválida: "${hora}". Use HH:MM.`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new HttpError(400, `Hora inválida: "${hora}". Use HH:MM.`);
  return { hora: h, minuto: m };
}

/**
 * Aceita o payload em camelCase ou snake_case.
 *
 * As ferramentas do MCP falam snake_case (é o que o modelo preenche) e a API
 * HTTP fala camelCase. Sem normalizar, um campo em snake_case seria ignorado
 * silenciosamente — o pior tipo de bug numa escrita.
 */
function normalizarEntrada<T extends object>(body: unknown): T {
  if (!body || typeof body !== "object") return {} as T;
  const bruto = body as Record<string, unknown>;
  const aliases: Record<string, string> = {
    hora_inicio: "horaInicio",
    hora_fim: "horaFim",
    duracao_minutos: "duracaoMinutos",
    lembrete_minutos: "lembreteMinutos",
    recorrencia: "recorrencia",
  };
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    saida[aliases[chave] ?? chave] = valor;
  }
  return saida as T;
}

/**
 * Monta o par início/fim do evento.
 *
 * Sem `horaInicio`, é um evento de dia inteiro: o Google espera o fim
 * **exclusivo** (o dia seguinte).
 */
function montarHorarios(
  data: string,
  horaInicio: string | undefined,
  horaFim: string | undefined,
  duracaoMinutos: number | undefined,
  timeZone: string
): { startTime: string; endTime: string } {
  if (!horaInicio) {
    return { startTime: data, endTime: shiftDateKey(data, 1) };
  }

  const inicio = parseHora(horaInicio);
  const start = zonedDateTimeToUtc(data, timeZone, inicio.hora, inicio.minuto, 0, 0);

  let end: Date;
  if (horaFim) {
    const fim = parseHora(horaFim);
    end = zonedDateTimeToUtc(data, timeZone, fim.hora, fim.minuto, 0, 0);
    // Terminou antes de começar → virou o dia.
    if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60_000);
  } else {
    const duracao = duracaoMinutos && duracaoMinutos > 0 ? duracaoMinutos : 60;
    end = new Date(start.getTime() + duracao * 60_000);
  }

  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/** Resolve o nome da agenda (parcial, sem acento) no id gravável. */
async function resolverAgendaGravavel(accessToken: string, agenda?: string): Promise<string> {
  const alvo = agenda?.trim();
  if (!alvo) return "primary";

  const agendas = await listWritableCalendars(accessToken);
  const achada =
    agendas.find((a) => a.id === alvo) ??
    agendas.find((a) => normalizeText(a.name) === normalizeText(alvo)) ??
    agendas.find((a) => normalizeText(a.name).includes(normalizeText(alvo)));

  if (!achada) {
    throw new HttpError(
      400,
      `Agenda "${alvo}" não encontrada ou sem permissão de escrita. Use listar_agendas para ver as agendas.`
    );
  }
  return achada.id;
}

function mapaPilar(pilar?: PilarEvento) {
  return pilar;
}

function mapaCategoria(categoria?: CategoriaEvento): "operational" | "strategic" | undefined {
  if (categoria === "operacional") return "operational";
  if (categoria === "estrategico") return "strategic";
  return undefined;
}

/** "esta" | "seguintes" | "todas" → escopo do app. */
function mapaEscopo(escopo?: Escopo): "this" | "thisAndFollowing" | "all" {
  if (escopo === "seguintes") return "thisAndFollowing";
  if (escopo === "todas") return "all";
  return "this";
}

/** Cria um evento no Flow. */
export async function criarEvento(
  ctx: SecretariaCtx,
  entrada: ParamsCriarEvento
): Promise<{ evento: EventoSecretaria }> {
  const input = normalizarEntrada<ParamsCriarEvento>(entrada);
  const titulo = input.titulo?.trim();
  if (!titulo) throw new HttpError(400, "`titulo` é obrigatório");
  if (!isDateKeyParam(input.data)) throw new HttpError(400, "`data` deve ser YYYY-MM-DD");

  const calendarId = await resolverAgendaGravavel(ctx.accessToken, input.agenda);
  const { startTime, endTime } = montarHorarios(
    input.data,
    input.horaInicio,
    input.horaFim,
    input.duracaoMinutos,
    ctx.timeZone
  );

  const task = await createEvent(
    ctx.accessToken,
    {
      title: titulo,
      startTime,
      endTime,
      description: input.descricao,
      calendarId,
      // 0 = sem lembrete; undefined = default do Flow (5 min).
      reminderMinutes: input.lembreteMinutos === 0 ? null : input.lembreteMinutos,
      pillar: mapaPilar(input.pilar),
      category: mapaCategoria(input.categoria),
      delegateTo: input.responsavel?.trim() ? { name: input.responsavel.trim() } : undefined,
      attendees: input.convidados,
      recurrence: input.recorrencia,
    },
    ctx.timeZone
  );

  return { evento: toSecretariaEvent(task, ctx.timeZone) };
}

/** Atualiza um evento existente (ou marca como concluído). */
export async function atualizarEvento(
  ctx: SecretariaCtx,
  entrada: ParamsAtualizarEvento
): Promise<{ evento: EventoSecretaria }> {
  const input = normalizarEntrada<ParamsAtualizarEvento>(entrada);
  const id = input.id?.trim();
  if (!id) throw new HttpError(400, "`id` é obrigatório");

  const existente = await getEventFromAnyCalendar(ctx.accessToken, id);
  if (!existente) throw new HttpError(404, "Evento não encontrado");
  const calendarId = existente.calendarId ?? "primary";
  const escopo = mapaEscopo(input.escopo);

  const updates: Parameters<typeof updateEvent>[2] = {};
  if (input.titulo !== undefined) updates.title = input.titulo;
  if (input.descricao !== undefined) updates.description = input.descricao;
  if (input.lembreteMinutos !== undefined) {
    updates.reminderMinutes = input.lembreteMinutos === 0 ? null : input.lembreteMinutos;
  }

  // Remoção do responsável: string vazia apaga a delegação (tratado no
  // setEventDelegate, mais abaixo — o updateEvent não cobre esse campo).

  // Data/hora: sem hora informada, mantém a hora original do evento.
  if (input.data || input.horaInicio || input.horaFim) {
    const inicioOriginal = new Date(existente.startTime);
    const dataOriginal = getDateKeyInTimeZone(inicioOriginal, ctx.timeZone);
    const horaOriginal = getTimePartsInTimeZone(inicioOriginal, ctx.timeZone);
    const data = input.data ?? dataOriginal;
    const hora =
      input.horaInicio ??
      `${String(horaOriginal.hour).padStart(2, "0")}:${String(horaOriginal.minute).padStart(2, "0")}`;

    const { startTime, endTime } = montarHorarios(data, hora, input.horaFim, undefined, ctx.timeZone);
    updates.startTime = startTime;
    updates.endTime = endTime;
  }

  let task = existente;
  const temCamposGerais =
    updates.title !== undefined ||
    updates.description !== undefined ||
    updates.startTime !== undefined ||
    updates.reminderMinutes !== undefined;

  if (temCamposGerais) {
    task = await updateEvent(ctx.accessToken, id, updates, ctx.timeZone, calendarId, escopo);
  }

  // Marcadores que o updateEvent não cobre — cada um é uma operação própria.
  if (input.pilar !== undefined) {
    task = await setEventPillar(ctx.accessToken, task.id, calendarId, input.pilar, escopo === "all" ? "all" : "this");
  }
  if (input.categoria !== undefined) {
    task = await setEventCategory(
      ctx.accessToken,
      task.id,
      calendarId,
      mapaCategoria(input.categoria) ?? null,
      escopo === "all" ? "all" : "this"
    );
  }
  if (input.responsavel !== undefined) {
    const nome = input.responsavel.trim();
    task = await setEventDelegate(
      ctx.accessToken,
      task.id,
      calendarId,
      nome ? { name: nome } : null,
      escopo === "all" ? "all" : "this"
    );
  }

  // Concluir por último: assim marcar como concluído não descarta as outras
  // alterações pedidas na mesma chamada.
  if (input.acao === "concluir") {
    task = await markEventComplete(ctx.accessToken, task.id, calendarId, escopo);
  }

  return { evento: toSecretariaEvent(task, ctx.timeZone) };
}
