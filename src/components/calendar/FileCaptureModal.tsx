"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { ParsedEvent } from "@/lib/openai-event-parser";
import { CalendarOption } from "@/types/task";

type CaptureState = "idle" | "processing" | "error" | "review" | "saving";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = /^(image\/|application\/pdf$)/;
const ACCEPTED_EXT = /\.(pdf|txt|eml)$/i;

interface FileCaptureModalProps {
  onResult: (parsed: ParsedEvent) => void;
  onBatchResult: (events: ParsedEvent[]) => Promise<{ okIndexes: number[]; errors: string[] }>;
  onClose: () => void;
}

interface DraftEvent extends ParsedEvent {
  selected: boolean;
}

function validateFile(f: File): string | null {
  if (f.size > MAX_SIZE_BYTES) return "Arquivo muito grande (máx. 10 MB)";
  if (!ACCEPTED_TYPES.test(f.type) && !ACCEPTED_EXT.test(f.name)) {
    return "Tipo de arquivo não suportado. Envie uma imagem, PDF ou arquivo .txt/.eml.";
  }
  return null;
}

function toDateValue(iso: string): string {
  try { return format(new Date(iso), "yyyy-MM-dd"); } catch { return ""; }
}

function toTimeValue(iso: string): string {
  try { return format(new Date(iso), "HH:mm"); } catch { return ""; }
}

function combineToIso(dateValue: string, timeValue: string): string {
  return new Date(`${dateValue}T${timeValue}`).toISOString();
}

