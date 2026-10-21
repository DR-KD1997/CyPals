/**
 * LLM providers. One class per wire dialect:
 *   - OpenAICompatible: OpenRouter, Grok (xAI), OpenAI, DeepSeek, Mistral and every
 *     local server (Ollama, LM Studio, KoboldCpp, llama.cpp, text-generation-webui, vLLM).
 *   - Gemini: Google's generateContent API.
 *   - Anthropic: Messages API.
 * All stream via SSE and report deltas, and all accept image inputs when the
 * profile has vision enabled (used for consented screen / webcam frames).
 *
 * `fetchImpl` is injected: the desktop/Android app passes Tauri's HTTP plugin
 * (no CORS, can reach localhost from the webview), tests pass a fake.
 */
import type { FetchLike, GenerateRequest, GenerateResult, LLMProfile, LLMProvider, ModelInfo, PromptMessage } from "./types";
import { DEFAULT_SAMPLING, PROVIDER_PRESETS } from "./types";
import { uid } from "../util";

export class LLMError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
  }
}

/** Parse an SSE stream into `data:` payloads. Handles CRLF, multi-line data and comments. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) yield data;
      }
    }
    const tail = buf.trim();
    if (tail.startsWith("data:")) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

async function ensureOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message ?? j?.message ?? body;
  } catch {
    /* not JSON */
  }
  throw new LLMError(`${label} request failed (${res.status}): ${String(msg).slice(0, 400)}`, res.status, body);
}

/** Some APIs require strict user/assistant alternation and no leading assistant turn. */
export function normalizeAlternation(msgs: PromptMessage[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
      if (m.images?.length) last.images = [...(last.images ?? []), ...m.images];
    } else {
      out.push({ ...m, images: m.images ? [...m.images] : undefined });
    }
  }
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "[Start]" });
  return out;
}

/**
 * Leading system messages become the API's system prompt. System messages that
 * appear later (depth-injected lore, post-history notes) must keep their
 * position, so they are sent as bracketed user-role notes, which every API accepts.
 */
export function splitSystem(msgs: PromptMessage[]): { system: string; rest: PromptMessage[] } {
  let i = 0;
  while (i < msgs.length && msgs[i].role === "system") i++;
  const system = msgs.slice(0, i).map((m) => m.content).join("\n\n");
  const rest = msgs.slice(i).map((m) =>
    m.role === "system" ? { ...m, role: "user" as const, content: `[System note: ${m.content}]` } : m,
  );
  return { system, rest };
}

// ─────────────────────────── OpenAI-compatible ───────────────────────────

