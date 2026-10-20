/**
 * Call mode: hands-free conversation.
 *
 * While a call is open the microphone listens continuously. When the user has
 * spoken and then been silent for the configured pause (never under 3 s), the
 * turn is transcribed and sent. While a character is thinking or speaking the
 * mic input is ignored, so the character never "hears" itself through the
 * speakers, and listening resumes shortly after it finishes.
 */
import { TurnDetector } from "../core/audio/turnDetector";
import { microphone, PcmBuffer } from "./mic";
import { live, subscribeAnyLive } from "./live";
import { useStore } from "./store";
import { runtime } from "./runtime";

export type CallState =
  | { kind: "off" }
  | { kind: "muted" }
  | { kind: "listening" } // waiting for the user to speak
  | { kind: "hearing"; pauseMs: number; silenceMs: number } // user mid-turn
  | { kind: "transcribing" }
  | { kind: "their-turn" } // a character is thinking / speaking
  | { kind: "error"; message: string };

const PRE_ROLL_MS = 400;
const RESUME_AFTER_MS = 600;

class CallController {
  state: CallState = { kind: "off" };
  private listeners = new Set<(s: CallState) => void>();
  private release: (() => void) | null = null;
  private detector = new TurnDetector();
  private buffer = new PcmBuffer();
  private muted = false;
  private busyUntil = 0;
  private unsubLive: (() => void) | null = null;
  private lastEmit = 0;

  on(fn: (s: CallState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(s: CallState): void {
    this.state = s;
    this.listeners.forEach((fn) => fn(s));
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Is any on-screen character thinking or talking right now? */
  private theirTurn(): boolean {
    if (runtime.orch?.isBusy) return true;
    const ids = useStore.getState().session.companionIds;
    return ids.some((id) => live(id).thinking || live(id).speaking);
  }

  async start(): Promise<void> {
    if (this.release) return;
    const { settings } = useStore.getState();
    if (!settings.stt) {
      this.set({ kind: "error", message: "Set up speech-to-text in Settings → Voices so CyPals can hear you." });
      return;
    }
    this.detector = new TurnDetector({ silenceMs: settings.call.silenceSeconds * 1000 });
    this.buffer.clear();
    try {
      this.release = await microphone.acquire((frame, rate, level) => this.onFrame(frame, rate, level));
    } catch (e) {
      this.set({ kind: "error", message: (e as Error).message });
      return;
    }
    // Leave the floor to characters while they think/speak; reset when they finish.
    this.unsubLive = subscribeAnyLive(() => {
      if (this.theirTurn()) this.busyUntil = Number.POSITIVE_INFINITY;
      else if (this.busyUntil === Number.POSITIVE_INFINITY) this.busyUntil = performance.now() + RESUME_AFTER_MS;
    });
    this.set(this.muted ? { kind: "muted" } : { kind: "listening" });
  }

  stop(): void {
    this.release?.();
    this.release = null;
    this.unsubLive?.();
    this.unsubLive = null;
    this.buffer.clear();
    this.detector.reset();
    this.set({ kind: "off" });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.detector.reset();
    this.buffer.clear();
    if (this.release) this.set(m ? { kind: "muted" } : { kind: "listening" });
  }

  private onFrame(frame: Float32Array, rate: number, level: number): void {
    if (this.muted || this.state.kind === "transcribing") return;
    const frameMs = (frame.length / rate) * 1000;
    if (this.theirTurn() || performance.now() < this.busyUntil) {
      if (this.state.kind !== "their-turn") {
        this.detector.reset();
        this.buffer.clear();
        this.set({ kind: "their-turn" });
      }
      return;
    }
    this.buffer.push(frame, rate);
    const ev = this.detector.push(level, frameMs);
    if (!this.detector.inTurn && ev !== "turn-end") {
      this.buffer.keepLast(PRE_ROLL_MS);
      if (this.state.kind !== "listening") this.set({ kind: "listening" });
      return;
    }
    if (ev === "turn-end") {
      void this.finishTurn();
      return;
    }
    // Throttle UI updates for the pause countdown.
    const now = performance.now();
    if (now - this.lastEmit > 120 || ev === "speech-start") {
      this.lastEmit = now;
      this.set({ kind: "hearing", pauseMs: this.detector.pauseMs, silenceMs: useStore.getState().settings.call.silenceSeconds * 1000 });
    }
  }

  private async finishTurn(): Promise<void> {
    const silence = useStore.getState().settings.call.silenceSeconds * 1000;
    this.buffer.trimEnd(silence - 250);
    const wav = this.buffer.toWav();
    this.buffer.clear();
    this.set({ kind: "transcribing" });
    try {
      const text = await runtime.transcribe(wav);
      this.set({ kind: "their-turn" });
      if (text) {
        this.busyUntil = Number.POSITIVE_INFINITY;
        // Call-mode speech is the conversation itself, not a voice note, so it isn't tagged as one.
        const v = useStore.getState().settings.vision;
        await runtime.send(text, v.screen.enabled || v.webcam.enabled);
        if (!this.theirTurn()) this.busyUntil = performance.now() + RESUME_AFTER_MS;
      } else {
        this.busyUntil = 0;
      }
    } catch (e) {
      this.set({ kind: "error", message: (e as Error).message });
      setTimeout(() => this.release && this.state.kind === "error" && this.set({ kind: "listening" }), 4000);
      return;
    }
    if (this.release && this.state.kind === "their-turn" && !this.theirTurn()) this.set({ kind: "listening" });
  }
}

export const call = new CallController();
