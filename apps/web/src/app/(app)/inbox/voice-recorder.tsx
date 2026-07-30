"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Trash2 } from "lucide-react";

/** WhatsApp corta las notas de voz largas; 2 min es de sobra para atención. */
const MAX_MS = 120_000;

type Phase = "idle" | "recording" | "review" | "sending";

/**
 * Grabador de notas de voz. Produce **ogg/opus** con un encoder wasm en el
 * navegador y no con MediaRecorder: Chrome graba webm/opus, contenedor que
 * Meta rechaza en cualquier tipo de mensaje, y `voice: true` (la burbuja de
 * nota de voz de WhatsApp) exige ogg/opus.
 *
 * El worker vendorizado está en public/opus/encoderWorker.min.js, copiado de
 * node_modules/opus-recorder/dist. Para actualizarlo, volver a copiarlo.
 */
export function VoiceRecorder({
  to,
  conversationId,
  onSent,
}: {
  to: string;
  conversationId: string;
  onSent: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const startedAt = useRef<number>(0);
  const durationRef = useRef<number>(0);

  // Un ObjectURL vivo mantiene los bytes en memoria: se libera al soltar el clip.
  useEffect(() => {
    return () => {
      if (clip) URL.revokeObjectURL(clip.url);
    };
  }, [clip]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_MS) recorderRef.current?.stop();
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);

  const start = async () => {
    setError(null);
    try {
      const { default: Recorder } = await import("opus-recorder");
      if (!Recorder.isRecordingSupported()) {
        setError("Este navegador no permite grabar audio.");
        return;
      }
      const recorder = new Recorder({
        encoderPath: "/opus/encoderWorker.min.js",
        // 2048 = VOIP: optimizado para voz, no para música.
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        numberOfChannels: 1,
        streamPages: false,
      });
      recorder.ondataavailable = (data) => {
        const blob = new Blob([new Uint8Array(data)], { type: "audio/ogg" });
        setClip({ blob, url: URL.createObjectURL(blob) });
        setPhase("review");
      };
      recorderRef.current = recorder;
      await recorder.start();
      startedAt.current = Date.now();
      durationRef.current = 0;
      setElapsed(0);
      setPhase("recording");
    } catch (err) {
      // El caso normal aquí es que el asesor haya negado el micrófono.
      setError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Permiso de micrófono denegado."
          : "No se pudo iniciar la grabación.",
      );
      setPhase("idle");
    }
  };

  const stop = () => {
    durationRef.current = Date.now() - startedAt.current;
    recorderRef.current?.stop();
  };

  const discard = () => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setElapsed(0);
    setPhase("idle");
    recorderRef.current?.close();
    recorderRef.current = null;
  };

  const send = async () => {
    if (!clip) return;
    setPhase("sending");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", clip.blob, "nota-de-voz.ogg");
      form.append("to", to);
      form.append("conversationId", conversationId);
      form.append("durationMs", String(durationRef.current || elapsed));
      const res = await fetch("/api/wa/send-audio", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setError(
          typeof body?.error === "string"
            ? body.error
            : `No se pudo enviar (${res.status}).`,
        );
        setPhase("review");
        return;
      }
      discard();
      onSent();
    } catch {
      setError("No se pudo enviar la nota de voz.");
      setPhase("review");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {phase === "idle" && (
          <button
            type="button"
            onClick={start}
            title="Grabar nota de voz"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] transition hover:border-[rgba(110,231,183,0.4)] hover:text-[var(--color-accent)]"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}

        {phase === "recording" && (
          <>
            <button
              type="button"
              onClick={stop}
              title="Detener grabación"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-3 text-xs text-red-200"
            >
              <Square className="h-3.5 w-3.5" />
              {fmtDuration(elapsed)}
            </button>
            <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              Grabando… (máx {MAX_MS / 1000}s)
            </span>
          </>
        )}

        {(phase === "review" || phase === "sending") && clip && (
          <>
            <audio src={clip.url} controls className="h-9 max-w-[220px]" />
            <button
              type="button"
              onClick={send}
              disabled={phase === "sending"}
              className="app-button gap-2 text-xs"
            >
              <Send className="h-3.5 w-3.5" />
              {phase === "sending" ? "Enviando…" : "Enviar nota"}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={phase === "sending"}
              title="Descartar"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-red-400/40 hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
      {error && <p className="text-[11px] text-red-200">{error}</p>}
    </div>
  );
}

function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
