import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { PROVIDER_PRESETS, type LLMProfile } from "../core/llm/types";
import { createProvider, profileFromPreset } from "../core/llm/providers";
import { TTS_PRESETS, type TTSEndpoint } from "../core/tts/providers";
import { decideWindow, type WindowInfo } from "../core/vision/policy";
import { CALL_MODE_PROMPT, CHAT_MODE_PROMPT, DEFAULT_MAIN_PROMPT } from "../core/llm/prompt";
import { STT_PRESETS, type STTSettings } from "../core/stt/providers";
import { newPersona } from "../core/personas";
import type { Persona } from "../core/types";
import { TINT_PRESETS } from "./theme";
import { platform } from "../platform";
import { listCameras } from "../state/webcam";
import { uid } from "../core/util";
import { Icon, NumberInput, Select, Slider, Tabs, TagInput, TextArea, TextInput, Toggle } from "./controls";

type Section = "persona" | "appearance" | "models" | "voices" | "vision" | "conversation";

export function SettingsView() {
  const [section, setSection] = useState<Section>("persona");
  return (
    <section className="page">
      <header className="page-head"><h1>Settings</h1></header>
      <Tabs<Section> value={section} onChange={setSection} tabs={[
        { id: "persona", label: "Persona" },
        { id: "appearance", label: "Appearance" },
        { id: "models", label: "Models" },
        { id: "voices", label: "Voices" },
        { id: "vision", label: "Vision & privacy" },
        { id: "conversation", label: "Conversation" },
      ]} />
      <div className="tab-panel" role="tabpanel">
        {section === "persona" && <PersonaSection />}
        {section === "appearance" && <AppearanceSection />}
        {section === "models" && <ModelsSection />}
        {section === "voices" && <VoicesSection />}
        {section === "vision" && <VisionSection />}
        {section === "conversation" && <ConversationSection />}
      </div>
    </section>
  );
}

