/**
 * CyPals core data model.
 *
 * A Companion is the unit the app saves to a `.cypal` file. It carries the
 * character's text definition (superset of Character Card V1–V3 fields),
 * one or more avatar representations the user can switch between, voice and
 * behaviour settings, and references to lorebooks (which live in their own
 * shared library so several companions can use the same one).
 */

export type ID = string;

// ───────────────────────────── Character definition ─────────────────────────────

export interface CharacterDefinition {
  name: string;
  /** Short display tagline / creator notes summary. */
  tagline: string;
  description: string;
  personality: string;
  scenario: string;
  /** First message(s). `firstMessage` is the default; alternates come from CCv2+. */
  firstMessage: string;
  alternateGreetings: string[];
  /** Example dialogue in the `<START>` / `{{char}}:` convention. */
  exampleDialogue: string;
  /** Replaces the app's main system prompt when non-empty (CCv2 `system_prompt`). */
  systemPrompt: string;
  /** Inserted after chat history (CCv2 `post_history_instructions`, "jailbreak"). */
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  characterVersion: string;
  tags: string[];
  /** CCv3 nickname used for {{char}} substitution when present. */
  nickname: string;
  /** Unknown fields from imported cards, preserved for round-tripping. */
  extensions: Record<string, unknown>;
}

// ───────────────────────────── Avatars ─────────────────────────────

