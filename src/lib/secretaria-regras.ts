import { normalizeText } from "./text";

/**
 * Regras da secretária — quando avisar sobre o quê.
 *
 * Cada agenda tem uma janela em que os avisos sobre ela são enviados:
 * - CF (TI CF Contabilidade): só em horário comercial, dias úteis.
 * - Pessoal (Felipe Oliveira): fora do expediente.
 * - SI, DevPoint e YFLume: o dia todo.
 *
 * Tudo configurável por env: SECRETARIA_REGRAS_AGENDA=off desliga as janelas.
 */

export interface Janela {
  /** "HH:mm" */
  inicio: string;
  /** "HH:mm" */
  fim: string;
}

export interface RegraAgenda {
  /** Trecho do nome da agenda (comparado sem acento, minúsculo). */
  match: string;
  /** Nome curto pro resumo do dia. */
  rotulo: string;
  /** Só avisa em dia útil (seg-sex). */
  diasUteis?: boolean;
  /** Janelas em que avisa. Vazio = o dia todo. */
  janelas?: Janela[];
}

export const REGRAS_AGENDA: RegraAgenda[] = [
  {
    match: "cf contabilidade",
    rotulo: "CF",
    diasUteis: true,
    janelas: [{ inicio: "08:00", fim: "18:00" }],
  },
  {
    match: "felipe oliveira",
    rotulo: "Pessoal",
    janelas: [
      { inicio: "00:00", fim: "08:00" },
      { inicio: "18:00", fim: "23:59" },
    ],
  },
  { match: "solucoes inteligentes", rotulo: "SI" },
  { match: "devpoint", rotulo: "DevPoint" },
  { match: "yflume", rotulo: "YFLume" },
];

/** Horário comercial em dias úteis — usado como atalho. */
export const JANELA_COMERCIAL: Janela[] = [{ inicio: "08:00", fim: "18:00" }];

export function regraDaAgenda(calendarName?: string): RegraAgenda | undefined {
  if (!calendarName) return undefined;
  const nome = normalizeText(calendarName);
  return REGRAS_AGENDA.find((r) => nome.includes(r.match));
}

/** Rótulo curto da agenda (cai no nome cru quando não há regra). */
export function rotuloDaAgenda(calendarName?: string): string {
  return regraDaAgenda(calendarName)?.rotulo ?? (calendarName?.trim() || "Agenda");
}

function minutosDoDia(hora: number, minuto: number): number {
  return hora * 60 + minuto;
}

function dentroDaJanela(janela: Janela, hora: number, minuto: number): boolean {
  const agora = minutosDoDia(hora, minuto);
  const inicio = minutosDoDia(...(janela.inicio.split(":").map(Number) as [number, number]));
  const fim = minutosDoDia(...(janela.fim.split(":").map(Number) as [number, number]));
  if (inicio <= fim) return agora >= inicio && agora <= fim;
  // Janela que atravessa a meia-noite (ex.: 22:00–07:00).
  return agora >= inicio || agora <= fim;
}

/**
 * A agenda permite aviso agora? (janela + dia útil + silêncio desligado aqui)
 */
export function agendaPermiteAviso(
  calendarName: string | undefined,
  hora: number,
  minuto: number,
  diaSemana: number
): boolean {
  if (process.env.SECRETARIA_REGRAS_AGENDA === "off") return true;
  const regra = regraDaAgenda(calendarName);
  if (!regra) return true;
  if (regra.diasUteis && (diaSemana === 0 || diaSemana === 6)) return false;
  if (!regra.janelas?.length) return true;
  return regra.janelas.some((janela) => dentroDaJanela(janela, hora, minuto));
}

/** Horário de silêncio — nada é enviado dentro da janela. */
export function dentroDoSilencio(hora: number, minuto: number): boolean {
  const inicio = process.env.SECRETARIA_SILENCE_START ?? "21:30";
  const fim = process.env.SECRETARIA_SILENCE_END ?? "07:00";
  return dentroDaJanela({ inicio, fim }, hora, minuto);
}

/** Horários (HH:mm) das mensagens diárias. */
export function horarioResumo(): string {
  return process.env.SECRETARIA_RESUMO_HORA ?? "07:30";
}

export function horarioCobranca(): string {
  return process.env.SECRETARIA_COBRANCA_HORA ?? "08:00";
}

export function horarioFechamento(): string {
  return process.env.SECRETARIA_FECHAMENTO_HORA ?? "20:00";
}

/** O recurso está ligado? (default: ligado quando há Telegram configurado) */
export function secretariaAtiva(): boolean {
  if (process.env.SECRETARIA_ENABLED === "off") return false;
  return !!process.env.TELEGRAM_CHAT_ID;
}

/** "HH:mm" → minutos desde a meia-noite. */
export function minutosDeHHMM(valor: string): number {
  const [h, m] = valor.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
