import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Ferramentas MCP da secretária do Flow.
 *
 * Fica fora de `src/components` e sem import de "@/..." de propósito: o mesmo
 * arquivo é usado pela rota HTTP do app (`/mcp`) e pelo servidor stdio que roda
 * no Claude Code/Desktop (`mcp/server.ts`), que roda o TypeScript direto pelo
 * Node (sem webpack, sem alias).
 *
 * O MCP só chama a API REST do Flow — a credencial do Google nunca sai do
 * servidor do app.
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

export interface EventoSecretaria {
  id: string;
  titulo: string;
  agenda: string;
  agenda_id: string;
  inicio: string;
  fim: string;
  dia: string;
  dia_inteiro: boolean;
  status: "aberto" | "concluido" | "cancelado" | "recusado";
  responsavel?: string;
  responsavel_email?: string;
  atualizado_em?: string;
  dias_em_aberto: number;
  descricao?: string;
  local?: string;
  importante: boolean;
  delegavel: boolean;
  recorrente: boolean;
  categoria?: string;
  pilar?: string;
  convidados: string[];
}

export interface Pagina<T> {
  dados: T[];
  paginacao: { total: number; limite: number; offset: number };
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

function listarAgendas(): Promise<{ agendas: { id: string; nome: string; cor: string | null }[] }> {
  return request("/api/secretaria/agendas");
}

function listarEventos(params: {
  agenda?: string;
  de?: string;
  ate?: string;
  status?: string;
  limite?: number;
  offset?: number;
}): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos", params);
}

function eventosProximos(minutos: number): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/proximos", { minutos });
}

function eventosEmAberto(diasParado: number): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/em-aberto", { dias_parado: diasParado });
}

function eventosPorResponsavel(pessoa: string): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/por-responsavel", { pessoa });
}

function eventoPorId(id: string): Promise<{ evento: EventoSecretaria }> {
  return request(`/api/secretaria/eventos/${encodeURIComponent(id)}`);
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
  const mensagem =
    e instanceof FlowApiError
      ? `Erro da API do Flow (${e.status}): ${e.message}`
      : `Erro ao consultar a API do Flow: ${e instanceof Error ? e.message : String(e)}`;
  return { content: [{ type: "text" as const, text: mensagem }], isError: true };
}

/** Cria o servidor MCP com todas as ferramentas da secretária. */
export function criarServidorSecretaria(): McpServer {
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
        const pagina = await listarEventos({ de, ate, agenda, status, limite, offset });
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
        const pagina = await eventosProximos(minutos ?? 120);
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
        const pagina = await eventosEmAberto(dias_parado ?? 7);
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
        'Retorna os eventos delegados a uma pessoa. Use para "o que o André tem", "quais tarefas são do ' +
        'Gabriel", "o que está com a Yasmim". Aceita nome parcial, sem acento e sem diferenciar maiúsculas de ' +
        'minúsculas, ou o e-mail. Se a pessoa não existir, devolve lista vazia — tente `listar_agendas` ou um nome ' +
        "parcial.",
      inputSchema: {
        pessoa: z.string().min(1).describe("Nome (parcial) ou e-mail do responsável."),
      },
    },
    async ({ pessoa }) => {
      try {
        const pagina = await eventosPorResponsavel(pessoa);
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
        const { agendas } = await listarAgendas();
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
        const { evento } = await eventoPorId(id);
        return resposta({ evento }, formatarEvento(evento));
      } catch (e) {
        return erro(e);
      }
    }
  );

  return server;
}
