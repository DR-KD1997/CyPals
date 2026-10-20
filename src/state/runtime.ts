/**
 * Runtime: wires the conversation orchestrator to the store, TTS playback,
 * live avatar state, consented vision capture, idle chatter and the overlay window.
 */
import { ConversationOrchestrator, type OrchestratorEvent } from "../core/conversation/orchestrator";
import { createProvider } from "../core/llm/providers";
import { createTTS, speakableText, type TTSEngine } from "../core/tts/providers";
import type { PromptImage } from "../core/llm/types";
import type { Companion, ID, InteractionMode, Persona } from "../core/types";
import { familiarityText, personaForCompanions, relationshipKey, sessionPersona } from "../core/personas";
import { transcribe } from "../core/stt/providers";
import type { Segment } from "../core/expressions";
import { platform } from "../platform";
import { useStore } from "./store";
import { live, pushAction, snapshotLive, subscribeAnyLive, updateLive } from "./live";
import { playAudio, simulateSpeech, type PlaybackHandle } from "./audio";
import { grabWebcamFrame, releaseWebcam } from "./webcam";

const BUBBLE_LINGER_MS = 4500;

class Runtime {
  orch: ConversationOrchestrator | null = null;
  private playing = new Map<ID, PlaybackHandle>();
  private playbackDone = new Map<ID, Promise<void>>();
  private hideTimers = new Map<ID, ReturnType<typeof setTimeout>>();
  private lastActivity = Date.now();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private ttsCache = new Map<string, TTSEngine>();
  captureListeners = new Set<(what: string) => void>();

