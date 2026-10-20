/**
 * Text-to-speech endpoints. With no endpoint configured, companions are
 * text-only (speech bubbles). With one, each reply segment is synthesised and
 * played in order; the avatar's mouth follows the audio amplitude, and the
 * user may hide the text entirely.
 *
 * Supported:
 *   - openai-speech: any `/v1/audio/speech` server — OpenAI, Kokoro-FastAPI,
 *     openedai-speech, AllTalk (OpenAI mode), LocalAI, Chatterbox servers…
 *   - elevenlabs
 *   - http-template: arbitrary GET/POST endpoint with {text}/{voice} placeholders,
 *     for XTTS, GPT-SoVITS, Piper HTTP, Coqui, RVC pipelines, etc.
 *   - system: the OS voice via Web Speech API (no audio buffer, so lip sync is approximate).
 */
import type { FetchLike } from "../llm/types";

export type TTSKind = "openai-speech" | "elevenlabs" | "http-template" | "system";

export interface TTSEndpoint {
  id: string;
  label: string;
  kind: TTSKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultVoice: string;
  /** http-template only. */
  template?: {
    method: "GET" | "POST";
    /** URL with {text}, {voice}, {speed} placeholders (URL-encoded on substitution). */
    url: string;
    /** JSON body template for POST; placeholders are JSON-escaped. */
    body?: string;
    headers?: Record<string, string>;
  };
  format: "mp3" | "wav" | "ogg" | "opus";
}

export interface SynthesisRequest {
  text: string;
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
}

export interface SynthesisResult {
  /** Encoded audio, or null for engines that play directly (system voice). */
  audio: Uint8Array | null;
  mime: string;
}

export interface TTSEngine {
  readonly endpoint: TTSEndpoint;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  listVoices(): Promise<{ id: string; name: string }[]>;
}

const MIME: Record<TTSEndpoint["format"], string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg" };

/** Text sent to TTS: drop *narration* and stage directions, keep speech. */
export function speakableText(text: string, opts: { readNarration?: boolean } = {}): string {
  let t = text;
  if (!opts.readNarration) t = t.replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ");
  return t
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[_~`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function readBytes(res: Response, label: string): Promise<Uint8Array> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} TTS failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

class OpenAISpeech implements TTSEngine {
  constructor(public readonly endpoint: TTSEndpoint, private fetchImpl: FetchLike) {}
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const res = await this.fetchImpl(`${this.endpoint.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.endpoint.apiKey ? { Authorization: `Bearer ${this.endpoint.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.endpoint.model || "tts-1",
        input: req.text,
        voice: req.voice || this.endpoint.defaultVoice || "alloy",
        speed: req.speed ?? 1,
        response_format: this.endpoint.format,
      }),
      signal: req.signal,
    });
    return { audio: await readBytes(res, this.endpoint.label), mime: MIME[this.endpoint.format] };
  }
  async listVoices() {
    try {
      const res = await this.fetchImpl(`${this.endpoint.baseUrl.replace(/\/+$/, "")}/audio/voices`, {
        headers: this.endpoint.apiKey ? { Authorization: `Bearer ${this.endpoint.apiKey}` } : {},
      });
      if (res.ok) {
        const j = await res.json();
        const list: unknown[] = Array.isArray(j) ? j : j.voices ?? [];
        return list.map((v: any) => ({ id: String(v.id ?? v.voice_id ?? v), name: String(v.name ?? v.id ?? v) }));
      }
    } catch {
      /* server has no voice listing */
    }
    return ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"].map((v) => ({ id: v, name: v }));
  }
}

class ElevenLabs implements TTSEngine {
  constructor(public readonly endpoint: TTSEndpoint, private fetchImpl: FetchLike) {}
  private base() {
    return (this.endpoint.baseUrl || "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
  }
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const voice = req.voice || this.endpoint.defaultVoice;
    if (!voice) throw new Error("ElevenLabs needs a voice ID");
    const res = await this.fetchImpl(`${this.base()}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": this.endpoint.apiKey, Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: req.text,
        model_id: this.endpoint.model || "eleven_flash_v2_5",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, speed: req.speed ?? 1 },
      }),
      signal: req.signal,
    });
    return { audio: await readBytes(res, "ElevenLabs"), mime: "audio/mpeg" };
  }
  async listVoices() {
    const res = await this.fetchImpl(`${this.base()}/voices`, { headers: { "xi-api-key": this.endpoint.apiKey } });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.voices ?? []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name) }));
  }
}

