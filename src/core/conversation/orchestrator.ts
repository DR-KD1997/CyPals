/**
 * Conversation orchestrator: runs a chat between the user and up to three
 * on-screen companions.
 *
 *  - Who answers the user: companions named in the message (in order), else the
 *    one that has gone longest without speaking.
 *  - Autonomous chat: after a companion speaks, another on-screen companion may
 *    reply to it (chance + chain limit), so characters converse with each other.
 *    Any user input interrupts the chain.
 *  - Idle chatter: after a companion's idle threshold, it may speak unprompted
 *    (to the user, or to another companion).
 *  - Each companion uses its own LLM profile, lorebooks, Fourth Wall setting.
 *
 * The class is UI-agnostic: it emits events that the avatar stage, speech
 * bubbles and TTS pipeline subscribe to.
 */
import type { ChatMessage, ChatSession, Companion, Expression, ID, Lorebook } from "../types";
import { MAX_ON_SCREEN } from "../types";
import type { LLMProfile, LLMProvider, PromptImage } from "../llm/types";
import { buildPrompt, speakerBooks, type UserPersona } from "../llm/prompt";
import { activateLore } from "../lorebook/engine";
import { parsePerformance, stripTagsForDisplay, type ParsedPerformance } from "../expressions";
import { createFourthWallScheduler, type DeviceContext, type FourthWallScheduler } from "../fourthWall";
import { nowIso, uid } from "../util";

export interface OrchestratorSettings {
  /** Chance (0–1) that another companion responds after a companion speaks. */
  autonomyChance: number;
  /** Maximum consecutive companion-only turns before waiting for the user. */
  maxAutonomousChain: number;
  /** Pause between autonomous turns so the user can read / listen (ms). */
  autonomousDelayMs: number;
  mainPrompt: string;
  /** Use <expr>/<act> tags (disable for models that handle them badly). */
  performanceTags: boolean;
}

export const DEFAULT_ORCHESTRATOR_SETTINGS: OrchestratorSettings = {
  autonomyChance: 0.55,
  maxAutonomousChain: 4,
  autonomousDelayMs: 1200,
  mainPrompt: "",
  performanceTags: true,
};

export interface OrchestratorDeps {
  getCompanion(id: ID): Companion | undefined;
  lorebooks(): Map<ID, Lorebook>;
  /** Provider + profile for a companion (its override or the app default). */
  providerFor(c: Companion): { provider: LLMProvider; profile: LLMProfile };
  user(): UserPersona;
  device(c: Companion): DeviceContext;
  /**
   * Capture consented vision input (screen windows / webcam). Must return []
   * unless the user has enabled it; the orchestrator never captures by itself.
   */
  captureVision?(): Promise<PromptImage[]>;
  /** Waits for TTS playback etc. before autonomous follow-ups. */
  waitForPlayback?(messageId: ID): Promise<void>;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type OrchestratorEvent =
  | { type: "turn:start"; messageId: ID; speakerId: ID; autonomous: boolean }
  | { type: "turn:delta"; messageId: ID; speakerId: ID; displayText: string }
  | { type: "turn:end"; message: ChatMessage; performance: ParsedPerformance }
  | { type: "turn:error"; speakerId: ID; error: Error }
  | { type: "expression"; speakerId: ID; expression: Expression }
  | { type: "session"; session: ChatSession };

type Listener = (e: OrchestratorEvent) => void;

export class TooManyCompanionsError extends Error {
  constructor() {
    super(`At most ${MAX_ON_SCREEN} companions can be on screen at once.`);
  }
}

export class ConversationOrchestrator {
  private listeners = new Set<Listener>();
  private abort: AbortController | null = null;
  private chainToken = 0;
  private busy = false;
  private fourthWall: FourthWallScheduler;
  private random: () => number;
  private sleep: (ms: number) => Promise<void>;
  private lastExpression = new Map<ID, Expression>();
  private idleFired = new Set<ID>();
  settings: OrchestratorSettings;

  constructor(
    public session: ChatSession,
    private deps: OrchestratorDeps,
    settings: Partial<OrchestratorSettings> = {},
  ) {
    this.settings = { ...DEFAULT_ORCHESTRATOR_SETTINGS, ...settings };
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fourthWall = createFourthWallScheduler(this.random);
  }

