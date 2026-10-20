/**
 * Prompt assembly for one companion's turn.
 *
 * Order (mirrors SillyTavern so imported cards behave as their authors intended):
 *   main prompt (or card system_prompt; `{{original}}` expands to the default)
 *   lore[before_char] → description / personality / scenario → lore[after_char]
 *   user persona → other on-screen characters → performance tags → fourth wall
 *   lore[before_examples] → example dialogue → lore[after_examples]
 *   lore[top_of_history] → chat history (lore[at_depth] spliced in) → post-history
 *
 * History is trimmed from the oldest end to fit the profile's context window.
 */
import type { ChatMessage, Companion, Lorebook } from "../types";
import type { ActivationResult } from "../lorebook/engine";
import type { PromptImage, PromptMessage } from "./types";
import { estimateTokens, substituteMacros } from "../util";
import { performanceInstructions } from "../expressions";
import { fourthWallNudge, fourthWallSystemBlock, type DeviceContext } from "../fourthWall";
import { ACTIONS, type InteractionMode } from "../types";
import { stripAsterisks } from "../text";

export const DEFAULT_MAIN_PROMPT =
  "Write {{char}}'s next reply in a fictional, ongoing conversation with {{user}}. " +
  "Stay in character, be vivid and responsive, and keep replies conversational — usually 1–4 sentences, since they are spoken aloud by an animated avatar. " +
  "Use *asterisks* sparingly for brief actions. Never write {{user}}'s lines.";

/** Chat mode: the conversation is text messaging. */
export const CHAT_MODE_PROMPT =
  "You are {{char}}, texting with {{user}} in a messaging app. Reply exactly as {{char}} would type a text message: natural, casual and usually short. " +
  "You may send a few short messages in a row; separate them with a blank line. " +
  "Write only the words {{char}} types — no narration, no actions in asterisks, no stage directions, no describing yourself in the third person. " +
  "Emoji, abbreviations and casual punctuation are fine when they suit {{char}}. Never write {{user}}'s messages.";

/** Call mode: a spoken voice/video call. */
export const CALL_MODE_PROMPT =
  "You are {{char}}, on a live voice call with {{user}}. Reply with only what {{char}} says out loud: natural spoken language, usually one to three sentences, with contractions and the occasional filler word if it suits {{char}}. " +
  "No narration, no actions in asterisks, no emoji, no lists, no formatting — everything you write is spoken by {{char}}'s voice. " +
  "{{user}}'s lines are transcribed from speech, so read past small recognition errors. Never speak for {{user}}.";

const MODE_REMINDER: Record<Exclude<InteractionMode, "roleplay">, string> = {
  chat: "[Reply as {{char}}'s text message(s) only — no narration or *actions*.]",
  call: "[Reply with only {{char}}'s spoken words — no narration, *actions*, emoji or formatting.]",
};

export const GROUP_PROMPT =
  "Several characters share this conversation. Write ONLY {{char}}'s reply — never speak or act for {{user}} or the other characters. " +
  "Lines from others appear as 'Name: text'. Do not prefix your own reply with your name.";

export interface UserPersona {
  name: string;
  description: string;
}

export interface BuildPromptInput {
  speaker: Companion;
  others: Companion[];
  user: UserPersona;
  history: ChatMessage[];
  lore: ActivationResult | null;
  mainPrompt?: string;
  /** Avatar supports expression/action tags. */
  performance: boolean;
  availableActions?: string[];
  fourthWall?: { ctx: DeviceContext; nudge: boolean; random?: () => number };
  /** Total context tokens and tokens reserved for the reply. */
  contextTokens: number;
  replyTokens: number;
  /** Consented vision frames attached to the newest turn. */
  images?: PromptImage[];
  /** When the speaker is replying to another companion rather than the user, or greeting. */
  autonomous?: { addressee: string; kind: "reply" | "initiate" | "idle" | "greeting" };
  /** Interaction mode; defaults to roleplay. Chat & call drop *asterisk* text everywhere. */
  mode?: InteractionMode;
  /** Mode-specific main prompts (override the built-in defaults). */
  modePrompts?: Partial<Record<"chat" | "call", string>>;
  /** For greetings: how well the speaker knows the user's persona. */
  familiarity?: string;
}

