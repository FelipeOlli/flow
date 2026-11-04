/**
 * Chegadas externas — eventos que apareceram na agenda sem serem criados pelo
 * Flow: alguém criou direto no Google Calendar, ou alguém adicionou o Felipe
 * como convidado.
 *
 * Este módulo é lógica pura: sem I/O de rede e **sem nenhum import**. É o
 * mesmo padrão de `src/lib/secretaria-backend.ts` — o arquivo é lido por Node
 * rodando TypeScript direto (nos testes), que não resolve alias nem caminho
 * relativo sem extensão.
 *
 * A chave de identidade é o `iCalUID`, não o id do evento. Motivo: o Google
 * dá ids diferentes para cada ocorrência de uma série recorrente, mas o
 * `iCalUID` é o mesmo da série inteira — sem isso, toda semana entraria um
 * aviso novo para a mesma série.
 */

/** Participante de um evento, como o Google devolve. */
export interface Participante {
  email?: string;
  nome?: string;
  responseStatus?: string;
  /** `self` = o participante é o dono do calendário onde o evento está. */
  self?: boolean;
  /** `organizer: true` = o participante é quem organizou o evento. */
  organizador?: boolean;
}

/** Evento cru, enxuto — só o que o monitor precisa. */
export interface EventoChegada {
  id: string;
  iCalUid?: string;
  summary: string;
  /** ISO 8601 com offset. Vazio pra evento de dia inteiro. */
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  /** "confirmed" | "tentative" | "cancelled". */
  status?: string;
  organizerEmail?: string;
  organizerNome?: string;
  /** `true` quando quem organizou é o dono do token (o Felipe). */
  organizerEhUsuario?: boolean;
  /** `flowOrigem: "flow"` — evento criado pelo Flow. */
  flowOrigem?: string;
  /** Demais marcadores `flow*` gravados no evento. */
  marcadoresFlow?: string[];
  participantes: Participante[];
  agendaId: string;
  agendaNome: string;
  /** Agenda pessoal (primary) do usuário. */
  agendaPessoal?: boolean;
}

export type TipoChegada = "convite" | "externo";

/** Resultado da classificação de um evento — sem as agendas de chegada. */
export interface Classificacao {
  tipo: TipoChegada;
  autorEmail?: string;
  autorNome?: string;
}

export interface Chegada extends Classificacao {
  evento: EventoChegada;
  /**
   * Agendas onde o evento apareceu nesta varredura. Todas precisam ser
   * registradas como vistas — senão a mesma chegada seria avisada de novo
   * no ciclo seguinte.
   */
  agendas: string[];
}

/** Marcador gravado em todo evento criado pelo Flow. */
export const FLOW_ORIGEM_KEY = "flowOrigem";
export const FLOW_ORIGEM_VALOR = "flow";

/**
 * Marcadores que o Flow grava quando o Felipe interage com um evento.
 *
 * O `flowOpenSince` NÃO entra na lista: ele é carimbado automaticamente pela
 * migração noturna em qualquer evento pendente — inclusive nos que vieram de
 * fora. Os outros só existem porque o Felipe mexeu no evento no Flow.
 */
const MARCADORES_DE_INTERACAO = [
  "flowPillar",
  "flowCategory",
  "flowImportant",
  "flowDelegable",
  "flowDelegateName",
  "flowDelegateEmail",
  "flowReminderMinutes",
];

export interface OpcoesClassificar {
  /** E-mail do dono do token — quem organizou o evento é "dele" ou não. */
  emailUsuario?: string;
  /** Inclui também os eventos criados pelo próprio usuário fora do Flow. */
  avisarProprios?: boolean;
  /** Nomes de agenda ignorados (feriados). */
  agendasIgnoradas?: string[];
}

function normalizar(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase();
}

function agendaIgnorada(evento: EventoChegada, ignoradas: string[]): boolean {
  const nome = normalizar(evento.agendaNome);
  return ignoradas.some((ex) => nome.includes(normalizar(ex)));
}

