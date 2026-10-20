/**
 * Speech playback with amplitude tracking for lip sync.
 * With real audio, amplitude is the RMS of the playing buffer.
 * Without TTS, `simulateSpeech` produces believable mouth flaps for the time
 * it would take to read the text, so avatars still "talk" in text-only mode.
 */
let ctx: AudioContext | null = null;
function audioCtx(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export interface PlaybackHandle {
  done: Promise<void>;
  stop(): void;
}

export function playAudio(bytes: Uint8Array, onAmplitude: (a: number) => void): PlaybackHandle {
  const ac = audioCtx();
  let src: AudioBufferSourceNode | null = null;
  let raf = 0;
  let stopped = false;
  const done = (async () => {
    const buf = await ac.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
    if (stopped) return;
    src = ac.createBufferSource();
    src.buffer = buf;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(ac.destination);
    const data = new Float32Array(analyser.fftSize);
    let smooth = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      // Map speech RMS (~0.02–0.25) into 0..1 with attack/release smoothing.
      const target = Math.min(1, Math.max(0, (rms - 0.015) * 5));
      smooth += (target - smooth) * (target > smooth ? 0.6 : 0.25);
      onAmplitude(smooth);
      raf = requestAnimationFrame(tick);
    };
    await new Promise<void>((resolve) => {
      src!.onended = () => resolve();
      src!.start();
      tick();
    });
  })().finally(() => {
    cancelAnimationFrame(raf);
    onAmplitude(0);
  });
  return {
    done,
    stop() {
      stopped = true;
      try {
        src?.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Mouth flaps for text-only mode: ~14 chars/sec reading pace, syllable-like rhythm. */
export function simulateSpeech(text: string, onAmplitude: (a: number) => void, reduceMotion = false): PlaybackHandle {
  const durationMs = Math.min(12000, Math.max(700, (text.replace(/\*[^*]*\*/g, "").length / 14) * 1000));
  let raf = 0;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const start = performance.now();
  const tick = (t: number) => {
    const e = t - start;
    if (e >= durationMs) {
      onAmplitude(0);
      resolveDone();
      return;
    }
    if (!reduceMotion) {
      const syl = Math.abs(Math.sin(e / 85)) * (0.55 + 0.45 * Math.abs(Math.sin(e / 410)));
      onAmplitude(syl > 0.25 ? syl : 0);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    done,
    stop() {
      cancelAnimationFrame(raf);
      onAmplitude(0);
      resolveDone();
    },
  };
}