export interface BuiltPrompt {
  messages: PromptMessage[];
  /** Number of history messages that fit. */
  historyIncluded: number;
  estimatedTokens: number;
}

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { speaker, others, user } = input;
  const ch = speaker.character;
  const charName = ch.nickname || ch.name;
  const vars = { char: charName, user: user.name };
  const mode: InteractionMode = input.mode ?? "roleplay";
  const plain = mode !== "roleplay";
  // Chat & Call drop anything between asterisks from every card field, the lore and the history.
  const card = (s: string) => (plain ? stripAsterisks(s) : s);
  const sub = (s: string) => substituteMacros(card(s), vars);
  const loreText = (slot: keyof ActivationResult["bySlot"]) =>
    (input.lore?.bySlot[slot] ?? []).map((a) => sub(a.entry.content)).filter(Boolean).join("\n");

  const system: string[] = [];
  if (plain) {
    const modeMain = input.modePrompts?.[mode]?.trim() || (mode === "chat" ? CHAT_MODE_PROMPT : CALL_MODE_PROMPT);
    system.push(substituteMacros(modeMain, vars));
    // A card's system prompt is written for roleplay; keep its content but not its authority over format.
    if (ch.systemPrompt.trim()) push(system, `Notes from ${charName}'s creator (follow them except where they conflict with the format above):\n${sub(ch.systemPrompt.replace(/\{\{original\}\}/gi, ""))}`);
  } else {
    const main = input.mainPrompt?.trim() || DEFAULT_MAIN_PROMPT;
    system.push(sub(ch.systemPrompt.trim() ? ch.systemPrompt.replace(/\{\{original\}\}/gi, main) : main));
  }
  if (others.length) system.push(sub(GROUP_PROMPT));

  push(system, loreText("before_char"));
  const charBlock = [
    ch.description && `${charName}'s description:\n${sub(ch.description)}`,
    ch.personality && `${charName}'s personality: ${sub(ch.personality)}`,
    ch.scenario && `Scenario: ${sub(ch.scenario)}`,
  ].filter(Boolean).join("\n\n");
  push(system, charBlock);
  push(system, loreText("after_char"));

  // The persona is the user's own writing, not card text, so it is never stripped.
  if (user.description.trim()) push(system, `About ${user.name}:\n${substituteMacros(user.description, vars)}`);

  if (others.length) {
    const lines = others.map((o) => {
      const n = o.character.nickname || o.character.name;
      const summary = card(o.character.tagline || firstSentence(o.character.description) || firstSentence(o.character.personality));
      return `- ${n}${summary ? `: ${substituteMacros(summary, { char: n, user: user.name })}` : ""}`;
    });
    push(system, `Also present on screen:\n${lines.join("\n")}`);
  }

  if (input.performance) push(system, performanceInstructions(input.availableActions ?? [...ACTIONS]));
  if (input.fourthWall) push(system, fourthWallSystemBlock(speaker, input.fourthWall.ctx, user.name));

  push(system, loreText("before_examples"));
  const examples = formatExamples(sub(ch.exampleDialogue), charName, user.name);
  if (examples) push(system, `Example of how ${charName} talks (style reference only, not part of the conversation):\n${examples}`);
  push(system, loreText("after_examples"));
  push(system, loreText("top_of_history"));

  // ── post-history block ──
  const post: string[] = [];
  if (ch.postHistoryInstructions.trim()) post.push(sub(ch.postHistoryInstructions.replace(/\{\{original\}\}/gi, "")));
  if (input.autonomous) {
    const a = input.autonomous;
    const medium = mode === "chat" ? "text conversation" : mode === "call" ? "call" : "conversation";
    post.push(
      a.kind === "reply"
        ? `${user.name} is listening in. ${charName} is now replying to ${a.addressee}.`
        : a.kind === "initiate"
          ? `${charName} turns to ${a.addressee} and starts or continues a conversation with them. ${user.name} may chime in later.`
          : a.kind === "greeting"
            ? [
                `${charName} is starting a new ${medium} with ${user.name}. Write ${charName}'s opening ${mode === "chat" ? "message(s)" : "words"} in ${charName}'s own voice — not a scripted line — greeting ${user.name} the way ${charName} naturally would, given how well they know each other.`,
                input.familiarity ? `What ${charName} knows about their history with ${user.name}: ${input.familiarity}` : "",
                user.description.trim() ? `Let what ${charName} knows about ${user.name} shape the greeting.` : "",
              ].filter(Boolean).join("\n")
            : `${user.name} has been quiet for a while. ${charName} says something on their own initiative — a remark, a question, or a comment to ${a.addressee}.`,
    );
  }
  if (plain) post.push(substituteMacros(MODE_REMINDER[mode as "chat" | "call"], vars));
  if (input.fourthWall?.nudge) post.push(sub(fourthWallNudge(input.fourthWall.random)));

  const systemMsg: PromptMessage = { role: "system", content: system.filter(Boolean).join("\n\n") };
  const postMsg: PromptMessage | null = post.length ? { role: "system", content: post.join("\n") } : null;

  // ── history within budget ──
  const fixed = estimateTokens(systemMsg.content) + (postMsg ? estimateTokens(postMsg.content) : 0);
  const depthLore = (input.lore?.bySlot.at_depth ?? []).map((a) => ({ depth: a.entry.depth, text: sub(a.entry.content) }));
  const depthTokens = depthLore.reduce((n, d) => n + estimateTokens(d.text), 0);
  const imageTokens = (input.images?.length ?? 0) * 800;
  let budget = input.contextTokens - input.replyTokens - fixed - depthTokens - imageTokens;

  const rendered: PromptMessage[] = [];
  for (let i = input.history.length - 1; i >= 0; i--) {
    const m = toPromptMessage(input.history[i], speaker.id, others.length > 0, plain);
    if (!m.content) continue;
    const t = estimateTokens(m.content) + 4;
    if (t > budget && rendered.length > 0) break;
    budget -= t;
    rendered.unshift(m);
  }
  if (!rendered.length && ch.firstMessage && input.autonomous?.kind !== "greeting") {
    // Fresh chat: greeting is the opening line.
    rendered.push({ role: "assistant", content: sub(ch.firstMessage) });
  }

  // Splice depth lore: depth 0 = after the last message, depth N = N messages from the end.
  for (const d of [...depthLore].sort((a, b) => b.depth - a.depth)) {
    const at = Math.max(0, rendered.length - Math.max(0, d.depth));
    rendered.splice(at, 0, { role: "system", content: d.text });
  }

  // Attach images to the newest user-side message (or a dedicated one).
  if (input.images?.length) {
    const lastUserIdx = findLastIndex(rendered, (m) => m.role === "user");
    const note = `[${input.images.map((i) => i.label ?? "image").join(", ")} attached — shared with consent by ${user.name}]`;
    if (lastUserIdx >= 0) {
      rendered[lastUserIdx] = { ...rendered[lastUserIdx], content: `${rendered[lastUserIdx].content}\n${note}`, images: input.images };
    } else {
      rendered.push({ role: "user", content: note, images: input.images });
    }
  }

  const messages = [systemMsg, ...rendered, ...(postMsg ? [postMsg] : [])];
  if (messages[messages.length - 1].role === "assistant") {
    // Most chat APIs expect to answer a user turn.
    messages.push({ role: "user", content: input.autonomous ? "[Continue]" : `[${user.name} waits for ${charName} to continue]` });
  }
  return {
    messages,
    historyIncluded: rendered.filter((m) => m.role !== "system").length,
    estimatedTokens: messages.reduce((n, m) => n + estimateTokens(m.content), 0) + imageTokens,
  };
}