/** Canonical emotion vocabulary. Renderers map these to shape keys / motions / images. */
export const EXPRESSIONS = [
  "neutral",
  "happy",
  "joy",
  "sad",
  "angry",
  "surprised",
  "fear",
  "disgust",
  "embarrassed",
  "thinking",
  "smug",
  "love",
  "sleepy",
  "confused",
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Named one-shot actions a character may perform. Free-form strings are also allowed. */
export const ACTIONS = ["wave", "nod", "shake_head", "laugh", "shrug", "bow", "think", "clap", "point"] as const;
export type Action = (typeof ACTIONS)[number] | (string & {});

/** Reference to a binary asset stored inside the .cypal bundle (or app data dir). */
export interface AssetRef {
  /** Path inside the bundle, e.g. `assets/model.vrm`. */
  path: string;
  mime: string;
}

export interface ModelAvatar {
  id: ID;
  kind: "model3d";
  label: string;
  /** .vrm, .glb or .gltf. */
  model: AssetRef;
  /** Extra animation clips (glTF/VRMA) keyed by action name. */
  animations: Record<string, AssetRef>;
  /**
   * Expression → shape-key weights. For VRM models the standard expression
   * presets are used automatically; this map overrides or extends them for
   * plain glTF morph targets, e.g. { happy: { "Smile": 1, "EyeSquint": 0.4 } }.
   */
  expressionMap: Partial<Record<Expression, Record<string, number>>>;
  /** Shape keys driven by audio amplitude for lip sync (VRM uses "aa" by default). */
  lipSyncKeys: string[];
  camera: { distance: number; height: number; fov: number };
}

export interface Live2DAvatar {
  id: ID;
  kind: "live2d";
  label: string;
  /** Path to the .model3.json (Cubism 3+) or .model.json (Cubism 2) entry file. */
  entry: AssetRef;
  /** All files the entry references (textures, .moc3, motions, physics). */
  files: AssetRef[];
  /** Expression → Live2D expression name (from the model's Expressions list). */
  expressionMap: Partial<Record<Expression, string>>;
  /** Action → motion group / index. */
  motionMap: Record<string, { group: string; index?: number }>;
  lipSyncParam: string;
  scale: number;
  offset: { x: number; y: number };
}

export interface PortraitAvatar {
  id: ID;
  kind: "portraits";
  label: string;
  /** Expression (or action) → one or more images; several = random pick for variety. */
  images: Record<string, AssetRef[]>;
  /** Used when no image matches the current expression. */
  fallback: string;
  /** Crossfade time in ms. */
  transitionMs: number;
  /** Optional "talking" frame per expression for simple mouth flaps. */
  talkingSuffix: string;
}

export type Avatar = ModelAvatar | Live2DAvatar | PortraitAvatar;
export type AvatarKind = Avatar["kind"];

// ───────────────────────────── Voice & presentation ─────────────────────────────

export interface VoiceSettings {
  /** ID of a configured TTS endpoint; empty = text only. */
  ttsEndpointId: ID | "";
  voiceId: string;
  speed: number;
  pitch: number;
  /** Only honoured when a TTS endpoint is active. */
  hideTextWhenSpeaking: boolean;
}

export type FrameShape = "circle" | "rounded" | "rectangle";

export interface PresentationSettings {
  /** Default = "call": framed window like a video call. Desktop also supports "overlay". */
  mode: "call" | "overlay";
  frame: FrameShape;
  background: { type: "color"; color: string } | { type: "image"; image: AssetRef; fit: "cover" | "contain" };
  /** How dialogue is shown when text is visible. */
  textStyle: "bubble" | "popup" | "subtitle";
  /** Overlay mode: scale of the full-body render relative to screen height. */
  overlayScale: number;
}

// ───────────────────────────── Companion ─────────────────────────────

export interface Companion {
  /** Format version of this object, for migrations. */
  schema: 1;
  id: ID;
  createdAt: string;
  updatedAt: string;
  character: CharacterDefinition;
  avatars: Avatar[];
  activeAvatarId: ID | null;
  voice: VoiceSettings;
  presentation: PresentationSettings;
  /** IDs of lorebooks in the shared library this companion uses. */
  lorebookIds: ID[];
  /** Lorebook embedded in an imported card; kept local unless the user promotes it. */
  embeddedLorebook: Lorebook | null;
  /** Per-companion LLM override; null = use the app default. */
  llmProfileId: ID | null;
  behaviour: CompanionBehaviour;
  /** Where this companion came from (for attribution). */
  source: { kind: "created" | "ccv1" | "ccv2" | "ccv3" | "cypal"; origin?: string };
}

export interface CompanionBehaviour {
  fourthWallAware: boolean;
  /** Probability (0–1) per eligible turn that a fourth-wall remark is encouraged. */
  fourthWallFrequency: number;
  /** Whether this companion may start conversations with other on-screen companions. */
  autonomousChat: boolean;
  /** Seconds of user idle time before the companion may speak unprompted. 0 = never. */
  idleChatterSeconds: number;
}

// ───────────────────────────── Lorebooks ─────────────────────────────

export type LorePosition =
  | "before_char"
  | "after_char"
  | "before_examples"
  | "after_examples"
  | "top_of_history"
  | "at_depth";

export interface LoreEntry {
  id: ID;
  /** Human label (CCv3 `name`/`comment`). */
  name: string;
  keys: string[];
  /** Secondary keys; used with `selective` + `selectiveLogic`. */
  secondaryKeys: string[];
  selective: boolean;
  selectiveLogic: "and_any" | "and_all" | "not_any" | "not_all";
  content: string;
  enabled: boolean;
  /** Always inject regardless of keys. */
  constant: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  /** Keys are regexes (`/pattern/flags`) when true or when the key is wrapped in slashes. */
  useRegex: boolean;
  /** Higher = inserted closer to the end of its slot; also used for budget priority. */
  insertionOrder: number;
  /** Higher priority survives token-budget trimming first. */
  priority: number;
  position: LorePosition;
  /** For `at_depth`: number of messages from the end of history. */
  depth: number;
  /** Override for how many recent messages to scan; null = lorebook default. */
  scanDepth: number | null;
  /** Probability 0–100 that a triggered entry is actually used. */
  probability: number;
  /** Optional: restrict entry to these companion IDs (empty = all). */
  characterFilter: ID[];
  /** Turns the entry stays active after triggering. */
  sticky: number;
  /** Turns the entry is suppressed after leaving the active state. */
  cooldown: number;
  extensions: Record<string, unknown>;
}

export interface Lorebook {
  schema: 1;
  id: ID;
  name: string;
  description: string;
  scanDepth: number;
  /** Approximate token budget for all entries from this book. */
  tokenBudget: number;
  /** Let activated entries' content trigger further entries. */
  recursive: boolean;
  maxRecursionSteps: number;
  entries: LoreEntry[];
  extensions: Record<string, unknown>;
}

// ───────────────────────────── Chat ─────────────────────────────

export type SpeakerRole = "user" | "companion" | "system" | "narrator";

export interface ChatMessage {
  id: ID;
  role: SpeakerRole;
  /** Companion ID when role === "companion". */
  speakerId?: ID;
  /** Display name at the time of sending. */
  name: string;
  /** Text with performance tags stripped. */
  text: string;
  /** Raw model output (tags intact) for regeneration / debugging. */
  raw?: string;
  expression?: Expression;
  actions?: Action[];
  /** Was this produced without direct user prompting (companion↔companion, idle). */
  autonomous?: boolean;
  /** Swipes / alternate generations. */
  alternates?: string[];
  attachments?: { kind: "screen" | "webcam" | "image"; description?: string; dataUrl?: string }[];
  createdAt: string;
}

export interface ChatSession {
  id: ID;
  /** Up to 3 companions on screen at once. */
  companionIds: ID[];
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Lorebook sticky/cooldown timers per entry id. */
  loreState: Record<ID, { stickyLeft: number; cooldownLeft: number }>;
}

export const MAX_ON_SCREEN = 3;