/**
 * O evento é do Flow, ou o Felipe já mexeu nele?
 *
 * `flowOrigem` é a prova de que o evento foi criado pelo Flow. Os outros
 * marcadores `flow*` provam que o Felipe interagiu com o evento no Flow
 * (marcou como importante, pôs pilar, delegou). Sem essa segunda regra,
 * todo evento pendente que a migração noturna carimba com `flowOpenSince`
 * seria tratado como chegada externa — e a migração mexe em todos eles
 * toda noite.
 */
export function eventoCriadoPeloFlow(evento: EventoChegada): boolean {
  if (evento.flowOrigem === FLOW_ORIGEM_VALOR) return true;
  return (evento.marcadoresFlow ?? []).some((m) => MARCADORES_DE_INTERACAO.includes(m));
}

/**
 * O usuário é organizador?
 *
 * A comparação é pelo **e-mail**. O `self` do organizador NÃO serve: ele
 * significa "o organizador é o dono desta agenda" — num calendário
 * compartilhado, um evento organizado por `ti@cfcontabilidade.com` vem com
 * `self: true` mesmo sem ser o Felipe. Usar `self` ali faria o Flow
 * esconder justamente os eventos externos que o usuário quer saber.
 *
 * Sem e-mail do usuário, só dá pra confiar no `self` na agenda pessoal.
 */
export function organizadoPeloUsuario(
  evento: EventoChegada,
  emailUsuario?: string
): boolean {
  if (emailUsuario) {
    return normalizar(evento.organizerEmail) === normalizar(emailUsuario);
  }
  return evento.organizerEhUsuario === true && evento.agendaPessoal === true;
}

/**
 * O Felipe foi convidado?
 *
 * Convite em aberto é o participante com `responseStatus: "needsAction"`.
 * A comparação é pelo **e-mail**: em agenda compartilhada o participante
 * marcado com `self` é a conta da própria agenda (ti@cfcontabilidade.com),
 * não o Felipe — usar `self` ali classificaria evento externo como convite.
 */
export function foiConvidado(
  evento: EventoChegada,
  emailUsuario?: string
): boolean {
  if (!emailUsuario) return false;
  const alvo = normalizar(emailUsuario);
  return evento.participantes.some(
    (p) => normalizar(p.email) === alvo && p.responseStatus === "needsAction"
  );
}

/**
 * Decide se o evento é uma chegada que vale avisar, e de que tipo.
 * Retorna `null` quando não é nada novo (cancelado, do Flow, do próprio
 * usuário, feriado).
 */
export function classificarChegada(
  evento: EventoChegada,
  opcoes: OpcoesClassificar = {}
): Classificacao | null {
  if (evento.status === "cancelled") return null;
  if (agendaIgnorada(evento, opcoes.agendasIgnoradas ?? [])) return null;
  if (eventoCriadoPeloFlow(evento)) return null;

  const proprio = organizadoPeloUsuario(evento, opcoes.emailUsuario);
  if (proprio && !opcoes.avisarProprios) return null;

  const autorEmail = evento.organizerEmail;
  // Nome de quem organizou: o do organizador, ou o do participante marcado
  // como organizador (o Google nem sempre preenche o `displayName`).
  const participanteOrganizador = evento.participantes.find(
    (p) => p.organizador || (p.email && p.email === autorEmail)
  );
  const autorNome = evento.organizerNome ?? participanteOrganizador?.nome;

  if (foiConvidado(evento, opcoes.emailUsuario)) {
    // Quem convidou é o organizador — no convite é sempre outra pessoa.
    return { tipo: "convite", autorEmail, autorNome };
  }

  return { tipo: "externo", autorEmail, autorNome };
}