export class OpenAICompatibleProvider implements LLMProvider {
  constructor(public readonly profile: LLMProfile, private fetchImpl: FetchLike) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...this.profile.headers };
    if (this.profile.apiKey) h.Authorization = `Bearer ${this.profile.apiKey}`;
    if (this.profile.presetId === "openrouter") {
      h["HTTP-Referer"] ??= "https://cypals.app";
      h["X-Title"] ??= "CyPals";
    }
    return h;
  }

  buildBody(req: GenerateRequest): Record<string, unknown> {
    const s = req.sampling;
    // Local servers often reject consecutive same-role turns too, so normalise
    // everything after the leading system block.
    const { system, rest } = splitSystem(req.messages);
    const msgs = [...(system ? [{ role: "system" as const, content: system }] : []), ...normalizeAlternation(rest)];
    const body: Record<string, unknown> = {
      model: this.profile.model,
      stream: true,
      temperature: s.temperature,
      top_p: s.topP,
      max_tokens: s.maxTokens,
      frequency_penalty: s.frequencyPenalty || undefined,
      presence_penalty: s.presencePenalty || undefined,
      stop: s.stop.length ? s.stop : undefined,
      messages: msgs.map((m) =>
        m.images?.length && this.profile.vision
          ? {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.data}` } })),
              ],
            }
          : { role: m.role, content: m.content },
      ),
    };
    // Non-standard samplers understood by most local backends and OpenRouter.
    if (s.topK != null) body.top_k = s.topK;
    if (s.minP != null) body.min_p = s.minP;
    if (s.repetitionPenalty != null) body.repetition_penalty = s.repetitionPenalty;
    return body;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await this.fetchImpl(`${trimSlash(this.profile.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(res, this.profile.label);
    let text = "";
    let finishReason = "stop";
    let usage: GenerateResult["usage"];
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.body || ctype.includes("application/json")) {
      // Server ignored stream:true.
      const j = await res.json();
      text = j.choices?.[0]?.message?.content ?? "";
      req.onDelta?.(text);
      return { text, finishReason: j.choices?.[0]?.finish_reason ?? "stop" };
    }
    for await (const data of sseEvents(res.body)) {
      if (data === "[DONE]") break;
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw new LLMError(`${this.profile.label}: ${j.error.message ?? JSON.stringify(j.error)}`);
      const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? "";
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
      if (j.usage) usage = { promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens };
    }
    return { text, finishReason, usage };
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetchImpl(`${trimSlash(this.profile.baseUrl)}/models`, { headers: this.headers() });
    await ensureOk(res, this.profile.label);
    const j = await res.json();
    const list: unknown[] = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
    return sortModels(list.map(parseOpenAIModel).filter((m): m is ModelInfo => !!m));
  }
}

// ─────────────────────────── Gemini ───────────────────────────

export class GeminiProvider implements LLMProvider {
  constructor(public readonly profile: LLMProfile, private fetchImpl: FetchLike) {}

  buildBody(req: GenerateRequest): Record<string, unknown> {
    const { system, rest } = splitSystem(req.messages);
    const s = req.sampling;
    return {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: normalizeAlternation(rest).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          { text: m.content },
          ...(this.profile.vision ? m.images ?? [] : []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })),
        ],
      })),
      generationConfig: {
        temperature: s.temperature,
        topP: s.topP,
        topK: s.topK ?? undefined,
        maxOutputTokens: s.maxTokens,
        stopSequences: s.stop.length ? s.stop : undefined,
      },
      // Roleplay frequently trips default thresholds; users can tighten this in settings.
      safetySettings: ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT"].map(
        (category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }),
      ),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const url = `${trimSlash(this.profile.baseUrl)}/models/${encodeURIComponent(this.profile.model)}:streamGenerateContent?alt=sse`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.profile.apiKey, ...this.profile.headers },
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(res, "Gemini");
    let text = "";
    let finishReason = "stop";
    if (!res.body) throw new LLMError("Gemini returned no body");
    for await (const data of sseEvents(res.body)) {
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.promptFeedback?.blockReason) throw new LLMError(`Gemini blocked the prompt: ${j.promptFeedback.blockReason}`);
      const cand = j.candidates?.[0];
      const delta = (cand?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("");
      if (delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      if (cand?.finishReason) finishReason = String(cand.finishReason).toLowerCase();
    }
    return { text, finishReason };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let page = "";
    for (let i = 0; i < 20; i++) {
      const res = await this.fetchImpl(`${trimSlash(this.profile.baseUrl)}/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, {
        headers: { "x-goog-api-key": this.profile.apiKey },
      });
      await ensureOk(res, "Gemini");
      const j = await res.json();
      for (const m of j.models ?? []) {
        if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
        out.push({
          id: String(m.name).replace(/^models\//, ""),
          name: typeof m.displayName === "string" ? m.displayName : undefined,
          contextLength: Number(m.inputTokenLimit) || undefined,
          vision: true,
        });
      }
      page = j.nextPageToken ?? "";
      if (!page) break;
    }
    return sortModels(out);
  }
}

// ─────────────────────────── Anthropic ───────────────────────────

export class AnthropicProvider implements LLMProvider {
  constructor(public readonly profile: LLMProfile, private fetchImpl: FetchLike) {}

  buildBody(req: GenerateRequest): Record<string, unknown> {
    const { system, rest } = splitSystem(req.messages);
    const s = req.sampling;
    return {
      model: this.profile.model,
      system: system || undefined,
      max_tokens: s.maxTokens,
      temperature: Math.min(s.temperature, 1),
      top_p: s.topP < 1 ? s.topP : undefined,
      top_k: s.topK ?? undefined,
      stop_sequences: s.stop.length ? s.stop : undefined,
      stream: true,
      messages: normalizeAlternation(rest).map((m) => ({
        role: m.role,
        content: [
          ...(this.profile.vision ? m.images ?? [] : []).map((img) => ({
            type: "image",
            source: { type: "base64", media_type: img.mime, data: img.data },
          })),
          { type: "text", text: m.content },
        ],
      })),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await this.fetchImpl(`${trimSlash(this.profile.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.profile.apiKey,
        "anthropic-version": "2023-06-01",
        ...this.profile.headers,
      },
      body: JSON.stringify(this.buildBody(req)),
      signal: req.signal,
    });
    await ensureOk(res, "Anthropic");
    let text = "";
    let finishReason = "stop";
    if (!res.body) throw new LLMError("Anthropic returned no body");
    for await (const data of sseEvents(res.body)) {
      let j: any;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.type === "error") throw new LLMError(`Anthropic: ${j.error?.message ?? "stream error"}`);
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
        text += j.delta.text;
        req.onDelta?.(j.delta.text);
      }
      if (j.type === "message_delta" && j.delta?.stop_reason) finishReason = j.delta.stop_reason;
    }
    return { text, finishReason };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let after = "";
    for (let i = 0; i < 20; i++) {
      const res = await this.fetchImpl(`${trimSlash(this.profile.baseUrl)}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, {
        headers: { "x-api-key": this.profile.apiKey, "anthropic-version": "2023-06-01" },
      });
      await ensureOk(res, "Anthropic");
      const j = await res.json();
      for (const m of j.data ?? []) out.push({ id: String(m.id), name: typeof m.display_name === "string" ? m.display_name : undefined, vision: true });
      if (!j.has_more || !j.last_id) break;
      after = String(j.last_id);
    }
    return sortModels(out);
  }
}

// ─────────────────────────── factory ───────────────────────────

export function createProvider(profile: LLMProfile, fetchImpl: FetchLike): LLMProvider {
  switch (profile.kind) {
    case "gemini": return new GeminiProvider(profile, fetchImpl);
    case "anthropic": return new AnthropicProvider(profile, fetchImpl);
    default: return new OpenAICompatibleProvider(profile, fetchImpl);
  }
}

export function profileFromPreset(presetId: string, overrides: Partial<LLMProfile> = {}): LLMProfile {
  const p = PROVIDER_PRESETS.find((x) => x.id === presetId) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
  return {
    id: uid("llm"),
    label: p.label,
    presetId: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    apiKey: "",
    model: p.defaultModel,
    vision: p.vision,
    sampling: { ...DEFAULT_SAMPLING },
    contextTokens: p.local ? 8192 : 32768,
    headers: {},
    ...overrides,
  };
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

// ─────────────────────────── Model lists ───────────────────────────

/**
 * Reads one entry of an OpenAI-style `/models` list. OpenRouter adds `name`,
 * `context_length`, `architecture.input_modalities` and `pricing`; Groq adds
 * `context_window`; local servers often give only `id` (or `name`).
 */
export function parseOpenAIModel(m: unknown): ModelInfo | null {
  if (typeof m === "string") return m ? { id: m } : null;
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, any>;
  const id = String(r.id ?? r.model ?? r.name ?? "");
  if (!id) return null;
  const name = typeof r.name === "string" && r.name !== id ? r.name : undefined;
  const ctx = Number(r.context_length ?? r.context_window ?? r.top_provider?.context_length ?? r.max_context_length) || undefined;
  const modalities: unknown = r.architecture?.input_modalities;
  const vision = Array.isArray(modalities) ? modalities.includes("image") : typeof r.architecture?.modality === "string" ? /image/.test(String(r.architecture.modality).split("->")[0]) : undefined;
  const p = r.pricing;
  const free = id.endsWith(":free") || (p && Number(p.prompt) === 0 && Number(p.completion) === 0 && p.prompt !== undefined) ? true : undefined;
  return { id, name, contextLength: ctx, vision, free };
}

/** Sorted by id, duplicates removed. */
export function sortModels(list: ModelInfo[]): ModelInfo[] {
  const seen = new Map<string, ModelInfo>();
  for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}
