/**
 * App store (zustand). Persists to the platform store:
 *   companions/<id>   lorebooks/<id>   settings   session/current
 * API keys go to the platform secret store, keyed by profile id.
 */
import { create } from "zustand";
import type { Companion, ChatSession, Lorebook, ID } from "../core/types";
import { MAX_ON_SCREEN } from "../core/types";
import type { LLMProfile } from "../core/llm/types";
import { profileFromPreset } from "../core/llm/providers";
import type { TTSEndpoint } from "../core/tts/providers";
import { DEFAULT_VISION_POLICY, type VisionPolicy } from "../core/vision/policy";
import { DEFAULT_ORCHESTRATOR_SETTINGS, type OrchestratorSettings, ConversationOrchestrator } from "../core/conversation/orchestrator";
import type { UserPersona } from "../core/llm/prompt";
import { companionFromCard, exportPngCard, parseCardFile } from "../core/cards/parse";
import { packCypal, unpackCypal, referencedAssets } from "../core/format/cypal";
import { parseLorebookJson } from "../core/lorebook/convert";
import { defaultCompanion, emptyLorebook } from "../core/defaults";
import { nowIso, uid, utf8Decode } from "../core/util";
import { platform } from "../platform";
import { companionScope, invalidateAssets } from "./assets";

export type View = "stage" | "companions" | "editor" | "lorebooks" | "settings";

export interface AppSettings {
  persona: UserPersona;
  llmProfiles: LLMProfile[];
  defaultProfileId: ID;
  ttsEndpoints: TTSEndpoint[];
  vision: VisionPolicy;
  orchestrator: OrchestratorSettings;
  /** Expose the model name to fourth-wall-aware characters. */
  shareModelNameWithCharacters: boolean;
  reduceMotion: boolean;
}

function defaultSettings(): AppSettings {
  const local = profileFromPreset("ollama");
  return {
    persona: { name: "User", description: "" },
    llmProfiles: [local],
    defaultProfileId: local.id,
    ttsEndpoints: [],
    vision: structuredClone(DEFAULT_VISION_POLICY) as VisionPolicy,
    orchestrator: { ...DEFAULT_ORCHESTRATOR_SETTINGS },
    shareModelNameWithCharacters: true,
    reduceMotion: false,
  };
}

interface State {
  ready: boolean;
  view: View;
  editingId: ID | null;
  companions: Record<ID, Companion>;
  lorebooks: Record<ID, Lorebook>;
  settings: AppSettings;
  session: ChatSession;
  toast: { kind: "info" | "error"; text: string } | null;

  load(): Promise<void>;
  setView(v: View, editingId?: ID | null): void;
  notify(kind: "info" | "error", text: string): void;

  saveCompanion(c: Companion): Promise<void>;
  createCompanion(): Promise<Companion>;
  deleteCompanion(id: ID): Promise<void>;
  importFiles(files: { name: string; bytes: Uint8Array }[]): Promise<Companion[]>;
  exportCypal(id: ID): Promise<void>;
  exportCard(id: ID): Promise<void>;

  saveLorebook(lb: Lorebook): Promise<void>;
  createLorebook(): Promise<Lorebook>;
  deleteLorebook(id: ID): Promise<void>;
  importLorebook(file: { name: string; bytes: Uint8Array }): Promise<Lorebook>;
  promoteEmbeddedLorebook(companionId: ID): Promise<void>;

  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  setApiKey(profileId: ID, key: string): Promise<void>;

  setSession(s: ChatSession): void;
  setOnScreen(ids: ID[]): void;
}

const debounce = new Map<string, ReturnType<typeof setTimeout>>();
function persistLater(key: string, value: () => unknown, ms = 400) {
  clearTimeout(debounce.get(key));
  debounce.set(
    key,
    setTimeout(async () => {
      await platform().saveJson(key, value());
      // Tell the overlay window (if open) to pick up the change.
      void platform().emit("cypals://data", key);
    }, ms),
  );
}

