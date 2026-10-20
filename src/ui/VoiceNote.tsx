/**
 * Voice-note button for the message field. Tap to record, tap again to send
 * (or ✕ to discard). The recording is transcribed by the configured
 * speech-to-text engine and sent as a voice-note message.
 */
import { useEffect, useRef, useState } from "react";
import { microphone, PcmBuffer } from "../state/mic";
import { runtime } from "../state/runtime";
import { useStore } from "../state/store";
import { Icon } from "./controls";

const MAX_SECONDS = 120;

export function VoiceNoteButton({ disabled, onTranscribed, onActiveChange }: { disabled?: boolean; onTranscribed(text: string, seconds: number): void; onActiveChange?(recording: boolean): void }) {
  const notify = useStore((s) => s.notify);
  const sttReady = useStore((s) => !!s.settings.stt);
  const setView = useStore((s) => s.setView);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  useEffect(() => onActiveChange?.(state === "recording"), [state, onActiveChange]);
  const buf = useRef(new PcmBuffer());
  const release = useRef<(() => void) | null>(null);
  const started = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    release.current?.();
    release.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };
  useEffect(() => cleanup, []);

  const start = async () => {
    if (!sttReady) {
      notify("error", "Voice notes need speech-to-text. Set it up in Settings → Voices.");
      setView("settings");
      return;
    }
    buf.current.clear();
    try {
      release.current = await microphone.acquire((frame, rate, lvl) => {
        buf.current.push(frame, rate);
        setLevel(lvl);
      });
    } catch (e) {
      notify("error", (e as Error).message);
      return;
    }
    started.current = performance.now();
    setElapsed(0);
    setState("recording");
    tick.current = setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) void finish();
    }, 200);
  };

  const finish = async () => {
    cleanup();
    const seconds = buf.current.seconds;
    if (seconds < 0.5) {
      setState("idle");
      return;
    }
    setState("transcribing");
    try {
      const text = await runtime.transcribe(buf.current.toWav());
      buf.current.clear();
      if (text) onTranscribed(text, seconds);
      else notify("info", "Couldn't make out any words in that voice note.");
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setState("idle");
    }
  };

  const cancel = () => {
    cleanup();
    buf.current.clear();
    setState("idle");
  };

  if (state === "recording") {
    const s = Math.floor(elapsed);
    return (
      <div className="voice-rec" role="status">
        <button type="button" className="icon-btn" onClick={cancel} aria-label="Discard voice note" title="Discard"><Icon name="close" size={18} /></button>
        <span className="rec-dot" style={{ transform: `scale(${1 + Math.min(1, level * 8) * 0.6})` }} aria-hidden />
        <span className="rec-label">Recording voice note</span>
        <span className="rec-time">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
        <span className="spacer" />
        <button type="button" className="send rec-send" onClick={() => void finish()} aria-label="Send voice note" title="Send voice note"><Icon name="send" /></button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="mic-btn"
      disabled={disabled || state === "transcribing"}
      onClick={() => void start()}
      aria-label={state === "transcribing" ? "Transcribing voice note" : "Record a voice note"}
      title="Record a voice note"
      data-busy={state === "transcribing" || undefined}
    >
      <Icon name="mic" />
    </button>
  );
}
