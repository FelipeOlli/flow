/**
 * Tipos e contrato de acesso aos dados da secretária.
 *
 * Sem nenhum import de propósito: o mesmo arquivo é lido pelo servidor MCP
 * (que roda TypeScript direto pelo Node, sem resolver o alias "@/") e pelas
 * rotas da API. É importado sempre como `import type`, então nunca vira
 * dependência em tempo de execução.
 */

/** Evento no formato da API da secretária (derivado, não existe no Google). */
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

export interface AgendaSecretaria {
  id: string;
  nome: string;
  cor: string | null;
}

export interface ParamsListarEventos {
  de?: string;
  ate?: string;
  agenda?: string;
  status?: string;
  limite?: number;
  offset?: number;
  incluirFeriados?: boolean;
}

export interface ParamsListarProximos {
  minutos: number;
  limite?: number;
  offset?: number;
  incluirFeriados?: boolean;
}

export interface ParamsListarEmAberto {
  diasParado: number;
  limite?: number;
  offset?: number;
  incluirFeriados?: boolean;
}

export interface ParamsListarPorResponsavel {
  pessoa: string;
  limite?: number;
  offset?: number;
  incluirFeriados?: boolean;
}

/**
 * De onde as ferramentas do MCP tiram os dados.
 *
 * Duas implementações:
 * - **HTTP** (padrão): fala com a API REST do Flow. É o que o servidor stdio
 *   usa — ele roda fora do app e só conhece a API.
 * - **Direto**: chama a lógica da secretária dentro do próprio processo do
 *   app, sem passar por rede. É o que a rota `/mcp` usa — assim não depende
 *   de porta, DNS nem proxy dentro do container.
 */
export interface SecretariaBackend {
  listarAgendas(): Promise<{ agendas: AgendaSecretaria[] }>;
  listarEventos(params: ParamsListarEventos): Promise<Pagina<EventoSecretaria>>;
  listarProximos(params: ParamsListarProximos): Promise<Pagina<EventoSecretaria>>;
  listarEmAberto(params: ParamsListarEmAberto): Promise<Pagina<EventoSecretaria>>;
  listarPorResponsavel(params: ParamsListarPorResponsavel): Promise<Pagina<EventoSecretaria>>;
  listarEventoPorId(params: { id: string }): Promise<{ evento: EventoSecretaria }>;
}