function toPromptMessage(m: ChatMessage, speakerId: string, group: boolean, plain: boolean): PromptMessage {
  const text = plain ? stripAsterisks(m.text) : m.text;
  if (m.role === "companion" && m.speakerId === speakerId) return { role: "assistant", content: text };
  if (m.role === "system" || m.role === "narrator") return { role: "system", content: text };
  // User lines and other companions' lines are input from the speaker's perspective.
  const voice = m.attachments?.some((a) => a.kind === "voice") ? " (voice note, transcribed)" : "";
  return { role: "user", content: group || m.role === "companion" ? `${m.name}${voice}: ${text}` : voice ? `[voice note] ${text}` : text };
}

function formatExamples(ex: string, char: string, user: string): string {
  if (!ex.trim()) return "";
  return ex
    .split(/<START>/i)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => block.replace(/^\{\{char\}\}:/gim, `${char}:`).replace(/^\{\{user\}\}:/gim, `${user}:`))
    .join("\n---\n");
}

function firstSentence(s: string): string {
  const m = /^[^.!?\n]{1,160}[.!?]?/.exec(s.trim());
  return m ? m[0].trim() : "";
}

function push(arr: string[], s: string): void {
  if (s && s.trim()) arr.push(s.trim());
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

/** Lorebooks that apply to the speaker (shared ones + embedded), deduplicated. */
export function speakerBooks(speaker: Companion, library: Map<string, Lorebook>): Lorebook[] {
  const out = new Map<string, Lorebook>();
  if (speaker.embeddedLorebook) out.set(speaker.embeddedLorebook.id, speaker.embeddedLorebook);
  for (const id of speaker.lorebookIds) {
    const lb = library.get(id);
    if (lb) out.set(lb.id, lb);
  }
  return [...out.values()];
}