  static newSession(companionIds: ID[] = []): ChatSession {
    if (companionIds.length > MAX_ON_SCREEN) throw new TooManyCompanionsError();
    const t = nowIso();
    return { id: uid("chat"), companionIds: [...companionIds], messages: [], createdAt: t, updatedAt: t, loreState: {} };
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: OrchestratorEvent): void {
    for (const l of this.listeners) l(e);
  }

  get isBusy(): boolean {
    return this.busy;
  }

  companions(): Companion[] {
    return this.session.companionIds.map((id) => this.deps.getCompanion(id)).filter((c): c is Companion => !!c);
  }

  // ─────────── roster ───────────

  addCompanion(id: ID, greet = true): void {
    if (this.session.companionIds.includes(id)) return;
    if (this.session.companionIds.length >= MAX_ON_SCREEN) throw new TooManyCompanionsError();
    this.session.companionIds.push(id);
    const c = this.deps.getCompanion(id);
    if (greet && c?.character.firstMessage && !this.session.messages.some((m) => m.speakerId === id)) {
      const parsed = parsePerformance(this.macro(c, c.character.firstMessage));
      this.appendMessage({
        id: uid("msg"), role: "companion", speakerId: id, name: this.nameOf(c), text: parsed.text,
        raw: c.character.firstMessage, expression: parsed.finalExpression, actions: parsed.actions, createdAt: nowIso(),
      }, parsed);
    }
    this.touch();
  }

  removeCompanion(id: ID): void {
    this.session.companionIds = this.session.companionIds.filter((x) => x !== id);
    this.touch();
  }

  // ─────────── user input ───────────

  /** Stops any generation in progress and cancels the autonomous chain. */
  interrupt(): void {
    this.chainToken++;
    this.abort?.abort();
    this.abort = null;
  }

  async sendUserMessage(text: string, opts: { withVision?: boolean } = {}): Promise<void> {
    this.interrupt();
    // Let the interrupted turn record its partial reply before the user's message.
    await this.inflight;
    this.idleFired.clear();
    const user = this.deps.user();
    const msg: ChatMessage = { id: uid("msg"), role: "user", name: user.name, text, createdAt: nowIso() };
    const images = opts.withVision && this.deps.captureVision ? await this.deps.captureVision() : [];
    if (images.length) msg.attachments = images.map((i) => ({ kind: i.label?.startsWith("Webcam") ? "webcam" : "screen", description: i.label }));
    this.appendMessage(msg);

    const token = this.chainToken;
    const responders = this.pickResponders(text);
    let last: Companion | null = null;
    for (const c of responders) {
      if (token !== this.chainToken) return;
      const ok = await this.generateTurn(c, { images });
      if (!ok) return;
      last = c;
    }
    if (last) await this.runAutonomousChain(last, token);
  }

  /** Who answers a user message. */
  pickResponders(text: string): Companion[] {
    const present = this.companions();
    if (present.length <= 1) return present;
    const lower = text.toLowerCase();
    const mentioned = present
      .map((c) => ({ c, idx: this.mentionIndex(lower, c) }))
      .filter((x) => x.idx >= 0)
      .sort((a, b) => a.idx - b.idx)
      .map((x) => x.c);
    if (mentioned.length) return mentioned;
    return [this.leastRecentSpeaker(present)];
  }

  private mentionIndex(lowerText: string, c: Companion): number {
    const names = [c.character.name, c.character.nickname].filter(Boolean).map((n) => n.toLowerCase());
    let best = -1;
    for (const n of names) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
      const m = re.exec(lowerText);
      if (m && (best < 0 || m.index < best)) best = m.index;
    }
    return best;
  }

  private leastRecentSpeaker(cands: Companion[]): Companion {
    const lastIdx = (id: ID) => {
      for (let i = this.session.messages.length - 1; i >= 0; i--) if (this.session.messages[i].speakerId === id) return i;
      return -1;
    };
    return [...cands].sort((a, b) => lastIdx(a.id) - lastIdx(b.id))[0];
  }

  // ─────────── autonomy ───────────