  start(): void {
    if (this.orch) return;
    const store = useStore.getState();
    this.orch = new ConversationOrchestrator(
      store.session,
      {
        getCompanion: (id) => useStore.getState().companions[id],
        lorebooks: () => new Map(Object.entries(useStore.getState().lorebooks)),
        providerFor: (c) => this.providerFor(c),
        user: () => this.persona(),
        familiarity: (c) => {
          const { relationships } = useStore.getState();
          const p = this.persona();
          return familiarityText(relationships[relationshipKey(c.id, p.id)], p.name);
        },
        device: (c) => this.deviceContext(c),
        captureVision: () => this.captureVision(),
        waitForPlayback: (id) => this.playbackDone.get(id) ?? Promise.resolve(),
      },
      store.settings.orchestrator,
    );
    this.orch.on((e) => this.onEvent(e));
    useStore.subscribe((s, prev) => {
      if (this.orch && s.settings.orchestrator !== prev.settings.orchestrator) this.orch.settings = { ...s.settings.orchestrator };
      if (this.orch && s.session.id !== this.orch.session.id) this.orch.session = s.session;
      if (this.orch && s.session.companionIds !== this.orch.session.companionIds) this.orch.session.companionIds = [...s.session.companionIds];
      if (!s.settings.vision.webcam.enabled && prev.settings.vision.webcam.enabled) releaseWebcam();
      if (s.companions !== prev.companions || s.session.companionIds !== prev.session.companionIds) this.syncOverlay();
    });
    this.syncOverlay();
    this.idleTimer = setInterval(() => {
      const idle = (Date.now() - this.lastActivity) / 1000;
      void this.orch?.idleTick(idle);
    }, 5000);
    // Mirror live state to the overlay window.
    let pending = false;
    subscribeAnyLive(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        void platform().emit("cypals://live", snapshotLive());
      }, 50);
    });
    setInterval(() => {
      if ([...this.playing.keys()].length) void platform().emit("cypals://amp", Object.fromEntries([...this.playing.keys()].map((id) => [id, live(id).amplitude])));
    }, 50);
  }

  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.orch?.interrupt();
    this.orch = null;
  }

  /** Open the desktop overlay while any on-call companion is set to appear there. */
  private overlayWanted = false;
  private syncOverlay(): void {
    const overlay = platform().overlay;
    if (!overlay) return;
    const { session, companions } = useStore.getState();
    const want = session.companionIds.some((id) => companions[id]?.presentation.mode === "overlay");
    if (want === this.overlayWanted) return;
    this.overlayWanted = want;
    void (want ? overlay.open() : overlay.close()).catch((e) => useStore.getState().notify("error", `Desktop overlay: ${(e as Error).message}`));
  }

  markActivity(): void {
    this.lastActivity = Date.now();
  }

  async send(text: string, withVision: boolean, voiceSeconds?: number): Promise<void> {
    this.markActivity();
    this.stopAllSpeech();
    await this.orch?.sendUserMessage(text, { withVision, voiceSeconds });
  }

  /** The persona the user is playing in the current chat. */
  persona(): Persona {
    const { settings, session, companions } = useStore.getState();
    return sessionPersona(settings, session, session.companionIds.map((id) => companions[id]).filter(Boolean));
  }

  setPersona(id: ID): void {
    if (!this.orch) return;
    this.orch.session.personaId = id;
    useStore.getState().setSession(this.orch.session);
  }

  /** Switch Chat / Call / Roleplay. Before anyone has said anything, greetings are redone to suit the new mode. */
  async setMode(mode: InteractionMode): Promise<void> {
    if (!this.orch) return;
    this.interrupt();
    await new Promise((r) => setTimeout(r, 0));
    const s = this.orch.session;
    if (s.mode === mode) return;
    s.mode = mode;
    void useStore.getState().updateSettings({ lastMode: mode });
    const untouched = !s.messages.some((m) => m.role === "user");
    if (untouched) s.messages = [];
    useStore.getState().setSession(s);
    if (untouched) await this.orch.regreetAll().catch((e) => useStore.getState().notify("error", (e as Error).message));
  }

  /** Transcribe recorded speech with the configured speech-to-text engine. */
  async transcribe(wav: Uint8Array): Promise<string> {
    const { settings, session, companions } = useStore.getState();
    const stt = settings.stt;
    if (!stt) throw new Error("Set up speech-to-text in Settings → Voices to use voice input.");
    const geminiKey = settings.llmProfiles.find((p) => p.kind === "gemini" && p.apiKey)?.apiKey ?? "";
    const names = [this.persona().name, ...session.companionIds.map((id) => companions[id]?.character.name).filter(Boolean)];
    return transcribe({ ...stt, apiKey: stt.apiKey || (stt.kind === "gemini" ? geminiKey : "") }, { wav, hint: names.join(", ") }, platform().fetch);
  }

  interrupt(): void {
    this.orch?.interrupt();
    this.stopAllSpeech();
  }

  addCompanion(id: ID): void {
    if (!this.orch) return;
    const s = this.orch.session;
    // A chat nobody has spoken in yet adopts the persona this companion prefers.
    if (!s.messages.some((m) => m.role === "user")) {
      const { settings, companions } = useStore.getState();
      const c = companions[id];
      const others = s.companionIds.map((x) => companions[x]).filter(Boolean);
      if (c) s.personaId = personaForCompanions(settings, [...others, c]).id;
    }
    const p = this.orch.addCompanion(id);
    useStore.getState().setSession(this.orch.session);
    p.catch((e) => useStore.getState().notify("error", (e as Error).message));
  }

  removeCompanion(id: ID): void {
    this.orch?.removeCompanion(id);
    useStore.getState().setSession(this.orch!.session);
  }

  newChat(): void {
    this.interrupt();
    const old = useStore.getState().session;
    useStore.getState().closeConversations(old, this.persona().id);
    const s = ConversationOrchestrator.newSession();
    s.mode = old.mode ?? useStore.getState().settings.lastMode;
    s.personaId = old.personaId;
    if (this.orch) {
      this.orch.session = s;
      useStore.getState().setSession(s);
      for (const id of old.companionIds) this.addCompanion(id);
    }
    useStore.getState().setSession(s);
  }

  // ───────── providers ─────────

  private providerFor(c: Companion) {
    const { settings } = useStore.getState();
    const profile =
      settings.llmProfiles.find((p) => p.id === c.llmProfileId) ??
      settings.llmProfiles.find((p) => p.id === settings.defaultProfileId) ??
      settings.llmProfiles[0];
    if (!profile) throw new Error("No LLM connection configured. Add one in Settings → Models.");
    return { provider: createProvider(profile, platform().fetch), profile };
  }

  private ttsFor(c: Companion): TTSEngine | null {
    const ep = useStore.getState().settings.ttsEndpoints.find((t) => t.id === c.voice.ttsEndpointId);
    if (!ep) return null;
    const key = JSON.stringify(ep);
    let eng = this.ttsCache.get(key);
    if (!eng) {
      eng = createTTS(ep, platform().fetch);
      this.ttsCache.set(key, eng);
    }
    return eng;
  }

  private deviceContext(c: Companion) {
    const { settings, session, companions } = useStore.getState();
    const p = platform();
    const profile = this.providerFor(c).profile;
    return {
      os: p.osName,
      formFactor: p.isDesktop ? ("desktop" as const) : ("mobile" as const),
      presentation: c.presentation.mode,
      localTime: new Date().toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" }),
      others: session.companionIds.filter((id) => id !== c.id).map((id) => companions[id]?.character.name).filter(Boolean),
      modelName: settings.shareModelNameWithCharacters ? profile.model : undefined,
    };
  }

  // ───────── vision (consented only) ─────────

  private async captureVision(): Promise<PromptImage[]> {
    const { vision } = useStore.getState().settings;
    const out: PromptImage[] = [];
    if (vision.screen.enabled && platform().vision) {
      const frames = await platform().vision!.captureAllowed();
      for (const f of frames) out.push({ mime: f.mime, data: f.data, label: `Screen: ${f.label}` });
      if (frames.length) this.captureListeners.forEach((fn) => fn(`screen (${frames.map((f) => f.label).join(", ")})`));
    }
    if (vision.webcam.enabled) {
      try {
        const f = await grabWebcamFrame(vision.webcam.deviceId, vision.webcam.maxWidth);
        out.push({ ...f, label: "Webcam" });
        this.captureListeners.forEach((fn) => fn("webcam"));
      } catch (e) {
        useStore.getState().notify("error", `Webcam unavailable: ${(e as Error).message}`);
      }
    }
    return out;
  }

  // ───────── events → avatars, bubbles, voice ─────────

  private onEvent(e: OrchestratorEvent): void {
    switch (e.type) {
      case "session":
        useStore.getState().setSession(e.session);
        break;
      case "turn:start":
        this.stopSpeech(e.speakerId);
        updateLive(e.speakerId, { thinking: true, streaming: true, bubble: "", bubbleVisible: false });
        break;
      case "turn:delta": {
        const c = useStore.getState().companions[e.speakerId];
        const hideText = c && this.ttsFor(c) && c.voice.hideTextWhenSpeaking;
        if (!hideText) updateLive(e.speakerId, { thinking: false, bubble: e.displayText, bubbleVisible: true });
        break;
      }
      case "turn:end": {
        const id = e.message.speakerId!;
        useStore.getState().noteMessage(id, this.persona().id);
        updateLive(id, { thinking: false, streaming: false });
        this.playbackDone.set(e.message.id, this.perform(id, e.performance.segments));
        break;
      }
      case "turn:error":
        updateLive(e.speakerId, { thinking: false, streaming: false });
        useStore.getState().notify("error", e.error.message);
        break;
      case "expression":
        break; // applied per segment during performance
    }
  }

  /** Play segments in order: set expression, trigger gestures, speak (or flap), update bubble. */
  private async perform(id: ID, segments: Segment[]): Promise<void> {
    const c = useStore.getState().companions[id];
    if (!c) return;
    if ((useStore.getState().session.mode ?? "roleplay") === "chat") {
      // Texting: nothing is spoken; the face still reacts and gestures still play.
      for (const sg of segments) {
        updateLive(id, { expression: sg.expression });
        sg.actions.forEach((a) => pushAction(id, a));
        await new Promise((r) => setTimeout(r, Math.min(1500, 250 + sg.text.length * 12)));
      }
      return;
    }
    const tts = this.ttsFor(c);
    const hideText = !!tts && c.voice.hideTextWhenSpeaking;
    const reduceMotion = useStore.getState().settings.reduceMotion;
    clearTimeout(this.hideTimers.get(id));
    let shown = "";
    // Pre-fetch audio for all segments in parallel so playback is gapless.
    const audio = tts
      ? segments.map((s) => {
          const text = speakableText(s.text);
          return text ? tts.synthesize({ text, voice: c.voice.voiceId, speed: c.voice.speed }).catch((err) => err as Error) : Promise.resolve(null);
        })
      : [];
    updateLive(id, { speaking: true });
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      updateLive(id, { expression: s.expression });
      s.actions.forEach((a) => pushAction(id, a));
      shown = shown ? `${shown} ${s.text}` : s.text;
      if (!hideText) updateLive(id, { bubble: shown, bubbleVisible: true });
      if (!s.text) continue;
      let handle: PlaybackHandle;
      const res = tts ? await audio[i] : null;
      if (res instanceof Error) {
        useStore.getState().notify("error", res.message);
        handle = simulateSpeech(s.text, (a) => updateLive(id, { amplitude: a }), reduceMotion);
      } else if (res && res.audio) {
        handle = playAudio(res.audio, (a) => updateLive(id, { amplitude: a }));
      } else if (res && !res.audio) {
        continue; // system voice already spoke synchronously
      } else {
        handle = simulateSpeech(s.text, (a) => updateLive(id, { amplitude: a }), reduceMotion);
      }
      this.playing.set(id, handle);
      await handle.done;
      if (this.playing.get(id) !== handle) return; // interrupted
    }
    this.playing.delete(id);
    updateLive(id, { speaking: false, amplitude: 0 });
    if (hideText) return;
    this.hideTimers.set(id, setTimeout(() => updateLive(id, { bubbleVisible: false }), BUBBLE_LINGER_MS));
  }

  private stopSpeech(id: ID): void {
    const h = this.playing.get(id);
    this.playing.delete(id);
    h?.stop();
    updateLive(id, { speaking: false, amplitude: 0 });
  }

  private stopAllSpeech(): void {
    for (const id of [...this.playing.keys()]) this.stopSpeech(id);
  }
}

export const runtime = new Runtime();