/** Settings are saved without API keys; those live in the secret store. */
function settingsForDisk(s: AppSettings): AppSettings {
  return {
    ...s,
    llmProfiles: s.llmProfiles.map((p) => ({ ...p, apiKey: "" })),
    ttsEndpoints: s.ttsEndpoints.map((t) => ({ ...t, apiKey: "" })),
  };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: "stage",
  editingId: null,
  companions: {},
  lorebooks: {},
  settings: defaultSettings(),
  session: ConversationOrchestrator.newSession(),
  toast: null,

  async load() {
    const p = platform();
    const companions: Record<ID, Companion> = {};
    const prev = get().companions;
    for (const k of await p.listKeys("companions/")) {
      const c = await p.loadJson<Companion>(k);
      // Keep object identity for unchanged companions so renderers don't reload.
      if (c) companions[c.id] = prev[c.id]?.updatedAt === c.updatedAt ? prev[c.id] : c;
    }
    const lorebooks: Record<ID, Lorebook> = {};
    for (const k of await p.listKeys("lorebooks/")) {
      const lb = await p.loadJson<Lorebook>(k);
      if (lb) lorebooks[lb.id] = lb;
    }
    const saved = await p.loadJson<AppSettings>("settings");
    const settings = { ...defaultSettings(), ...(saved ?? {}) };
    settings.vision = { ...DEFAULT_VISION_POLICY, ...settings.vision, screen: { ...DEFAULT_VISION_POLICY.screen, ...settings.vision?.screen }, webcam: { ...DEFAULT_VISION_POLICY.webcam, ...settings.vision?.webcam } };
    for (const prof of settings.llmProfiles) prof.apiKey = await p.getSecret(`llm:${prof.id}`);
    for (const t of settings.ttsEndpoints) t.apiKey = await p.getSecret(`tts:${t.id}`);
    const session = (await p.loadJson<ChatSession>("session/current")) ?? ConversationOrchestrator.newSession();
    session.companionIds = session.companionIds.filter((id) => companions[id]).slice(0, MAX_ON_SCREEN);
    await p.vision?.setPolicy(settings.vision).catch(() => {});
    set({ ready: true, companions, lorebooks, settings, session, view: Object.keys(companions).length ? "stage" : "companions" });
  },

  setView(view, editingId = null) {
    set({ view, editingId });
  },

  notify(kind, text) {
    set({ toast: { kind, text } });
    setTimeout(() => get().toast?.text === text && set({ toast: null }), kind === "error" ? 7000 : 3500);
  },

  async saveCompanion(c) {
    const next = { ...c, updatedAt: nowIso() };
    set((s) => ({ companions: { ...s.companions, [c.id]: next } }));
    persistLater(`companions/${c.id}`, () => get().companions[c.id]);
  },

  async createCompanion() {
    const c = defaultCompanion("New companion");
    await get().saveCompanion(c);
    return c;
  },

  async deleteCompanion(id) {
    const p = platform();
    await p.deleteKey(`companions/${id}`);
    await p.deleteAssets(companionScope(id));
    invalidateAssets(id);
    set((s) => {
      const { [id]: _gone, ...rest } = s.companions;
      return { companions: rest, session: { ...s.session, companionIds: s.session.companionIds.filter((x) => x !== id) } };
    });
  },

  async importFiles(files) {
    const p = platform();
    const imported: Companion[] = [];
    for (const f of files) {
      try {
        const lower = f.name.toLowerCase();
        if (lower.endsWith(".cypal")) {
          const b = unpackCypal(f.bytes);
          // Imported companions get a fresh ID unless it doesn't collide.
          const c = b.companion;
          if (get().companions[c.id]) c.id = uid("cp");
          for (const [path, bytes] of b.assets) await p.writeAsset(companionScope(c.id), path, bytes);
          for (const lb of b.lorebooks) if (!get().lorebooks[lb.id]) await get().saveLorebook(lb);
          await get().saveCompanion(c);
          imported.push(c);
        } else {
          const card = parseCardFile(f.bytes, f.name);
          const { companion, assets } = companionFromCard(card, f.name);
          for (const [path, bytes] of assets) await p.writeAsset(companionScope(companion.id), path, bytes);
          await get().saveCompanion(companion);
          imported.push(companion);
        }
      } catch (e) {
        get().notify("error", `Couldn't import ${f.name}: ${(e as Error).message}`);
      }
    }
    if (imported.length) get().notify("info", `Imported ${imported.map((c) => c.character.name).join(", ")}`);
    return imported;
  },

  async exportCypal(id) {
    const c = get().companions[id];
    if (!c) return;
    const p = platform();
    const assets = new Map<string, Uint8Array>();
    for (const path of referencedAssets(c)) {
      const bytes = await p.readAsset(companionScope(id), path);
      if (bytes) assets.set(path, bytes);
    }
    const lorebooks = c.lorebookIds.map((x) => get().lorebooks[x]).filter(Boolean);
    const portrait = await firstPortrait(c);
    const bytes = packCypal({ companion: c, lorebooks, assets, card: exportPngCard(c, c.embeddedLorebook, portrait ?? undefined) });
    if (await p.saveFile(`${safeName(c.character.name)}.cypal`, bytes, [{ name: "CyPals companion", extensions: ["cypal"] }])) {
      get().notify("info", `Exported ${c.character.name}.cypal`);
    }
  },

  async exportCard(id) {
    const c = get().companions[id];
    if (!c) return;
    const portrait = await firstPortrait(c);
    const merged = mergeLore(c, get().lorebooks);
    const bytes = exportPngCard(c, merged, portrait ?? undefined);
    if (await platform().saveFile(`${safeName(c.character.name)}.png`, bytes, [{ name: "Character card", extensions: ["png"] }])) {
      get().notify("info", `Exported ${c.character.name} as a V3 card`);
    }
  },

  async saveLorebook(lb) {
    set((s) => ({ lorebooks: { ...s.lorebooks, [lb.id]: lb } }));
    persistLater(`lorebooks/${lb.id}`, () => get().lorebooks[lb.id]);
  },

  async createLorebook() {
    const lb = emptyLorebook();
    await get().saveLorebook(lb);
    return lb;
  },

  async deleteLorebook(id) {
    await platform().deleteKey(`lorebooks/${id}`);
    const companions = { ...get().companions };
    for (const c of Object.values(companions)) {
      if (c.lorebookIds.includes(id)) await get().saveCompanion({ ...c, lorebookIds: c.lorebookIds.filter((x) => x !== id) });
    }
    set((s) => {
      const { [id]: _gone, ...rest } = s.lorebooks;
      return { lorebooks: rest };
    });
  },

  async importLorebook(file) {
    const lb = parseLorebookJson(JSON.parse(utf8Decode(file.bytes)), file.name.replace(/\.json$/i, ""));
    if (get().lorebooks[lb.id]) lb.id = uid("lb");
    await get().saveLorebook(lb);
    get().notify("info", `Imported lorebook “${lb.name}” (${lb.entries.length} entries)`);
    return lb;
  },

  async promoteEmbeddedLorebook(companionId) {
    const c = get().companions[companionId];
    if (!c?.embeddedLorebook) return;
    const lb = { ...c.embeddedLorebook, id: uid("lb") };
    await get().saveLorebook(lb);
    await get().saveCompanion({ ...c, embeddedLorebook: null, lorebookIds: [...c.lorebookIds, lb.id] });
    get().notify("info", `“${lb.name}” is now in your lorebook library and can be linked to other companions`);
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (patch.vision) await platform().vision?.setPolicy(settings.vision).catch(() => {});
    persistLater("settings", () => settingsForDisk(get().settings));
  },

  async setApiKey(profileId, key) {
    const s = get().settings;
    const isTts = s.ttsEndpoints.some((t) => t.id === profileId);
    await platform().setSecret(`${isTts ? "tts" : "llm"}:${profileId}`, key);
    await get().updateSettings(
      isTts
        ? { ttsEndpoints: s.ttsEndpoints.map((t) => (t.id === profileId ? { ...t, apiKey: key } : t)) }
        : { llmProfiles: s.llmProfiles.map((p) => (p.id === profileId ? { ...p, apiKey: key } : p)) },
    );
  },

  setSession(session) {
    set({ session: { ...session } });
    persistLater("session/current", () => get().session, 800);
  },

  setOnScreen(ids) {
    get().setSession({ ...get().session, companionIds: ids.slice(0, MAX_ON_SCREEN) });
  },
}));

function safeName(s: string): string {
  return s.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "companion";
}

async function firstPortrait(c: Companion): Promise<Uint8Array | null> {
  for (const a of c.avatars) {
    if (a.kind !== "portraits") continue;
    const ref = a.images[a.fallback]?.[0] ?? Object.values(a.images)[0]?.[0];
    if (ref && ref.mime === "image/png") return platform().readAsset(companionScope(c.id), ref.path);
  }
  return null;
}

/** For card export: embedded + linked lorebooks merged into one character_book. */
function mergeLore(c: Companion, library: Record<ID, Lorebook>): Lorebook | null {
  const books = [c.embeddedLorebook, ...c.lorebookIds.map((id) => library[id])].filter((b): b is Lorebook => !!b);
  if (!books.length) return null;
  if (books.length === 1) return books[0];
  return { ...books[0], name: `${c.character.name} — lore`, entries: books.flatMap((b) => b.entries) };
}