/**
 * Agrupa as cópias do mesmo evento (mesmo `iCalUID`) em várias agendas.
 *
 * O mesmo convite aparece na agenda compartilhada e na cópia sombra do
 * calendário pessoal. As duas cópias são chegadas **distintas** (agendas
 * diferentes), mas o aviso deve ser **um só**, dizendo a agenda de origem.
 */
export function agruparPorIcalUid(eventos: EventoChegada[]): Map<string, EventoChegada[]> {
  const grupos = new Map<string, EventoChegada[]>();
  for (const evento of eventos) {
    const chave = evento.iCalUid || evento.id;
    const lista = grupos.get(chave);
    if (lista) lista.push(evento);
    else grupos.set(chave, [evento]);
  }
  return grupos;
}

/**
 * Escolhe a agenda que aparece na mensagem e junta os participantes de
 * todas as cópias.
 *
 * A agenda **compartilhada** vence a pessoal — é onde o evento "nasceu" de
 * verdade. Os participantes são a união das cópias: o RSVP do usuário
 * (`needsAction`) só aparece na cópia pessoal, e sem ela o convite não
 * seria reconhecido.
 *
 * Quando é uma série recorrente, vale a ocorrência **mais próxima** — o
 * Google devolve várias instâncias e o usuário quer saber quando é a
 * próxima, não uma qualquer.
 */
export function mesclarCopias(copias: EventoChegada[]): EventoChegada {
  const agora = Date.now();
  const proxima = [...copias].sort((a, b) => {
    // Preferência por agenda (compartilhada > pessoal) só desempata as
    // ocorrências — o que manda é a data.
    const inicioA = a.inicio ? Date.parse(a.inicio) : Infinity;
    const inicioB = b.inicio ? Date.parse(b.inicio) : Infinity;
    const futuraA = inicioA >= agora;
    const futuraB = inicioB >= agora;
    if (futuraA !== futuraB) return futuraA ? -1 : 1;
    if (inicioA !== inicioB) return inicioA - inicioB;
    if (!!a.agendaPessoal !== !!b.agendaPessoal) return a.agendaPessoal ? 1 : -1;
    return a.agendaNome.localeCompare(b.agendaNome);
  })[0];

  // A agenda mostrada é a de origem: compartilhada vence pessoal.
  const base = [...copias].sort((a, b) => {
    if (!!a.agendaPessoal !== !!b.agendaPessoal) return a.agendaPessoal ? 1 : -1;
    return a.agendaNome.localeCompare(b.agendaNome);
  })[0];

  const participantes = [...proxima.participantes];
  // Mesma pessoa vista em duas cópias: une pelo e-mail, e completa o nome
  // quando uma das cópias tem o `displayName` e a outra não.
  const porEmail = new Map<string, Participante>();
  for (const p of participantes) {
    if (p.email) porEmail.set(normalizar(p.email), p);
  }

  for (const copia of copias) {
    for (const p of copia.participantes) {
      const chave = normalizar(p.email ?? "");
      const existente = porEmail.get(chave);
      if (!existente) {
        participantes.push(p);
        if (chave) porEmail.set(chave, p);
        continue;
      }
      if (!existente.nome && p.nome) {
        existente.nome = p.nome;
      }
      if (!existente.responseStatus && p.responseStatus) {
        existente.responseStatus = p.responseStatus;
      }
      if (p.organizador) existente.organizador = true;
    }
  }

  // Une os marcadores `flow*` das cópias: a mesma chegada pode ter o
  // marcador em uma agenda e não em outra (cópia sombra). O que vale é a
  // união — basta um deles provar que o Flow já conhece o evento.
  const marcadoresFlow = [...new Set(copias.flatMap((c) => c.marcadoresFlow ?? []))];
  const flowOrigem = copias.find((c) => c.flowOrigem)?.flowOrigem;

  return {
    ...proxima,
    agendaNome: base.agendaNome,
    agendaId: base.agendaId,
    agendaPessoal: base.agendaPessoal,
    participantes,
    marcadoresFlow,
    flowOrigem,
  };
}