  private async runAutonomousChain(prev: Companion, token: number): Promise<void> {
    for (let i = 0; i < this.settings.maxAutonomousChain; i++) {
      if (token !== this.chainToken) return;
      const others = this.companions().filter((c) => c.id !== prev.id && c.behaviour.autonomousChat);
      if (!others.length) return;
      if (this.random() >= this.settings.autonomyChance) return;
      const lastText = this.session.messages[this.session.messages.length - 1]?.text.toLowerCase() ?? "";
      const named = others.filter((c) => this.mentionIndex(lastText, c) >= 0);
      const next = named[0] ?? others[Math.floor(this.random() * others.length)];
      const lastMsg = this.session.messages[this.session.messages.length - 1];
      if (lastMsg && this.deps.waitForPlayback) await this.deps.waitForPlayback(lastMsg.id);
      await this.sleep(this.settings.autonomousDelayMs);
      if (token !== this.chainToken) return;
      const ok = await this.generateTurn(next, { autonomous: { addressee: this.nameOf(prev), kind: "reply" } });
      if (!ok) return;
      prev = next;
    }
  }

  /**
   * Call periodically with seconds since the user last interacted.
   * Returns true if a companion was prompted to speak.
   */
  async idleTick(idleSeconds: number): Promise<boolean> {
    if (this.busy) return false;
    const present = this.companions();
    const eligible = present.filter(
      (c) => c.behaviour.idleChatterSeconds > 0 && idleSeconds >= c.behaviour.idleChatterSeconds && !this.idleFired.has(c.id),
    );
    if (!eligible.length) return false;
    const speaker = eligible[Math.floor(this.random() * eligible.length)];
    this.idleFired.add(speaker.id);
    const partners = present.filter((c) => c.id !== speaker.id && c.behaviour.autonomousChat);
    const token = ++this.chainToken;
    if (partners.length && this.random() < 0.6) {
      const target = partners[Math.floor(this.random() * partners.length)];
      const ok = await this.generateTurn(speaker, { autonomous: { addressee: this.nameOf(target), kind: "initiate" } });
      if (ok) await this.runAutonomousChain(speaker, token);
    } else {
      await this.generateTurn(speaker, { autonomous: { addressee: this.deps.user().name, kind: "idle" } });
    }
    return true;
  }

  /** Re-generate the last companion message, keeping the old one as an alternate (swipe). */
  async regenerateLast(): Promise<void> {
    this.interrupt();
    await this.inflight;
    const idx = findLastIndex(this.session.messages, (m) => m.role === "companion");
    if (idx < 0) return;
    const old = this.session.messages[idx];
    const c = old.speakerId ? this.deps.getCompanion(old.speakerId) : undefined;
    if (!c) return;
    this.session.messages.splice(idx);
    const ok = await this.generateTurn(c, { autonomous: old.autonomous ? { addressee: this.deps.user().name, kind: "reply" } : undefined });
    if (ok) {
      const fresh = this.session.messages[this.session.messages.length - 1];
      fresh.alternates = [...(old.alternates ?? []), old.raw ?? old.text];
    }
  }

  // ─────────── generation ───────────

  private inflight: Promise<unknown> = Promise.resolve();

  private generateTurn(
    speaker: Companion,
    opts: { images?: PromptImage[]; autonomous?: { addressee: string; kind: "reply" | "initiate" | "idle" } },
  ): Promise<boolean> {
    const p = this.runTurn(speaker, opts);
    this.inflight = p.catch(() => false);
    return p;
  }

