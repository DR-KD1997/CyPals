/**
 * Speech-to-text for voice notes and Call mode.
 *
 *  - openai-transcriptions: any `/v1/audio/transcriptions` server — OpenAI,
 *    Groq, and local Whisper servers (Speaches / faster-whisper-server, LocalAI,
 *    whisper.cpp's OpenAI-compatible mode).
 *  - gemini: Gemini listens to the audio and writes the transcript.
 */
import type { FetchLike } from "../llm/types";

export type STTKind = "openai-transcriptions" | "gemini";

export interface STTSettings {
  kind: STTKind;
  label: string;
  baseUrl: string;
  /** Kept in the secret store; for Gemini, falls back to a Gemini model connection's key. */
  apiKey: string;
  model: string;
  /** ISO-639-1 code such as "en"; empty = auto-detect. */
  language: string;
}

export const STT_PRESETS: STTSettings[] = [
  { kind: "openai-transcriptions", label: "Speaches / faster-whisper (local)", baseUrl: "http://127.0.0.1:8000/v1", apiKey: "", model: "Systran/faster-whisper-small", language: "" },
  { kind: "openai-transcriptions", label: "LocalAI Whisper (local)", baseUrl: "http://127.0.0.1:8080/v1", apiKey: "", model: "whisper-1", language: "" },
  { kind: "openai-transcriptions", label: "Groq Whisper", baseUrl: "https://api.groq.com/openai/v1", apiKey: "", model: "whisper-large-v3-turbo", language: "" },
  { kind: "openai-transcriptions", label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini-transcribe", language: "" },
  { kind: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", model: "gemini-2.5-flash", language: "" },
];

export interface TranscribeRequest {
  wav: Uint8Array;
  /** Names and words that help recognition (character names, persona name). */
  hint?: string;
  signal?: AbortSignal;
}

export class STTError extends Error {}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const j = JSON.parse(body);
    return j?.error?.message ?? j?.message ?? body;
  } catch {
    return body;
  }
}

/** Whisper and friends sometimes "hear" these in silence; treat them as nothing said. */
const HALLUCINATIONS = /^(\[?(blank_audio|silence|music|inaudible|no speech)\]?|thanks? for watching!?|thank you\.?|you|\.+)$/i;

export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.test(t) ? "" : t;
}

export async function transcribe(s: STTSettings, req: TranscribeRequest, fetchImpl: FetchLike): Promise<string> {
  const base = s.baseUrl.replace(/\/+$/, "");
  if (s.kind === "gemini") {
    if (!s.apiKey) throw new STTError("Speech-to-text with Gemini needs an API key (or a Gemini model connection).");
    let bin = "";
    for (let i = 0; i < req.wav.length; i += 0x8000) bin += String.fromCharCode(...req.wav.subarray(i, i + 0x8000));
    const res = await fetchImpl(`${base}/models/${encodeURIComponent(s.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": s.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/wav", data: btoa(bin) } },
              {
                text:
                  "Transcribe this voice recording exactly as spoken" +
                  (s.language ? ` (language: ${s.language})` : "") +
                  ". Reply with only the transcript, no quotes or commentary. If nothing intelligible is said, reply with nothing." +
                  (req.hint ? ` Names that may come up: ${req.hint}.` : ""),
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new STTError(`Transcription failed (${res.status}): ${(await errorText(res)).slice(0, 300)}`);
    const j = await res.json();
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    return cleanTranscript(text);
  }

  const form = new FormData();
  form.append("file", new Blob([req.wav as BlobPart], { type: "audio/wav" }), "voice.wav");
  form.append("model", s.model || "whisper-1");
  form.append("response_format", "json");
  if (s.language) form.append("language", s.language);
  if (req.hint) form.append("prompt", req.hint);
  const res = await fetchImpl(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {},
    body: form,
    signal: req.signal,
  });
  if (!res.ok) throw new STTError(`Transcription failed (${res.status}): ${(await errorText(res)).slice(0, 300)}`);
  const ctype = res.headers.get("content-type") ?? "";
  const text = ctype.includes("json") ? ((await res.json()).text ?? "") : await res.text();
  return cleanTranscript(String(text));
}