function PersonaSection() {
  const s = useStore((x) => x.settings);
  const companions = useStore((x) => x.companions);
  const update = useStore((x) => x.updateSettings);
  const [openId, setOpenId] = useState<string>(s.defaultPersonaId);
  const setPersona = (id: string, p: Partial<Persona>) => update({ personas: s.personas.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const users = (id: string) => Object.values(companions).filter((c) => c.preferredPersonaId === id).map((c) => c.character.name);
  return (
    <div className="form">
      <p className="hint">
        Personas are the roles you play. Companions see the persona's name as {"{{user}}"} and read its description. Pick a default here, and a preferred
        persona for any companion in its Character tab. During a chat you can switch from the top of the screen.
      </p>
      <ul className="plain profiles">
        {s.personas.map((p) => {
          const isDefault = s.defaultPersonaId === p.id;
          const pref = users(p.id);
          return (
            <li key={p.id} className="profile" data-open={openId === p.id || undefined}>
              <button className="profile-head" onClick={() => setOpenId(openId === p.id ? "" : p.id)} aria-expanded={openId === p.id}>
                <span>{p.name || "Unnamed persona"}</span>
                <small>{[isDefault ? "Default" : "", pref.length ? `Preferred by ${pref.join(", ")}` : ""].filter(Boolean).join(" · ")}</small>
              </button>
              {openId === p.id && (
                <div className="profile-body">
                  <TextInput label="Name" value={p.name} onChange={(name) => setPersona(p.id, { name })} hint="What companions call you in this role" />
                  <TextArea label="Description" rows={5} value={p.description} onChange={(description) => setPersona(p.id, { description })} placeholder="Who you are in this role: appearance, personality, background, relationship to the characters…" />
                  <div className="row">
                    <button className="btn" disabled={isDefault} onClick={() => update({ defaultPersonaId: p.id })}>{isDefault ? "Default persona" : "Make default"}</button>
                    <span className="spacer" />
                    <button
                      className="btn btn-quiet danger"
                      disabled={s.personas.length === 1}
                      onClick={() => {
                        const rest = s.personas.filter((x) => x.id !== p.id);
                        void update({ personas: rest, defaultPersonaId: isDefault ? rest[0].id : s.defaultPersonaId });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <button
          className="btn"
          onClick={() => {
            const p = newPersona("New persona");
            void update({ personas: [...s.personas, p] });
            setOpenId(p.id);
          }}
        >
          <Icon name="plus" size={16} /> Add persona
        </button>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const a = s.appearance;
  const set = (p: Partial<typeof a>) => update({ appearance: { ...a, ...p } });
  return (
    <div className="form">
      <div className="field">
        <label id="theme-label">Theme</label>
        <div className="mode-switch" role="radiogroup" aria-labelledby="theme-label">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={a.theme === t} onClick={() => set({ theme: t })}>
              {t === "dark" ? "Dark" : t === "light" ? "Light" : "Match system"}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label id="tint-label">Colour tint</label>
        <div className="tints" role="radiogroup" aria-labelledby="tint-label">
          {TINT_PRESETS.map((t) => (
            <button
              key={t.color}
              role="radio"
              aria-checked={a.tint.toLowerCase() === t.color}
              className="tint"
              style={{ ["--swatch" as string]: t.color }}
              onClick={() => set({ tint: t.color })}
              title={t.name}
            >
              <span className="sr-only">{t.name}</span>
            </button>
          ))}
          <label className="tint tint-custom" title="Custom colour">
            <input type="color" value={a.tint} onChange={(e) => set({ tint: e.target.value })} aria-label="Custom tint colour" />
          </label>
        </div>
      </div>
      <Slider label="Tint strength" min={0} max={1} step={0.05} value={a.tintStrength} onChange={(tintStrength) => set({ tintStrength })} format={(v) => (v < 0.1 ? "Neutral" : v < 0.45 ? "Subtle" : v < 0.8 ? "Tinted" : "Strong")} hint="How much of the tint the backgrounds take on. The accent colour always uses it." />
      <Toggle label="Reduce motion" checked={s.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} hint="Stops idle sway, blinking and gestures; avatars still change expression." />
    </div>
  );
}

// ───────────────────────── Models ─────────────────────────

function ModelsSection() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const [open, setOpen] = useState<string | null>(s.llmProfiles[0]?.id ?? null);
  const add = (presetId: string) => {
    const p = profileFromPreset(presetId);
    void update({ llmProfiles: [...s.llmProfiles, p] });
    setOpen(p.id);
  };
  return (
    <div className="form">
      <p className="hint">Run a model on this device (Ollama, LM Studio, KoboldCpp, llama.cpp…) or connect a cloud service. Keys are stored in your system's keychain and never included in exported files.</p>
      <ul className="plain profiles">
        {s.llmProfiles.map((p) => (
          <li key={p.id} className="profile" data-open={open === p.id || undefined}>
            <button className="profile-head" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
              <span>{p.label}</span>
              <small>{p.model || "no model chosen"}{s.defaultProfileId === p.id ? " · default" : ""}</small>
            </button>
            {open === p.id && <ProfileEditor profile={p} />}
          </li>
        ))}
      </ul>
      <Select label="Add a connection" value={"" as string} onChange={(v) => v && add(v)} options={[{ value: "", label: "Choose a service…" }, ...PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label }))]} />
    </div>
  );
}

function ProfileEditor({ profile }: { profile: LLMProfile }) {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const setApiKey = useStore((x) => x.setApiKey);
  const notify = useStore((x) => x.notify);
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const preset = PROVIDER_PRESETS.find((p) => p.id === profile.presetId);
  const set = (p: Partial<LLMProfile>) => update({ llmProfiles: s.llmProfiles.map((x) => (x.id === profile.id ? { ...x, ...p } : x)) });
  const sp = profile.sampling;
  const setS = (p: Partial<typeof sp>) => set({ sampling: { ...sp, ...p } });

  const fetchModels = async () => {
    try {
      setModels(await createProvider(profile, platform().fetch).listModels());
    } catch (e) {
      notify("error", (e as Error).message);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const r = await createProvider(profile, platform().fetch).generate({
        messages: [{ role: "user", content: "Reply with just the word: ready" }],
        sampling: { ...sp, maxTokens: 10 },
      });
      notify("info", `Connected. The model replied: “${r.text.trim().slice(0, 60)}”`);
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="profile-body">
      <div className="grid-2">
        <TextInput label="Name" value={profile.label} onChange={(label) => set({ label })} />
        <TextInput label="Server address" value={profile.baseUrl} onChange={(baseUrl) => set({ baseUrl })} placeholder="https://…/v1" />
      </div>
      {(preset?.needsKey ?? true) && (
        <TextInput label="API key" type="password" value={profile.apiKey} onChange={(k) => void setApiKey(profile.id, k)} />
      )}
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`m-${profile.id}`}>Model</label>
          <div className="row">
            <input id={`m-${profile.id}`} list={`ml-${profile.id}`} value={profile.model} onChange={(e) => set({ model: e.target.value })} />
            <datalist id={`ml-${profile.id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
            <button className="btn btn-quiet" onClick={fetchModels}>List models</button>
          </div>
        </div>
        <NumberInput label="Context size (tokens)" step={1024} value={profile.contextTokens} onChange={(contextTokens) => set({ contextTokens })} />
      </div>
      <Toggle label="Model accepts images" checked={profile.vision} onChange={(vision) => set({ vision })} hint="Needed for screen and webcam sharing. Images are dropped for models without vision." />
      <details className="advanced">
        <summary>Sampling</summary>
        <div className="grid-3">
          <Slider label="Temperature" min={0} max={2} step={0.05} value={sp.temperature} onChange={(temperature) => setS({ temperature })} />
          <Slider label="Top P" min={0} max={1} step={0.01} value={sp.topP} onChange={(topP) => setS({ topP })} />
          <NumberInput label="Max reply tokens" value={sp.maxTokens} onChange={(maxTokens) => setS({ maxTokens })} />
          <NumberInput label="Top K" value={sp.topK ?? NaN} onChange={(v) => setS({ topK: Number.isFinite(v) ? v : null })} hint="Blank = server default" />
          <NumberInput label="Min P" step={0.01} value={sp.minP ?? NaN} onChange={(v) => setS({ minP: Number.isFinite(v) ? v : null })} />
          <NumberInput label="Repetition penalty" step={0.01} value={sp.repetitionPenalty ?? NaN} onChange={(v) => setS({ repetitionPenalty: Number.isFinite(v) ? v : null })} />
        </div>
        <TagInput label="Stop sequences" value={sp.stop} onChange={(stop) => setS({ stop })} />
      </details>
      <div className="row">
        <button className="btn" onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
        <button className="btn btn-quiet" disabled={s.defaultProfileId === profile.id} onClick={() => update({ defaultProfileId: profile.id })}>
          {s.defaultProfileId === profile.id ? "Default model" : "Make default"}
        </button>
        <span className="spacer" />
        <button className="btn btn-quiet danger" disabled={s.llmProfiles.length === 1}
          onClick={() => update({ llmProfiles: s.llmProfiles.filter((x) => x.id !== profile.id), defaultProfileId: s.defaultProfileId === profile.id ? s.llmProfiles.find((x) => x.id !== profile.id)!.id : s.defaultProfileId })}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Voices ─────────────────────────

function VoicesSection() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const setApiKey = useStore((x) => x.setApiKey);
  const set = (id: string, p: Partial<TTSEndpoint>) => update({ ttsEndpoints: s.ttsEndpoints.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  return (
    <div className="form">
      <p className="hint">Connect a speech engine, then pick it per companion under Look &amp; voice. Without one, companions speak in text only.</p>
      <ul className="plain profiles">
        {s.ttsEndpoints.map((t) => (
          <li key={t.id} className="profile" data-open>
            <div className="profile-body">
              <div className="grid-2">
                <TextInput label="Name" value={t.label} onChange={(label) => set(t.id, { label })} />
                {t.kind !== "system" && t.kind !== "http-template" && <TextInput label="Server address" value={t.baseUrl} onChange={(baseUrl) => set(t.id, { baseUrl })} />}
              </div>
              {t.kind === "http-template" && (
                <>
                  <div className="grid-2">
                    <Select label="Method" value={t.template?.method ?? "GET"} options={[{ value: "GET", label: "GET" }, { value: "POST", label: "POST" }]} onChange={(method) => set(t.id, { template: { ...t.template!, method } })} />
                    <TextInput label="URL" value={t.template?.url ?? ""} onChange={(url) => set(t.id, { template: { ...t.template!, url } })} hint="Use {text}, {voice} and {speed}" />
                  </div>
                  {t.template?.method === "POST" && <TextArea label="JSON body" rows={3} value={t.template?.body ?? ""} onChange={(body) => set(t.id, { template: { ...t.template!, body } })} />}
                </>
              )}
              {(t.kind === "elevenlabs" || (t.kind === "openai-speech" && !t.baseUrl.includes("127.0.0.1"))) && (
                <TextInput label="API key" type="password" value={t.apiKey} onChange={(k) => void setApiKey(t.id, k)} />
              )}
              {t.kind !== "system" && (
                <div className="grid-2">
                  <TextInput label="Model" value={t.model} onChange={(model) => set(t.id, { model })} />
                  <TextInput label="Default voice" value={t.defaultVoice} onChange={(defaultVoice) => set(t.id, { defaultVoice })} />
                </div>
              )}
              <button className="btn btn-quiet danger" onClick={() => update({ ttsEndpoints: s.ttsEndpoints.filter((x) => x.id !== t.id) })}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
      <Select
        label="Add a voice engine"
        value={"" as string}
        onChange={(v) => {
          const preset = TTS_PRESETS[Number(v)];
          if (preset) void update({ ttsEndpoints: [...s.ttsEndpoints, { ...structuredClone(preset), id: uid("tts") }] });
        }}
        options={[{ value: "", label: "Choose an engine…" }, ...TTS_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))]}
      />
      <SpeechToText />
    </div>
  );
}

function SpeechToText() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const setApiKey = useStore((x) => x.setApiKey);
  const stt = s.stt;
  const set = (p: Partial<STTSettings>) => stt && update({ stt: { ...stt, ...p } });
  const hasGemini = s.llmProfiles.some((p) => p.kind === "gemini" && p.apiKey);
  return (
    <>
      <h3>Speech-to-text</h3>
      <p className="hint">Turns your voice notes and Call-mode speech into text for the companions. Recordings are sent only to this service.</p>
      <Select
        label="Engine"
        value={stt ? String(STT_PRESETS.findIndex((p) => p.label === stt.label)) : ""}
        onChange={(v) => {
          const preset = STT_PRESETS[Number(v)];
          void update({ stt: v === "" || !preset ? null : { ...structuredClone(preset), apiKey: "" } });
          if (preset) void setApiKey("stt", "");
        }}
        options={[{ value: "", label: "Off" }, ...STT_PRESETS.map((p, i) => ({ value: String(i), label: p.label }))]}
      />
      {stt && (
        <div className="grid-2">
          <TextInput label="Server address" value={stt.baseUrl} onChange={(baseUrl) => set({ baseUrl })} />
          <TextInput label="Model" value={stt.model} onChange={(model) => set({ model })} />
          {!stt.baseUrl.includes("127.0.0.1") && !stt.baseUrl.includes("localhost") && (
            <TextInput
              label="API key"
              type="password"
              value={stt.apiKey}
              onChange={(k) => void setApiKey("stt", k)}
              hint={stt.kind === "gemini" && hasGemini ? "Leave empty to use the key from your Gemini model connection." : undefined}
            />
          )}
          <TextInput label="Language" value={stt.language} placeholder="Auto-detect" onChange={(language) => set({ language: language.trim().toLowerCase() })} hint="Two-letter code such as en, de, ja; empty = detect" />
        </div>
      )}
    </>
  );
}

// ───────────────────────── Vision ─────────────────────────

function VisionSection() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const v = s.vision;
  const setScreen = (p: Partial<typeof v.screen>) => update({ vision: { ...v, screen: { ...v.screen, ...p } } });
  const setCam = (p: Partial<typeof v.webcam>) => update({ vision: { ...v, webcam: { ...v.webcam, ...p } } });
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const canScreen = !!platform().vision;

  useEffect(() => {
    if (canScreen) void platform().vision!.listWindows().then(setWindows).catch(() => setWindows([]));
  }, [canScreen]);
  useEffect(() => {
    if (v.webcam.enabled) void listCameras().then(setCams).catch(() => setCams([]));
  }, [v.webcam.enabled]);

  return (
    <div className="form">
      <div className="callout">
        <p>Companions can't see your screen or camera unless you turn it on here or with the buttons under the call. A notice appears each time an image is shared, and images go only to the model connection that companion uses.</p>
      </div>

      <h3>Screen</h3>
      <Toggle label="Share screen with companions" checked={v.screen.enabled} disabled={!canScreen} onChange={(enabled) => setScreen({ enabled })}
        hint={canScreen ? "A screenshot is attached when you send a message." : "Available in the Windows and Linux apps."} />
      {canScreen && (
        <>
          <Select label="Which windows" value={v.screen.mode} onChange={(mode) => setScreen({ mode })} options={[
            { value: "allowlist", label: "Only the programs and windows listed below" },
            { value: "blocklist", label: "Everything except those listed below" },
          ]} />
          <div className="grid-2">
            <TagInput label="Programs" value={v.screen.apps} onChange={(apps) => setScreen({ apps })} placeholder="krita, code, firefox" />
            <TagInput label="Window titles containing" value={v.screen.titles} onChange={(titles) => setScreen({ titles })} placeholder="Chapter 3, Blender" />
          </div>
          <div className="grid-2">
            <Select label="Capture" value={v.screen.scope} onChange={(scope) => setScreen({ scope })} options={[
              { value: "focused", label: "The window I'm using, if allowed" }, { value: "all-allowed", label: "Every allowed window (up to 4)" },
            ]} />
            <NumberInput label="Max image width" step={160} value={v.screen.maxWidth} onChange={(maxWidth) => setScreen({ maxWidth })} />
          </div>
          <p className="hint">Password managers, banking and sign-in pages, private browsing windows and CyPals itself are never captured.</p>
          {windows.length > 0 && (
            <details className="advanced" open>
              <summary>Open windows right now</summary>
              <ul className="plain window-list">
                {windows.map((w) => {
                  const d = decideWindow(w, { ...v.screen, enabled: true });
                  return (
                    <li key={w.id} data-allowed={d.allowed || undefined}>
                      <span><strong>{w.app}</strong> {w.title}</span>
                      <small>{d.allowed ? "Visible to companions" : d.reason}</small>
                      {!d.allowed && v.screen.mode === "allowlist" && d.reason === "Not on the allow-list" && (
                        <button className="btn btn-quiet" onClick={() => setScreen({ apps: [...v.screen.apps, w.app] })}>Allow {w.app}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button className="btn btn-quiet" onClick={() => void platform().vision!.listWindows().then(setWindows)}><Icon name="refresh" size={16} /> Refresh</button>
            </details>
          )}
        </>
      )}

      <h3>Webcam</h3>
      <Toggle label="Share webcam with companions" checked={v.webcam.enabled} onChange={(enabled) => setCam({ enabled })} hint="A single frame is attached when you send a message. The camera turns off when you disable this." />
      {v.webcam.enabled && cams.length > 1 && (
        <Select label="Camera" value={v.webcam.deviceId} onChange={(deviceId) => setCam({ deviceId })} options={[{ value: "", label: "Default" }, ...cams.map((c, i) => ({ value: c.deviceId, label: c.label || `Camera ${i + 1}` }))]} />
      )}
    </div>
  );
}

// ───────────────────────── Conversation ─────────────────────────

function ConversationSection() {
  const s = useStore((x) => x.settings);
  const update = useStore((x) => x.updateSettings);
  const o = s.orchestrator;
  const set = (p: Partial<typeof o>) => update({ orchestrator: { ...o, ...p } });
  return (
    <div className="form">
      <h3>Group calls</h3>
      <Slider label="How readily companions answer each other" min={0} max={1} step={0.05} value={o.autonomyChance} onChange={(autonomyChance) => set({ autonomyChance })} format={(x) => `${Math.round(x * 100)}%`} />
      <div className="grid-2">
        <NumberInput label="Longest exchange without you" min={0} max={20} value={o.maxAutonomousChain} onChange={(maxAutonomousChain) => set({ maxAutonomousChain })} hint="Replies in a row before they wait for you" />
        <NumberInput label="Pause between their replies (ms)" step={100} value={o.autonomousDelayMs} onChange={(autonomousDelayMs) => set({ autonomousDelayMs })} />
      </div>
      <h3>Prompting</h3>
      <Toggle label="Expression and gesture tags" checked={o.performanceTags} onChange={(performanceTags) => set({ performanceTags })} hint="Asks the model to mark expressions and gestures. Turn off for small models that echo the tags; faces are then guessed from the text." />
      <Toggle label="Tell fourth-wall-aware characters which model they run on" checked={s.shareModelNameWithCharacters} onChange={(shareModelNameWithCharacters) => update({ shareModelNameWithCharacters })} />
      <TextArea label="Roleplay prompt" rows={4} value={o.mainPrompt} placeholder={DEFAULT_MAIN_PROMPT} onChange={(mainPrompt) => set({ mainPrompt })} hint="Leave empty to use the default shown. A card's own system prompt replaces this in Roleplay." />
      <TextArea label="Chat prompt" rows={4} value={o.chatPrompt ?? ""} placeholder={CHAT_MODE_PROMPT} onChange={(chatPrompt) => set({ chatPrompt })} />
      <TextArea label="Call prompt" rows={4} value={o.callPrompt ?? ""} placeholder={CALL_MODE_PROMPT} onChange={(callPrompt) => set({ callPrompt })} />
      <h3>Calls</h3>
      <Slider
        label="Silence before they answer"
        min={3} max={8} step={0.5}
        value={s.call.silenceSeconds}
        onChange={(silenceSeconds) => update({ call: { ...s.call, silenceSeconds: Math.max(3, silenceSeconds) } })}
        format={(v) => `${v} s`}
        hint="How long you need to stay quiet after speaking before it's the character's turn. At least 3 seconds."
      />
      <Toggle label="Listen as soon as a call opens" checked={s.call.autoListen} onChange={(autoListen) => update({ call: { ...s.call, autoListen } })} hint="Otherwise, press Start listening in the call." />
    </div>
  );
}
