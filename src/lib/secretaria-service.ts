import { getEventFromAnyCalendar, getEventsInRange, listReadableCalendars } from "@/lib/google-calendar";
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
  getUtcRangeForDateKey,
  shiftDateKey,
} from "@/lib/timezone";
import { HttpError } from "@/lib/secretaria-route";
import { getValidAccessToken } from "@/lib/token-store";
import type {
  AgendaSecretaria,
  EventoSecretaria,
  ParamsListarEmAberto,
  ParamsListarEventos,
  ParamsListarPorResponsavel,
  ParamsListarProximos,
  Pagina,
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
  };
}