/**
 * Dos eventos que mudaram, quais são chegadas novas (ainda não vistas)?
 *
 * `registro` é a memória do app: por evento, em quais agendas ele já
 * apareceu. A regra difere por tipo de chegada:
 *
 * - **externo**: só é novo se o evento nunca apareceu em agenda nenhuma.
 *   Se ele já estava na agenda A e agora aparece na B, é o mesmo evento
 *   mudando de lugar — não é chegada nova.
 * - **convite**: é novo se a agenda onde o usuário é convidado ainda não
 *   tinha este evento. Alguém adicionar o Felipe a um evento que já existia
 *   na agenda compartilhada é informação nova, mesmo que o evento não seja.
 *
 * O agrupamento é por `iCalUID`, então um evento em várias agendas vira um
 * aviso só — e a agenda mostrada é a compartilhada, onde ele nasceu.
 */
export function selecionarNovas(
  eventos: EventoChegada[],
  registro: Registro,
  opcoes: OpcoesClassificar = {}
): Chegada[] {
  const grupos = agruparPorIcalUid(eventos);
  const novas: Chegada[] = [];

  for (const copias of grupos.values()) {
    const identidade = identidadeDoEvento(copias[0]);
    const jaApareceuEmAlguma = !!registro[identidade];
    const agendaNova = copias.find((c) => !vistoNaAgenda(registro, c));

    const chegada = mesclarCopias(copias);
    const classificacao = classificarChegada(chegada, opcoes);
    if (!classificacao) continue;

    if (classificacao.tipo === "externo") {
      // Evento que já era conhecido em outra agenda = mudança de lugar.
      if (jaApareceuEmAlguma) continue;
    } else if (!agendaNova) {
      // Convite cuja agenda já conhecia o evento = nada de novo.
      continue;
    }

    novas.push({
      ...classificacao,
      evento: chegada,
      agendas: copias.map((c) => c.agendaId),
    });
  }

  return novas;
}

/**
 * Registro de "já vistos": por evento, em quais agendas ele já apareceu.
 *
 * A chave é o `iCalUID` (identidade do evento no Google) — o mesmo em todas
 * as cópias e em todas as ocorrências de uma série recorrente, que têm ids
 * diferentes a cada semana. Guardar o iCalUID é o que impede um aviso novo
 * toda semana para a mesma série.
 *
 * O valor guarda as agendas onde o evento já apareceu. Isso é o que
 * distingue duas coisas que a data sozinha não distingue:
 *
 * - o evento **chegou** (nunca apareceu em agenda nenhuma) → avisar;
 * - o evento **mudou de agenda** (ya estava na A, agora na B) → não avisar.
 */
export interface RegistroVisto {
  /** ISO de quando o evento foi visto pela primeira vez. */
  iso: string;
  /** Ids das agendas onde o evento já apareceu. */
  agendas: string[];
}

export type Registro = Record<string, RegistroVisto>;

/** O evento já apareceu na agenda? */
export function vistoNaAgenda(registro: Registro, evento: EventoChegada): boolean {
  const entrada = registro[identidadeDoEvento(evento)];
  return !!entrada && entryAgendas(entrada).includes(evento.agendaId);
}

/** O evento já apareceu em alguma agenda? */
export function vistoEmAlgumaAgenda(registro: Registro, evento: EventoChegada): boolean {
  return !!registro[identidadeDoEvento(evento)];
}

/**
 * Identidade do evento: o `iCalUID` quando existe, o id do Google como
 * reserva. Series recorrentes compartilham o `iCalUID` entre as ocorrências.
 */
export function identidadeDoEvento(evento: EventoChegada): string {
  return evento.iCalUid || evento.id;
}

/** Agendas registradas de uma entrada (defensivo contra arquivo corrompido). */
function entryAgendas(entrada: RegistroVisto): string[] {
  return Array.isArray(entrada.agendas) ? entrada.agendas : [];
}