export function fillTemplate(tpl: string, vars: Record<string, string>, escape: (s: string) => string): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? escape(vars[k]) : m));
}

class HttpTemplate implements TTSEngine {
  constructor(public readonly endpoint: TTSEndpoint, private fetchImpl: FetchLike) {}
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const t = this.endpoint.template;
    if (!t) throw new Error("HTTP template TTS has no template configured");
    const vars = { text: req.text, voice: req.voice || this.endpoint.defaultVoice, speed: String(req.speed ?? 1) };
    const url = fillTemplate(t.url, vars, encodeURIComponent);
    const body = t.method === "POST" && t.body ? fillTemplate(t.body, vars, (s) => JSON.stringify(s).slice(1, -1)) : undefined;
    const res = await this.fetchImpl(url, {
      method: t.method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(t.headers ?? {}) },
      body,
      signal: req.signal,
    });
    return { audio: await readBytes(res, this.endpoint.label), mime: res.headers.get("content-type") || MIME[this.endpoint.format] };
  }
  async listVoices() {
    return this.endpoint.defaultVoice ? [{ id: this.endpoint.defaultVoice, name: this.endpoint.defaultVoice }] : [];
  }
}

class SystemVoice implements TTSEngine {
  constructor(public readonly endpoint: TTSEndpoint) {}
  synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    return new Promise((resolve, reject) => {
      const synth = globalThis.speechSynthesis;
      if (!synth) return reject(new Error("System speech is not available on this device"));
      const u = new SpeechSynthesisUtterance(req.text);
      const voice = synth.getVoices().find((v) => v.voiceURI === (req.voice || this.endpoint.defaultVoice));
      if (voice) u.voice = voice;
      u.rate = req.speed ?? 1;
      u.onend = () => resolve({ audio: null, mime: "" });
      u.onerror = (e) => reject(new Error(e.error));
      req.signal?.addEventListener("abort", () => synth.cancel());
      synth.speak(u);
    });
  }
  async listVoices() {
    return (globalThis.speechSynthesis?.getVoices() ?? []).map((v) => ({ id: v.voiceURI, name: `${v.name} (${v.lang})` }));
  }
}

export function createTTS(endpoint: TTSEndpoint, fetchImpl: FetchLike): TTSEngine {
  switch (endpoint.kind) {
    case "elevenlabs": return new ElevenLabs(endpoint, fetchImpl);
    case "http-template": return new HttpTemplate(endpoint, fetchImpl);
    case "system": return new SystemVoice(endpoint);
    default: return new OpenAISpeech(endpoint, fetchImpl);
  }
}

export const TTS_PRESETS: Omit<TTSEndpoint, "id">[] = [
  { label: "System voice", kind: "system", baseUrl: "", apiKey: "", model: "", defaultVoice: "", format: "mp3" },
  { label: "Kokoro-FastAPI (local)", kind: "openai-speech", baseUrl: "http://127.0.0.1:8880/v1", apiKey: "", model: "kokoro", defaultVoice: "af_heart", format: "mp3" },
  { label: "AllTalk TTS (local, OpenAI mode)", kind: "openai-speech", baseUrl: "http://127.0.0.1:7851/v1", apiKey: "", model: "tts-1", defaultVoice: "female_01.wav", format: "wav" },
  { label: "OpenAI TTS", kind: "openai-speech", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini-tts", defaultVoice: "coral", format: "mp3" },
  { label: "ElevenLabs", kind: "elevenlabs", baseUrl: "https://api.elevenlabs.io/v1", apiKey: "", model: "eleven_flash_v2_5", defaultVoice: "", format: "mp3" },
  {
    label: "GPT-SoVITS (local)", kind: "http-template", baseUrl: "", apiKey: "", model: "", defaultVoice: "", format: "wav",
    template: { method: "GET", url: "http://127.0.0.1:9880/tts?text={text}&text_lang=auto&ref_audio_path={voice}&prompt_lang=auto" },
  },
  {
    label: "XTTS API server (local)", kind: "http-template", baseUrl: "", apiKey: "", model: "", defaultVoice: "female.wav", format: "wav",
    template: { method: "POST", url: "http://127.0.0.1:8020/tts_to_audio/", body: '{"text":"{text}","speaker_wav":"{voice}","language":"en"}' },
  },
];
