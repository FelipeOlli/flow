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

  // Escrita (Fase 4) — só liberado com o token de escrita.
  criarEvento(params: ParamsCriarEvento): Promise<{ evento: EventoSecretaria }>;
  atualizarEvento(params: ParamsAtualizarEvento): Promise<{ evento: EventoSecretaria }>;
}

/** Alcance da alteração em evento recorrente. */
export type Escopo = "esta" | "seguintes" | "todas";

export type PilarEvento = "trabalho" | "saude" | "familia" | "espiritualidade";
export type CategoriaEvento = "operacional" | "estrategico";

export interface ParamsCriarEvento {
  titulo: string;
  /** Data do evento (YYYY-MM-DD). */
  data: string;
  /** Hora de início (HH:MM). Sem ela, o evento é de dia inteiro. */
  horaInicio?: string;
  /** Hora de término (HH:MM). Sem ela: 1 hora depois do início. */
  horaFim?: string;
  duracaoMinutos?: number;
  /** Nome ou id da agenda (padrão: principal). */
  agenda?: string;
  descricao?: string;
  /** Minutos de aviso. 0 = sem lembrete. */
  lembreteMinutos?: number;
  pilar?: PilarEvento;
  categoria?: CategoriaEvento;
  /** Tag D: tarefa delegável. Exclusivo com `categoria`. */
  delegavel?: boolean;
  /** Destaque com estrela. Independe das tags. */
  importante?: boolean;
  /** Nome de quem ficou responsável pela entrega. */
  responsavel?: string;
  /** E-mails dos convidados. */
  convidados?: string[];
  /** Regras de recorrência, ex.: ["RRULE:FREQ=WEEKLY;BYDAY=MO"]. */
  recorrencia?: string[];
}

export interface ParamsAtualizarEvento {
  id: string;
  titulo?: string;
  data?: string;
  horaInicio?: string;
  horaFim?: string;
  descricao?: string;
  lembreteMinutos?: number;
  pilar?: PilarEvento;
  /** `null` remove a categoria. */
  categoria?: CategoriaEvento | null;
  /** Tag D: tarefa delegável. Exclusivo com `categoria`. */
  delegavel?: boolean;
  /** Destaque com estrela. Independe das tags. */
  importante?: boolean;
  responsavel?: string;
  /** "concluir" marca o evento como concluído. */
  acao?: "concluir";
  escopo?: Escopo;
}
