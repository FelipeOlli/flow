"use client";

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ParsedEvent } from "@/lib/openai-event-parser";

type CaptureState = "idle" | "processing" | "error";

interface FileCaptureModalProps {
  onResult: (parsed: ParsedEvent) => void;
  onClose: () => void;
}

export function FileCaptureModal({ onResult, onClose }: FileCaptureModalProps) {
  const [state, setState] = useState<CaptureState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
    inputRef.current?.click();
  }, []);

  async function submitFile(file: File) {
    setState("processing");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/file-event/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro na análise");
      onResult(data.parsed as ParsedEvent);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro ao processar o arquivo.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) submitFile(file);
    e.target.value = "";
  }

  function handleRetry() {
    setErrorMsg("");
    setState("idle");
    inputRef.current?.click();
  }

  const modal = (
    <div className="fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.txt,.eml"
        hidden
        onChange={handleFileChange}
      />

      <div className="flex flex-col items-center gap-6 select-none">
        {state === "idle" && (
          <>
            <div className="w-20 h-20 rounded-full bg-[#4dd0e1]/20 border border-[#4dd0e1]/40 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-9 h-9 text-[#4dd0e1]" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3 3 0 014.24 4.24l-9.19 9.19a1 1 0 01-1.41-1.41l8.48-8.49" />
              </svg>
            </div>
            <p className="text-white/60 text-sm">Escolhendo arquivo...</p>
          </>
        )}

        {state === "processing" && (
          <>
            <div className="w-20 h-20 rounded-full bg-[#8ab4f8]/20 border border-[#8ab4f8]/40 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#8ab4f8] animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
            <p className="text-white/70 text-sm">Analisando arquivo...</p>
          </>
        )}

        {state === "error" && (
          <>
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
          </>
        )}
      </div>

      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors"
        aria-label="Cancelar"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
