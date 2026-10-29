/**
 * Cliente da API REST da secretária do Flow.
 * O MCP nunca vê a credencial do Google — só o token de leitura da API.
 */

const BASE_URL = (process.env.FLOW_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_TOKEN = process.env.FLOW_API_TOKEN ?? "";

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

async function request<T>(caminho: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
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

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });

  const texto = await res.text();
  let corpo: unknown = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    throw new FlowApiError(res.status, `Resposta não-JSON da API (${res.status}): ${texto.slice(0, 200)}`);
  }

  if (!res.ok) {
    const erro = (corpo as { erro?: string } | null)?.erro ?? `HTTP ${res.status}`;
    throw new FlowApiError(res.status, erro);
  }
  return corpo as T;
}

export function listarAgendas(): Promise<{ agendas: { id: string; nome: string; cor: string | null }[] }> {
  return request("/api/secretaria/agendas");
}

export function listarEventos(params: {
  agenda?: string;
  de?: string;
  ate?: string;
  status?: string;
  limite?: number;
  offset?: number;
}): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos", params);
}

export function eventosProximos(minutos: number): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/proximos", { minutos });
}

export function eventosEmAberto(diasParado: number): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/em-aberto", { dias_parado: diasParado });
}

export function eventosPorResponsavel(pessoa: string): Promise<Pagina<EventoSecretaria>> {
  return request("/api/secretaria/eventos/por-responsavel", { pessoa });
}

export function eventoPorId(id: string): Promise<{ evento: EventoSecretaria }> {
  return request(`/api/secretaria/eventos/${encodeURIComponent(id)}`);
}
