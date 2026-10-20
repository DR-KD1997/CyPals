/**
 * Turn detection for Call mode.
 *
 * Fed one loudness value (RMS) per audio frame, it tracks a background-noise
 * floor and decides when the user is speaking. A turn ends — and it becomes
 * the character's turn to answer — only after the user has spoken for a
 * meaningful moment and then stayed silent for `silenceMs` (at least 3 s).
 * Pure and clock-free (frame durations are passed in), so it's unit-testable.
 */

export interface TurnDetectorOptions {
  /** Silence after speech that ends the user's turn. Never less than 3000 ms. */
  silenceMs: number;
  /** Speech shorter than this (coughs, clicks) doesn't count as a turn. */
  minSpeechMs: number;
  /** Absolute loudness below which audio is always silence. */
  minLevel: number;
  /** Speech must be this many times louder than the noise floor. */
  ratio: number;
}

export const DEFAULT_TURN_OPTIONS: TurnDetectorOptions = { silenceMs: 3000, minSpeechMs: 350, minLevel: 0.012, ratio: 3 };
export const MIN_SILENCE_MS = 3000;

export type TurnEvent = "speech-start" | "turn-end" | null;

export class TurnDetector {
  private opts: TurnDetectorOptions;
  private floor = 0.005;
  private speechMs = 0;
  private silenceMs = 0;
  private speaking = false;
  /** True once the current turn has had enough speech to count. */
  private hasSpeech = false;

  constructor(opts: Partial<TurnDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_TURN_OPTIONS, ...opts };
    this.opts.silenceMs = Math.max(MIN_SILENCE_MS, this.opts.silenceMs);
  }

  get threshold(): number {
    return Math.max(this.opts.minLevel, this.floor * this.opts.ratio);
  }

  /** Is the user currently mid-turn (speech heard, waiting for the pause)? */
  get inTurn(): boolean {
    return this.hasSpeech;
  }

  /** Milliseconds of silence so far in the current pause (for a countdown UI). */
  get pauseMs(): number {
    return this.hasSpeech && !this.speaking ? this.silenceMs : 0;
  }

  reset(): void {
    this.speechMs = 0;
    this.silenceMs = 0;
    this.speaking = false;
    this.hasSpeech = false;
  }

  push(level: number, frameMs: number): TurnEvent {
    const loud = level > this.threshold;
    // Noise floor: falls quickly to quieter audio, rises slowly, so constant
    // background noise (fans, traffic) is absorbed within ~20 s while a few
    // seconds of speech barely move it.
    this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor + (level - this.floor) * 0.001;
    if (loud) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
      if (!this.speaking && this.speechMs >= this.opts.minSpeechMs) {
        this.speaking = true;
        const first = !this.hasSpeech;
        this.hasSpeech = true;
        return first ? "speech-start" : null;
      }
      return null;
    }
    if (this.speaking) this.speaking = false;
    if (!this.hasSpeech) {
      // Short blips before a real turn decay away.
      this.speechMs = Math.max(0, this.speechMs - frameMs);
      return null;
    }
    this.silenceMs += frameMs;
    this.speechMs = 0;
    if (this.silenceMs >= this.opts.silenceMs) {
      this.reset();
      return "turn-end";
    }
    return null;
  }
}
