"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ParsedEvent } from "@/lib/openai-event-parser";

type CaptureState = "idle" | "processing" | "error";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = /^(image\/|application\/pdf$)/;
const ACCEPTED_EXT = /\.(pdf|txt|eml)$/i;

interface FileCaptureModalProps {
  onResult: (parsed: ParsedEvent) => void;
  onMultipleResults: (events: ParsedEvent[]) => void;
  onClose: () => void;
}

function validateFile(f: File): string | null {
  if (f.size > MAX_SIZE_BYTES) return "Arquivo muito grande (máx. 10 MB)";
  if (!ACCEPTED_TYPES.test(f.type) && !ACCEPTED_EXT.test(f.name)) {
    return "Tipo de arquivo não suportado. Envie uma imagem, PDF ou arquivo .txt/.eml.";
  }
  return null;
}

export function FileCaptureModal({ onResult, onMultipleResults, onClose }: FileCaptureModalProps) {
  const [state, setState] = useState<CaptureState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      } else {
        onMultipleResults(events);
      }
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro ao processar o conteúdo.");
    }
  }

  function handleRetry() {
    setErrorMsg("");
    setState("idle");
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

      {state !== "idle" && (
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
