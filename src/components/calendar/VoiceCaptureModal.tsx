"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ParsedEvent } from "@/lib/openai-event-parser";

type CaptureState = "recording" | "processing" | "error";

interface VoiceCaptureModalProps {
  onResult: (parsed: ParsedEvent, transcript: string) => void;
  onClose: () => void;
}

export function VoiceCaptureModal({ onResult, onClose }: VoiceCaptureModalProps) {
  const [state, setState] = useState<CaptureState>("recording");
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setMounted(true);
    startRecording();
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Prefer webm/opus; Safari falls back to mp4
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeType });
        submitAudio(blob, mimeType);
      };

      recorder.start(250);

      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setState("error");
      setErrorMsg("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState("processing");
    mediaRecorderRef.current?.stop();
  }

  async function submitAudio(blob: Blob, mimeType: string) {
    try {
      const formData = new FormData();
      formData.append("audio", blob, `recording.${mimeType.split("/")[1]?.split(";")[0] ?? "webm"}`);

      const res = await fetch("/api/voice-event", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Erro desconhecido");
      }

      onResult(data.parsed, data.transcript);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Erro ao processar o áudio.");
    }
  }

  function handleRetry() {
    setSeconds(0);
    setErrorMsg("");
    chunksRef.current = [];
    setState("recording");
    startRecording();
  }

  const formatSeconds = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const modal = (
    <div
      className="fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={state === "recording" ? stopRecording : undefined}
    >
      <div
        className="flex flex-col items-center gap-6 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {state === "recording" && (
          <>
            {/* Pulsing mic */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-32 h-32 rounded-full bg-[#a78bfa]/20 animate-ping" style={{ animationDuration: "1.4s" }} />
              <div className="absolute w-24 h-24 rounded-full bg-[#a78bfa]/30 animate-pulse" />
              <div className="relative w-20 h-20 rounded-full bg-[#a78bfa]/40 border border-[#a78bfa]/60 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-9 h-9 text-white" fill="currentColor">
                  <path d="M12 1a4 4 0 014 4v7a4 4 0 01-8 0V5a4 4 0 014-4zm-6.5 9.5A6.5 6.5 0 0012 17a6.5 6.5 0 006.5-6.5h1.5A8 8 0 0112 18.5a8 8 0 01-8-7.5h1.5z"/>
                  <path d="M11 20h2v3h-2z"/>
                </svg>
              </div>
            </div>

            <div className="text-center">
              <p className="text-white text-lg font-medium tabular-nums">{formatSeconds(seconds)}</p>
              <p className="text-white/60 text-sm mt-1">Toque na tela para parar</p>
            </div>
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
            <p className="text-white/70 text-sm">Analisando...</p>
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
                className="px-5 py-2.5 rounded-xl bg-[#a78bfa]/20 border border-[#a78bfa]/40 text-[#a78bfa] text-sm hover:bg-[#a78bfa]/30 transition-colors"
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

      {/* Cancel button when recording */}
      {state === "recording" && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors"
          aria-label="Cancelar gravação"
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
