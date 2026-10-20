/**
 * Microphone capture as raw PCM frames (Web Audio), shared by voice notes and
 * Call mode. The mic is opened only while one of those is active and closed
 * (light off) as soon as it isn't.
 */
import { concatFloat32, encodeWav, resample, rms } from "../core/audio/wav";

export const STT_SAMPLE_RATE = 16000;

export type FrameListener = (frame: Float32Array, sampleRate: number, level: number) => void;

export class MicUnavailableError extends Error {}

class Microphone {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private listeners = new Set<FrameListener>();
  private opening: Promise<void> | null = null;

  get active(): boolean {
    return !!this.stream;
  }

  async acquire(fn: FrameListener): Promise<() => void> {
    this.listeners.add(fn);
    try {
      await this.open();
    } catch (e) {
      this.listeners.delete(fn);
      throw e;
    }
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) this.close();
    };
  }

  private open(): Promise<void> {
    if (this.stream) return Promise.resolve();
    this.opening ??= (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new MicUnavailableError("This device's webview doesn't allow microphone access.");
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (e) {
        const name = (e as DOMException).name;
        throw new MicUnavailableError(
          name === "NotAllowedError" ? "Microphone access was denied. Allow it in your system settings and try again."
          : name === "NotFoundError" ? "No microphone was found."
          : `Couldn't open the microphone: ${(e as Error).message}`,
        );
      }
      this.ctx = new AudioContext();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(this.stream);
      // ScriptProcessor is deprecated but universally available, including older Android WebViews.
      this.node = this.ctx.createScriptProcessor(2048, 1, 1);
      this.node.onaudioprocess = (ev) => {
        const data = new Float32Array(ev.inputBuffer.getChannelData(0));
        const level = rms(data);
        for (const l of this.listeners) l(data, this.ctx!.sampleRate, level);
      };
      src.connect(this.node);
      // Must reach a destination to run; a zero-gain node keeps it silent.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute);
      mute.connect(this.ctx.destination);
    })().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private close(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }
}

export const microphone = new Microphone();

/** Collects frames and produces a 16 kHz WAV. */
export class PcmBuffer {
  private chunks: Float32Array[] = [];
  private rate = 48000;

  push(frame: Float32Array, sampleRate: number): void {
    this.rate = sampleRate;
    this.chunks.push(frame);
  }

  /** Keep only the most recent `ms` of audio (pre-roll before speech is detected). */
  keepLast(ms: number): void {
    let keep = Math.ceil((ms / 1000) * this.rate);
    const out: Float32Array[] = [];
    for (let i = this.chunks.length - 1; i >= 0 && keep > 0; i--) {
      out.unshift(this.chunks[i]);
      keep -= this.chunks[i].length;
    }
    this.chunks = out;
  }

  /** Drop the last `ms` (the trailing silence that ended a Call-mode turn). */
  trimEnd(ms: number): void {
    let drop = Math.floor((ms / 1000) * this.rate);
    while (drop > 0 && this.chunks.length) {
      const last = this.chunks[this.chunks.length - 1];
      if (last.length <= drop) {
        drop -= last.length;
        this.chunks.pop();
      } else {
        this.chunks[this.chunks.length - 1] = last.subarray(0, last.length - drop);
        drop = 0;
      }
    }
  }

  get seconds(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0) / this.rate;
  }

  clear(): void {
    this.chunks = [];
  }

  toWav(): Uint8Array {
    return encodeWav(resample(concatFloat32(this.chunks), this.rate, STT_SAMPLE_RATE), STT_SAMPLE_RATE);
  }
}