  private async runTurn(
    speaker: Companion,
    opts: { images?: PromptImage[]; autonomous?: { addressee: string; kind: "reply" | "initiate" | "idle" } },
  ): Promise<boolean> {
    const { provider, profile } = this.deps.providerFor(speaker);
    const user = this.deps.user();
    const others = this.companions().filter((c) => c.id !== speaker.id);
    const lore = activateLore({
      books: speakerBooks(speaker, this.deps.lorebooks()),
      messages: this.session.messages.map((m) => ({ name: m.name, text: m.text })),
      speakerId: speaker.id,
      state: this.session.loreState,
      random: this.random,
    });
    const turnIndex = this.session.messages.length;
    const fw = speaker.behaviour.fourthWallAware
      ? { ctx: this.deps.device(speaker), nudge: this.fourthWall.shouldNudge(speaker, turnIndex), random: this.random }
      : undefined;
    const images = profile.vision ? opts.images : undefined;
    const prompt = buildPrompt({
      speaker, others, user, history: this.session.messages, lore,
      mainPrompt: this.settings.mainPrompt,
      performance: this.settings.performanceTags && this.hasExpressiveAvatar(speaker),
      fourthWall: fw,
      contextTokens: profile.contextTokens,
      replyTokens: profile.sampling.maxTokens,
      images,
      autonomous: opts.autonomous,
    });

    const stop = [...profile.sampling.stop, `\n${user.name}:`, ...others.map((o) => `\n${this.nameOf(o)}:`)];
    const messageId = uid("msg");
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    this.emit({ type: "turn:start", messageId, speakerId: speaker.id, autonomous: !!opts.autonomous });

    let raw = "";
    try {
      const res = await provider.generate({
        messages: prompt.messages,
        sampling: { ...profile.sampling, stop },
        signal: abort.signal,
        onDelta: (d) => {
          raw += d;
          this.emit({ type: "turn:delta", messageId, speakerId: speaker.id, displayText: cleanReply(stripTagsForDisplay(raw), speaker, user.name, others) });
        },
      });
      raw = res.text || raw;
    } catch (err) {
      this.busy = false;
      if (abort.signal.aborted) {
        if (raw.trim()) this.finishTurn(messageId, speaker, raw, opts.autonomous, true);
        return false;
      }
      this.emit({ type: "turn:error", speakerId: speaker.id, error: err as Error });
      return false;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
    this.busy = false;
    this.session.loreState = lore.nextState;
    return this.finishTurn(messageId, speaker, raw, opts.autonomous, false);
  }

  private finishTurn(
    messageId: ID,
    speaker: Companion,
    raw: string,
    autonomous: { addressee: string } | undefined,
    partial: boolean,
  ): boolean {
    const user = this.deps.user();
    const others = this.companions().filter((c) => c.id !== speaker.id);
    const cleaned = cleanReply(raw, speaker, user.name, others);
    const perf = parsePerformance(cleaned, this.lastExpression.get(speaker.id) ?? "neutral");
    if (!perf.text.trim()) {
      this.emit({ type: "turn:error", speakerId: speaker.id, error: new Error("The model returned an empty reply.") });
      return false;
    }
    const msg: ChatMessage = {
      id: messageId, role: "companion", speakerId: speaker.id, name: this.nameOf(speaker),
      text: perf.text + (partial ? "—" : ""), raw, expression: perf.finalExpression, actions: perf.actions,
      autonomous: !!autonomous, createdAt: nowIso(),
    };
    this.appendMessage(msg, perf);
    return true;
  }

  private appendMessage(msg: ChatMessage, perf?: ParsedPerformance): void {
    this.session.messages.push(msg);
    this.touch();
    if (perf && msg.speakerId) {
      this.lastExpression.set(msg.speakerId, perf.finalExpression);
      this.emit({ type: "turn:end", message: msg, performance: perf });
      this.emit({ type: "expression", speakerId: msg.speakerId, expression: perf.finalExpression });
    }
  }

  private touch(): void {
    this.session.updatedAt = nowIso();
    this.emit({ type: "session", session: this.session });
  }

  private hasExpressiveAvatar(c: Companion): boolean {
    return c.avatars.length > 0;
  }

  private nameOf(c: Companion): string {
    return c.character.nickname || c.character.name;
  }

  private macro(c: Companion, s: string): string {
    return s.replace(/\{\{\s*char\s*\}\}/gi, this.nameOf(c)).replace(/\{\{\s*user\s*\}\}/gi, this.deps.user().name);
  }
}

/**
 * Tidy a raw model reply: drop a leading "Name:" the model added for itself and
 * cut off anything where it started writing the user's or another character's line.
 */
export function cleanReply(raw: string, speaker: Companion, userName: string, others: Companion[]): string {
  let s = raw.replace(/^\s+/, "");
  const self = [speaker.character.name, speaker.character.nickname].filter(Boolean);
  for (const n of self) {
    const re = new RegExp(`^${escapeRe(n)}\\s*:\\s*`, "i");
    s = s.replace(re, "");
  }
  const foreign = [userName, ...others.flatMap((o) => [o.character.name, o.character.nickname])].filter(Boolean);
  for (const n of foreign) {
    const re = new RegExp(`(^|\\n)\\s*${escapeRe(n)}\\s*:`, "i");
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index);
  }
  return s.trimEnd();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}
