export type ProviderKind = "openai-compatible" | "gemini" | "anthropic";

/** Presets shown in Settings. All but Gemini/Anthropic speak the OpenAI chat-completions dialect. */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  local: boolean;
  needsKey: boolean;
  defaultModel: string;
  /** Whether the preset's usual models accept image input. */
  vision: boolean;
  docs?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // Local
  { id: "ollama", label: "Ollama (local)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", local: true, needsKey: false, defaultModel: "llama3.1:8b", vision: false },
  { id: "lmstudio", label: "LM Studio (local)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", local: true, needsKey: false, defaultModel: "local-model", vision: false },
  { id: "koboldcpp", label: "KoboldCpp (local)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:5001/v1", local: true, needsKey: false, defaultModel: "koboldcpp", vision: false },
  { id: "llamacpp", label: "llama.cpp server (local)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:8080/v1", local: true, needsKey: false, defaultModel: "default", vision: false },
  { id: "textgen", label: "text-generation-webui (local)", kind: "openai-compatible", baseUrl: "http://127.0.0.1:5000/v1", local: true, needsKey: false, defaultModel: "default", vision: false },
  // Cloud
  { id: "openrouter", label: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", local: false, needsKey: true, defaultModel: "openrouter/auto", vision: true },
  { id: "grok", label: "Grok (xAI)", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1", local: false, needsKey: true, defaultModel: "grok-4", vision: true },
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", local: false, needsKey: true, defaultModel: "gemini-2.5-flash", vision: true },
  { id: "anthropic", label: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", local: false, needsKey: true, defaultModel: "claude-sonnet-4-5", vision: true },
  { id: "openai", label: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", local: false, needsKey: true, defaultModel: "gpt-4.1-mini", vision: true },
  { id: "deepseek", label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", local: false, needsKey: true, defaultModel: "deepseek-chat", vision: false },
  { id: "mistral", label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", local: false, needsKey: true, defaultModel: "mistral-large-latest", vision: true },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai-compatible", baseUrl: "", local: false, needsKey: false, defaultModel: "", vision: false },
];

export interface LLMProfile {
  id: string;
  label: string;
  presetId: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Stored in the OS keychain on desktop / Keystore on Android, never in .cypal files. */
  apiKey: string;
  model: string;
  vision: boolean;
  sampling: SamplingSettings;
  /** Context window size in tokens; history is trimmed to fit. */
  contextTokens: number;
  /** Extra headers (e.g. OpenRouter's HTTP-Referer / X-Title). */
  headers: Record<string, string>;
}

export interface SamplingSettings {
  temperature: number;
  topP: number;
  topK: number | null;
  minP: number | null;
  maxTokens: number;
  frequencyPenalty: number;
  presencePenalty: number;
  repetitionPenalty: number | null;
  stop: string[];
}

export const DEFAULT_SAMPLING: SamplingSettings = {
  temperature: 0.9,
  topP: 0.95,
  topK: null,
  minP: null,
  maxTokens: 400,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: null,
  stop: [],
};

export interface PromptImage {
  mime: string;
  /** Base64 without the data: prefix. */
  data: string;
  label?: string;
}

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: PromptImage[];
}

export interface GenerateRequest {
  messages: PromptMessage[];
  sampling: SamplingSettings;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface GenerateResult {
  text: string;
  finishReason: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LLMProvider {
  readonly profile: LLMProfile;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  listModels(): Promise<ModelInfo[]>;
}

/** One entry from a provider's model list. Only `id` is guaranteed. */
export interface ModelInfo {
  id: string;
  /** Human-readable name, when the provider gives one. */
  name?: string;
  contextLength?: number;
  /** Accepts image input (OpenRouter and Gemini report this). */
  vision?: boolean;
  /** Free to use (OpenRouter `:free` models / zero pricing). */
  free?: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