export function FileCaptureModal({ onResult, onBatchResult, onClose }: FileCaptureModalProps) {
  const [state, setState] = useState<CaptureState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [drafts, setDrafts] = useState<DraftEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [reviewNotice, setReviewNotice] = useState("");
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [file]);

  useEffect(() => {
    if (state !== "review") return;
    let active = true;
    fetch("/api/calendars")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CalendarOption[]) => { if (active) setCalendars(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [state]);

  function pickFile(f: File) {
    const err = validateFile(f);
    if (err) {
      setErrorMsg(err);
      setState("error");
      return;
    }
    setErrorMsg("");
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          pickFile(f);
          return;
        }
      }
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) pickFile(f);
  }

  async function submitCapture() {
    if (!file && !text.trim()) return;
    setState("processing");
    try {
      const formData = new FormData();
      if (file) formData.append("file", file);
      else formData.append("text", text.trim());
      const res = await fetch("/api/file-event/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro na análise");
      const events = (data.events as ParsedEvent[] | undefined) ?? (data.parsed ? [data.parsed as ParsedEvent] : []);
      if (events.length <= 1) {
        onResult(events[0] ?? (data.parsed as ParsedEvent));
        return;
      }
      setDrafts(events.map((e) => ({ ...e, selected: true })));
      setReviewNotice("");
      setState("review");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro ao processar o conteúdo.");
    }
  }

  function handleRetry() {
    setErrorMsg("");
    setState("idle");
  }

  function updateDraft(index: number, patch: Partial<DraftEvent>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function handleDraftDateChange(index: number, dateValue: string) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index) return d;
        return {
          ...d,
          startTime: combineToIso(dateValue, toTimeValue(d.startTime)),
          endTime: combineToIso(dateValue, toTimeValue(d.endTime)),
        };
      })
    );
  }

  function handleDraftTimeChange(index: number, field: "startTime" | "endTime", timeValue: string) {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index) return d;
        return { ...d, [field]: combineToIso(toDateValue(d[field]), timeValue) };
      })
    );
  }

  function removeDraft(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  async function handleCreateAll() {
    const selected = drafts.filter((d) => d.selected);
    if (!selected.length) return;
    setState("saving");
    setSaveProgress({ done: 0, total: selected.length });
    setReviewNotice("");
    try {
      const { okIndexes } = await onBatchResult(selected);
      const failed = selected.filter((_, i) => !okIndexes.includes(i));
      if (failed.length === 0) {
        onClose();
        return;
      }
      setDrafts((prev) => prev.filter((d) => !d.selected || failed.includes(d)));
      setReviewNotice(`${okIndexes.length} de ${selected.length} eventos criados. Revise os que falharam e tente de novo.`);
      setState("review");
    } catch {
      setReviewNotice("Erro ao criar os eventos. Tente novamente.");
      setState("review");
    }
  }

  const canSubmit = !!file || text.trim().length > 0;

  const modal = (
    <div
      className="fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onPaste={handlePaste}
    >
      {state === "idle" && (
        <div className="w-full max-w-sm bg-[#2a2b2e] border border-[#3c4043] rounded-2xl p-5 flex flex-col gap-4">
          <p className="text-[#e8eaed] text-sm font-medium">Criar evento com IA</p>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf,.txt,.eml"
            hidden
            onChange={handleInputChange}
          />

          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-8 px-4 text-center transition-colors ${
                dragging ? "border-[#4dd0e1] bg-[#4dd0e1]/10" : "border-[#5f6368]"
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-7 h-7 text-[#9aa0a6]" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
              </svg>
              <p className="text-[#9aa0a6] text-xs">Arraste um print aqui, cole (Ctrl+V) ou</p>
              <button
                onClick={() => inputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-[#4dd0e1]/20 border border-[#4dd0e1]/40 text-[#4dd0e1] text-xs hover:bg-[#4dd0e1]/30 transition-colors"
              >
                Escolher arquivo
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-[#3c4043] p-3 flex items-center gap-3">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="w-12 h-12 rounded-md object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-[#3c4043] flex items-center justify-center text-[#9aa0a6] text-[10px]">
                  {file.name.split(".").pop()?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[#e8eaed] text-xs truncate">{file.name || "Imagem colada"}</p>
                <p className="text-[#9aa0a6] text-[11px]">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                onClick={() => setFile(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[#9aa0a6] hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Remover arquivo"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {!file && (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-[#3c4043]" />
                <span className="text-[#9aa0a6] text-[11px]">ou cole um texto</span>
                <div className="flex-1 h-px bg-[#3c4043]" />
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="Cole aqui uma mensagem, convite ou e-mail com os detalhes do evento..."
                className="w-full rounded-lg bg-[#202124] border border-[#3c4043] text-[#e8eaed] text-sm px-3 py-2 resize-y placeholder:text-[#9aa0a6] focus:outline-none focus:border-[#4dd0e1]"
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#3c4043] border border-[#5f6368] text-[#e8eaed] text-sm hover:bg-[#4a4d51] transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={submitCapture}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-lg bg-[#4dd0e1]/20 border border-[#4dd0e1]/40 text-[#4dd0e1] text-sm hover:bg-[#4dd0e1]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Analisar
            </button>
          </div>
        </div>
      )}

      {state === "processing" && (
        <div className="flex flex-col items-center gap-6 select-none">
          <div className="w-20 h-20 rounded-full bg-[#8ab4f8]/20 border border-[#8ab4f8]/40 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#8ab4f8] animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
          <p className="text-white/70 text-sm">Analisando...</p>
        </div>
      )}

      {(state === "review" || state === "saving") && (
        <div className="w-full max-w-md bg-[#2a2b2e] border border-[#3c4043] rounded-2xl p-5 flex flex-col gap-4 max-h-[85vh]">
          <p className="text-[#e8eaed] text-sm font-medium">
            Eventos encontrados ({drafts.length})
          </p>

          {reviewNotice && (
            <p className="text-[11px] text-[#fdd663] bg-[#fdd663]/10 border border-[#fdd663]/30 rounded-lg px-3 py-2">
              {reviewNotice}
            </p>
          )}

          <div className="flex-1 overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
            {drafts.map((draft, i) => (
              <div key={i} className="rounded-xl border border-[#3c4043] bg-[#202124] p-3 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    onChange={(e) => updateDraft(i, { selected: e.target.checked })}
                    className="mt-2 w-4 h-4 accent-[#4dd0e1] shrink-0"
                  />
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(e) => updateDraft(i, { title: e.target.value })}
                    className="flex-1 min-w-0 bg-[#2a2b2e] text-[#e8eaed] text-sm rounded-lg px-2.5 py-2 border border-[#3c4043] focus:outline-none focus:border-[#4dd0e1]"
                  />
                  <button
                    onClick={() => removeDraft(i)}
                    className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-[#9aa0a6] hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Remover evento"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5 pl-6">
                  <input
                    type="date"
                    value={toDateValue(draft.startTime)}
                    onChange={(e) => handleDraftDateChange(i, e.target.value)}
                    className="min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-lg px-2 py-2 text-[11px] border border-[#3c4043] appearance-none focus:outline-none focus:border-[#4dd0e1]"
                  />
                  <input
                    type="time"
                    value={toTimeValue(draft.startTime)}
                    onChange={(e) => handleDraftTimeChange(i, "startTime", e.target.value)}
                    className="min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-lg px-2 py-2 text-[11px] border border-[#3c4043] appearance-none focus:outline-none focus:border-[#4dd0e1]"
                  />
                  <input
                    type="time"
                    value={toTimeValue(draft.endTime)}
                    onChange={(e) => handleDraftTimeChange(i, "endTime", e.target.value)}
                    className="min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-lg px-2 py-2 text-[11px] border border-[#3c4043] appearance-none focus:outline-none focus:border-[#4dd0e1]"
                  />
                </div>

                <div className="pl-6">
                  <select
                    value={calendars.some((c) => c.id === draft.calendarId) ? draft.calendarId! : (calendars[0]?.id ?? "primary")}
                    onChange={(e) => updateDraft(i, { calendarId: e.target.value })}
                    className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-lg px-2 py-2 text-[11px] border border-[#3c4043] focus:outline-none focus:border-[#4dd0e1]"
                  >
                    {calendars.length === 0 && <option value="primary">Principal</option>}
                    {calendars.map((cal) => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={state === "saving"}
              className="px-4 py-2 rounded-lg bg-[#3c4043] border border-[#5f6368] text-[#e8eaed] text-sm hover:bg-[#4a4d51] transition-colors disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateAll}
              disabled={selectedCount === 0 || state === "saving"}
              className="px-4 py-2 rounded-lg bg-[#4dd0e1]/20 border border-[#4dd0e1]/40 text-[#4dd0e1] text-sm hover:bg-[#4dd0e1]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {state === "saving"
                ? `Criando ${saveProgress.total > 0 ? `${selectedCount}` : ""}...`
                : `Criar ${selectedCount} ${selectedCount === 1 ? "evento" : "eventos"}`}
            </button>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-6 select-none">
          <div className="w-20 h-20 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-9 h-9 text-red-400" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div className="text-center max-w-xs px-4">
            <p className="text-red-400 text-sm">{errorMsg}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className="px-5 py-2.5 rounded-xl bg-[#4dd0e1]/20 border border-[#4dd0e1]/40 text-[#4dd0e1] text-sm hover:bg-[#4dd0e1]/30 transition-colors"
            >
              Tentar de novo
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-[#3c4043] border border-[#5f6368] text-[#e8eaed] text-sm hover:bg-[#4a4d51] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state !== "idle" && state !== "review" && state !== "saving" && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors"
          aria-label="Cancelar"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
