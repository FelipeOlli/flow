import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  AgendaSecretaria,
  EventoSecretaria,
  ParamsListarEmAberto,
  ParamsListarEventos,
  ParamsListarPorResponsavel,
  ParamsListarProximos,
  Pagina,
  SecretariaBackend,
} from "./secretaria-backend";

/**
 * Ferramentas MCP da secretária do Flow.
 *
 * Fica fora de `src/components` e sem import de "@/..." de propósito: o mesmo
 * arquivo é usado pela rota HTTP do app (`/mcp`) e pelo servidor stdio que roda
 * no Claude Code/Desktop (`mcp/server.ts`), que roda o TypeScript direto pelo
 * Node (sem webpack, sem alias).
 *
 * O MCP nunca fala com o Google Calendar: ele lê a agenda por um *backend*,
 * que pode ser a API REST (servidor stdio, que roda fora do app) ou a lógica
 * da secretária dentro do próprio processo (rota `/mcp` do app).
 */

const BASE_URL = (process.env.FLOW_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_TOKEN = process.env.FLOW_API_TOKEN ?? "";

/** Tempo máximo de espera por uma chamada à API do Flow. */
const TIMEOUT_API_MS = 30_000;

export class FlowApiError extends Error {
  // Sem parameter property: o Node roda TS em modo strip-only, que não aceita essa sintaxe.
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  caminho: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  if (!API_TOKEN) {
    throw new FlowApiError(
      500,
      "FLOW_API_TOKEN não definido. Configure a variável de ambiente antes de rodar o servidor MCP."
    );
  }

  const url = new URL(`${BASE_URL}${caminho}`);
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") url.searchParams.set(chave, String(valor));
  }

  // Sem timeout, uma consulta lenta ao Google segura a conexão até o cliente
  // desistir — e o erro chega como "fetch failed", sem dizer o que houve.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_API_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      signal: controller.signal,
    });
  } catch (e) {
    const mensagem =
      e instanceof Error && e.name === "AbortError"
        ? `A API do Flow demorou mais de ${TIMEOUT_API_MS / 1000}s para responder. Tente uma janela menor.`
        : `Não foi possível alcançar a API do Flow (${BASE_URL}): ${e instanceof Error ? e.message : String(e)}`;
    throw new FlowApiError(504, mensagem);
  } finally {
    clearTimeout(timer);
  }

  const texto = await res.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    throw new FlowApiError(
      res.status,
      `Resposta não-JSON da API (${res.status}): ${texto.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const erro = (corpo as { erro?: string } | null)?.erro ?? `HTTP ${res.status}`;
    throw new FlowApiError(res.status, erro);
  }
  return corpo as T;
}

function paginas<T>(dados: T[], paginacao: { total: number; limite: number; offset: number }): Pagina<T> {
  return { dados, paginacao };
}

/**
 * Backend que fala com a API REST do Flow.
 *
 * É o padrão porque o servidor stdio roda **fora** do app — ele só conhece a
 * API, e o token do Google nunca sai do servidor.
 */
export function criarBackendHttp(): SecretariaBackend {
  return {
    listarAgendas: async () => {
      const { agendas } = await request<{ agendas: AgendaSecretaria[] }>("/api/secretaria/agendas");
      return { agendas };
    },

    listarEventos: async (params: ParamsListarEventos) => {
      const pagina = await request<Pagina<EventoSecretaria>>("/api/secretaria/eventos", {
        de: params.de,
        ate: params.ate,
        agenda: params.agenda,
        status: params.status,
        limite: params.limite,
        offset: params.offset,
        incluir_feriados: params.incluirFeriados ? "true" : undefined,
      });
      return paginas(pagina.dados, pagina.paginacao);
    },

    listarProximos: async (params: ParamsListarProximos) => {
      const pagina = await request<Pagina<EventoSecretaria>>("/api/secretaria/eventos/proximos", {
        minutos: params.minutos,
        limite: params.limite,
        offset: params.offset,
        incluir_feriados: params.incluirFeriados ? "true" : undefined,
      });
      return paginas(pagina.dados, pagina.paginacao);
    },

    listarEmAberto: async (params: ParamsListarEmAberto) => {
      const pagina = await request<Pagina<EventoSecretaria>>("/api/secretaria/eventos/em-aberto", {
        dias_parado: params.diasParado,
        limite: params.limite,
        offset: params.offset,
        incluir_feriados: params.incluirFeriados ? "true" : undefined,
      });
      return paginas(pagina.dados, pagina.paginacao);
    },

    listarPorResponsavel: async (params: ParamsListarPorResponsavel) => {
      const pagina = await request<Pagina<EventoSecretaria>>(
        "/api/secretaria/eventos/por-responsavel",
        {
          pessoa: params.pessoa,
          limite: params.limite,
          offset: params.offset,
          incluir_feriados: params.incluirFeriados ? "true" : undefined,
        }
      );
      return paginas(pagina.dados, pagina.paginacao);
    },

    listarEventoPorId: async (params: { id: string }) =>
      request<{ evento: EventoSecretaria }>(`/api/secretaria/eventos/${encodeURIComponent(params.id)}`),
  };
}

/** Texto curto de um evento, pro Claude ler sem parsear JSON. */
function formatarEvento(evento: EventoSecretaria): string {
  const quando = evento.dia_inteiro
    ? "dia inteiro"
    : `${evento.inicio.slice(11, 16)}–${evento.fim.slice(11, 16)}`;
  const partes = [`${quando}  ${evento.titulo}`];
  partes.push(`[${evento.agenda}]`);
  if (evento.status !== "aberto") partes.push(`(${evento.status})`);
  if (evento.responsavel) partes.push(`→ ${evento.responsavel}`);
  if (evento.dias_em_aberto > 0) partes.push(`(${evento.dias_em_aberto}d em aberto)`);
  if (evento.local) partes.push(`| ${evento.local}`);
  return partes.join(" ");
}

function formatarLista(eventos: EventoSecretaria[], total: number): string {
  if (eventos.length === 0) return "Nenhum evento encontrado.";
  const linhas = eventos.map((e) => `• ${formatarEvento(e)}`);
  if (total > eventos.length) {
    linhas.push(`(mostrando ${eventos.length} de ${total} — use limite/offset para o resto)`);
  }
  return linhas.join("\n");
}

/** Resposta padrão das ferramentas: texto formatado + JSON bruto. */
function resposta(dados: unknown, texto: string) {
  return {
    content: [
      { type: "text" as const, text: texto },
      { type: "text" as const, text: JSON.stringify(dados, null, 2) },
    ],
  };
}

function erro(e: unknown) {
  // Erros com `status` (FlowApiError, HttpError) carregam o código da API.
  const status =
    typeof e === "object" && e !== null && "status" in e
      ? Number((e as { status: unknown }).status)
      : undefined;
  const mensagem =
    status !== undefined && Number.isFinite(status)
      ? `Erro da API do Flow (${status}): ${e instanceof Error ? e.message : String(e)}`
      : `Erro ao consultar a API do Flow: ${e instanceof Error ? e.message : String(e)}`;
  return { content: [{ type: "text" as const, text: mensagem }], isError: true };
}

/**
 * Cria o servidor MCP com todas as ferramentas da secretária.
 *
 * `backend` é onde os dados vêm. Sem ele, usa a API REST (servidor stdio).
 */
export function criarServidorSecretaria(backend?: SecretariaBackend): McpServer {
  const dados = backend ?? criarBackendHttp();

  const server = new McpServer({
    name: "flow-secretaria",
    version: "1.0.0",
  });

  server.registerTool(
    "listar_eventos",
    {
      title: "Listar eventos da agenda",
      description:
        "Lista eventos do Flow (calendário do Felipe) por período, agenda e status. Use para perguntas como " +
        '"o que tenho hoje", "o que tem na agenda da Infotec/CF/DevPoint essa semana", "quais reuniões tenho ' +
        'amanhã". Sem `de`/`ate`, cobre de 7 dias atrás a 60 dias à frente. Feriados são omitidos por padrão.',
      inputSchema: {
        de: z.string().optional().describe("Data inicial (YYYY-MM-DD)."),
        ate: z.string().optional().describe("Data final (YYYY-MM-DD)."),
        agenda: z.string().optional().describe("Nome ou id da agenda (ex.: \"DevPoint\", \"TI CF Contabilidade\")."),
        status: z
          .enum(["aberto", "concluido", "cancelado", "recusado"])
          .optional()
          .describe('Filtra por status. "aberto" = ainda não concluído.'),
        limite: z.number().int().min(1).max(500).optional().describe("Máximo de itens (padrão 100)."),
        offset: z.number().int().min(0).optional().describe("Ponto de partida da paginação."),
      },
    },
    async ({ de, ate, agenda, status, limite, offset }) => {
      try {
        const pagina = await dados.listarEventos({ de, ate, agenda, status, limite, offset });
        return resposta(pagina, formatarLista(pagina.dados, pagina.paginacao.total));
      } catch (e) {
        return erro(e);
      }
    }
  );

  server.registerTool(
    "eventos_proximos",
    {
      title: "Eventos que começam em breve",
      description:
        "Retorna os eventos que começam dentro da próxima janela, em ordem cronológica. Use para \"o que vem " +
        'a seguir", "tenho reunião agora", "qual é a próxima compromisso". Não devolve eventos já concluídos, ' +
        "cancelados ou recusados.",
      inputSchema: {
        minutos: z
          .number()
          .int()
          .min(1)
          .max(10080)
          .optional()
          .describe("Janela em minutos a partir de agora (padrão 120)."),
      },
    },
    async ({ minutos }) => {
      try {
        const pagina = await dados.listarProximos({ minutos: minutos ?? 120 });
        return resposta(pagina, formatarLista(pagina.dados, pagina.paginacao.total));
      } catch (e) {
        return erro(e);
      }
    }
  );

  server.registerTool(
    "eventos_em_aberto",
    {
      title: "Pendências (eventos em aberto)",
      description:
        'Retorna o que está em aberto: eventos vencidos (o horário já passou) ou parados há X dias. Use para ' +
        '"o que está em aberto", "o que está atrasado", "o que ficou pendente". É a fonte para cobrar a equipe — ' +
        "eventos com campo `responsavel` foram delegadas a alguém. Ordenado pelo mais antigo primeiro.",
      inputSchema: {
        dias_parado: z
          .number()
          .int()
          .min(0)
          .max(365)
          .optional()
          .describe("Há quantos dias a pendência está parada (padrão 7). 0 = só vencidos."),
      },
    },
    async ({ dias_parado }) => {
      try {
        const pagina = await dados.listarEmAberto({ diasParado: dias_parado ?? 7 });
        return resposta(pagina, formatarLista(pagina.dados, pagina.paginacao.total));
      } catch (e) {
        return erro(e);
      }
    }
  );

  server.registerTool(
    "eventos_por_responsavel",
    {
      title: "Eventos por responsável (delegação)",
      description:
        'Retorna os eventos delegado a uma pessoa. Use para "o que o André tem", "quais tarefas são do ' +
        'Gabriel", "o que está com a Yasmim". Aceita nome parcial, sem acento e sem diferenciar maiúsculas de ' +
        'minúsculas, ou o e-mail. Se a pessoa não existir, devolve lista vazia — tente `listar_agendas` ou um nome ' +
        "parcial.",
      inputSchema: {
        pessoa: z.string().min(1).describe("Nome (parcial) ou e-mail do responsável."),
      },
    },
    async ({ pessoa }) => {
      try {
        const pagina = await dados.listarPorResponsavel({ pessoa });
        return resposta(pagina, formatarLista(pagina.dados, pagina.paginacao.total));
      } catch (e) {
        return erro(e);
      }
    }
  );

  server.registerTool(
    "listar_agendas",
    {
      title: "Listar agendas",
      description:
        "Lista as agendas (calendários) disponíveis: TI CF Contabilidade, Soluções Inteligentes, Felipe Oliveira, " +
        "DevPoint, YFLume. Use quando o usuário citar uma agenda pelo nome e você precisar do id exato, ou para " +
        "descobrir quais agendas existem.",
      inputSchema: {},
    },
    async () => {
      try {
        const { agendas } = await dados.listarAgendas();
        const texto = agendas.length
          ? agendas.map((a) => `• ${a.nome} — id: ${a.id}`).join("\n")
          : "Nenhuma agenda encontrada.";
        return resposta({ agendas }, texto);
      } catch (e) {
        return erro(e);
      }
    }
  );

  server.registerTool(
    "detalhe_evento",
    {
      title: "Detalhe de um evento",
      description:
        "Traz um evento específico pelo id, com descrição completa, convidados e responsável. Use quando o usuário " +
        'pedir o detalhe de um evento específico.',
      inputSchema: {
        id: z.string().min(1).describe("Id do evento (campo `id` da listagem)."),
      },
    },
    async ({ id }) => {
      try {
        const { evento } = await dados.listarEventoPorId({ id });
        return resposta({ evento }, formatarEvento(evento));
      } catch (e) {
        return erro(e);
      }
    }
  );

  return server;
}