/**
 * Registra a chegada do evento nas agendas informadas.
 * Preserva as agendas já registradas — o registro é a memória do app.
 */
export function registrarVisto(
  registro: Registro,
  evento: EventoChegada,
  quando: string
): void {
  const identidade = identidadeDoEvento(evento);
  const anterior = registro[identidade];
  const agendas = anterior ? [...entryAgendas(anterior)] : [];
  if (!agendas.includes(evento.agendaId)) agendas.push(evento.agendaId);
  registro[identidade] = { iso: anterior?.iso ?? quando, agendas };
}

/** Idade máxima de uma entrada do registro, em dias. */
export const DIAS_MAXIMOS_VISTO = 365;

export function podarVistos(
  registro: Registro,
  agora = new Date()
): Registro {
  const limite = agora.getTime() - DIAS_MAXIMOS_VISTO * 24 * 60 * 60 * 1000;
  const podados: Registro = {};
  for (const [identidade, entrada] of Object.entries(registro)) {
    const ts = Date.parse(entrada.iso);
    if (!Number.isNaN(ts) && ts >= limite) podados[identidade] = entrada;
  }
  return podados;
}

// ── Mensagem ──────────────────────────────────────────────────────────────

/** O Telegram rejeita `<`/`>`/`&` crus no parse_mode HTML. */
function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatarData(inicio: string, timeZone: string): string {
  const amostra = inicio ? new Date(inicio) : new Date();
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(amostra);
}

function formatarHora(inicio: string, timeZone: string): string {
  if (!inicio) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    hour12: false,
  }).format(new Date(inicio));
}

/** "Fulana (fulana@x.com)" — nome quando existe, e-mail comoBackup. */
function descreverAutor(nome?: string, email?: string): string {
  if (nome && email) return `${nome} (${email})`;
  return nome || email || "";
}

/**
 * Monta o texto da mensagem (Telegram, HTML) e o texto do push.
 * O texto do Telegram é o mesmo que vai no corpo do push, já que o push
 * não aceita HTML.
 */
export function montarMensagem(
  chegada: Chegada,
  timeZone: string
): { telegram: string; pushTitulo: string; pushCorpo: string } {
  const { evento, tipo, autorEmail, autorNome } = chegada;
  const titulo = escaparHtml(evento.summary || "Sem título");
  const quando = evento.diaInteiro
    ? formatarData(evento.inicio, timeZone)
    : `${formatarData(evento.inicio, timeZone)} · ${formatarHora(evento.inicio, timeZone)}`;
  const agenda = escaparHtml(evento.agendaNome || "Sem nome");
  const autor = descreverAutor(autorNome, autorEmail);

  if (tipo === "convite") {
    const quem = autor ? escaparHtml(autor) : "alguém";
    return {
      telegram:
        `📩 <b>${quem} te convidou</b>\n` +
        `<b>${titulo}</b>\n` +
        `🗓 ${escaparHtml(quando)}\n` +
        `📂 Agenda: ${agenda}`,
      pushTitulo: `Convite: ${evento.summary || "Sem título"}`,
      pushCorpo: `${evento.agendaNome} · ${quando}${autor ? ` · ${autor}` : ""}`,
    };
  }

  const cabecalho = evento.agendaNome
    ? `📥 <b>Novo evento em ${agenda}</b>`
    : "📥 <b>Novo evento externo</b>";
  const linhaAutor = autor ? `\n👤 Criado por ${escaparHtml(autor)}` : "";
  return {
    telegram:
      `${cabecalho}\n` +
      `<b>${titulo}</b>\n` +
      `🗓 ${escaparHtml(quando)}` +
      linhaAutor,
    pushTitulo: `Novo evento: ${evento.summary || "Sem título"}`,
    pushCorpo: `${evento.agendaNome} · ${quando}${autor ? ` · ${autor}` : ""}`,
  };
}
