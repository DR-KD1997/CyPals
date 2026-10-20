import { useEffect, useRef, useState } from "react";
import type { Avatar, AvatarFraming, Companion, Expression, Live2DAvatar, ModelAvatar, PortraitAvatar } from "../core/types";
import { ACTIONS, DEFAULT_FRAMING, EXPRESSIONS } from "../core/types";
import { useStore } from "../state/store";
import { storeAssets, assetUrl } from "../state/assets";
import { mimeFromExt, parseCardFile } from "../core/cards/parse";
import { createTTS } from "../core/tts/providers";
import { platform } from "../platform";
import { uid, utf8Decode } from "../core/util";
import { Icon, NumberInput, Select, Slider, Tabs, TagInput, TextArea, TextInput, Toggle } from "./controls";
import { AvatarView } from "../avatars/AvatarView";
import { useCallWindowStyle } from "./CallFrame";
import { live, pushAction, updateLive } from "../state/live";
import { canonicalExpression, portraitKeyFor } from "../core/synonyms";

type Tab = "character" | "avatars" | "behaviour" | "lore";

export function CompanionEditor() {
  const id = useStore((s) => s.editingId);
  const companion = useStore((s) => (id ? s.companions[id] : undefined));
  const save = useStore((s) => s.saveCompanion);
  const setView = useStore((s) => s.setView);
  const [tab, setTab] = useState<Tab>("character");

  if (!companion) {
    return (
      <section className="page">
        <p>That companion no longer exists.</p>
        <button className="btn" onClick={() => setView("companions")}>Back to companions</button>
      </section>
    );
  }
  const patch = (fn: (c: Companion) => Companion) => void save(fn(structuredClone(companion)));

  return (
    <section className="page editor">
      <header className="page-head">
        <div>
          <button className="link" onClick={() => setView("companions")}>Companions</button>
          <h1>{companion.character.name || "Untitled"}</h1>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => useStore.getState().exportCypal(companion.id)}>
            <Icon name="download" size={18} /> Save as .cypal
          </button>
        </div>
      </header>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "character", label: "Character" },
          { id: "avatars", label: "Avatars" },
          { id: "behaviour", label: "Voice & behaviour" },
          { id: "lore", label: "Lore & model" },
        ]}
      />
      <div className="tab-panel" role="tabpanel">
        {tab === "character" && <CharacterTab c={companion} patch={patch} />}
        {tab === "avatars" && <AvatarsTab c={companion} patch={patch} />}
        {tab === "behaviour" && <VoiceBehaviourTab c={companion} patch={patch} />}
        {tab === "lore" && <LoreTab c={companion} patch={patch} />}
      </div>
    </section>
  );
}

type TabProps = { c: Companion; patch(fn: (c: Companion) => Companion): void };

// ───────────────────────── Character ─────────────────────────

function CharacterTab({ c, patch }: TabProps) {
  const ch = c.character;
  const set = <K extends keyof typeof ch>(k: K, v: (typeof ch)[K]) => patch((x) => ({ ...x, character: { ...x.character, [k]: v } }));
  const notify = useStore((s) => s.notify);

  const fillFromCard = async () => {
    const [f] = await platform().pickFiles({ accept: ["png", "json", "charx"], title: "Fill fields from a character card" });
    if (!f) return;
    try {
      const card = parseCardFile(f.bytes, f.name);
      patch((x) => ({
        ...x,
        character: card.character,
        embeddedLorebook: card.lorebook ?? x.embeddedLorebook,
        source: { kind: card.version, origin: f.name },
      }));
      notify("info", `Filled from ${card.version.toUpperCase()} card “${card.character.name}”`);
    } catch (e) {
      notify("error", `Couldn't read that card: ${(e as Error).message}`);
    }
  };

  return (
    <div className="form">
      <div className="form-intro">
        <p>{"Use {{char}} and {{user}} anywhere; they're replaced with the names when chatting."}</p>
        <button className="btn" onClick={fillFromCard}><Icon name="upload" size={16} /> Fill from character card</button>
      </div>
      <div className="grid-2">
        <TextInput label="Name" value={ch.name} onChange={(v) => set("name", v)} />
        <TextInput label="Nickname" value={ch.nickname} onChange={(v) => set("nickname", v)} hint="Used in conversation instead of the name, if set" />
      </div>
      <PersonaPreference c={c} patch={patch} />
      <TextInput label="Tagline" value={ch.tagline} onChange={(v) => set("tagline", v)} hint="One line shown in your library and to other companions on the call" />
      <TextArea label="Description" rows={7} value={ch.description} onChange={(v) => set("description", v)} />
      <TextArea label="Personality" rows={3} value={ch.personality} onChange={(v) => set("personality", v)} />
      <TextArea label="Scenario" rows={3} value={ch.scenario} onChange={(v) => set("scenario", v)} />
      <TextArea label="First message" rows={4} value={ch.firstMessage} onChange={(v) => set("firstMessage", v)} hint="Said when the companion joins a new call" />
      <div className="field">
        <label>Alternate greetings</label>
        {ch.alternateGreetings.map((g, i) => (
          <div key={i} className="row">
            <textarea rows={2} value={g} onChange={(e) => set("alternateGreetings", ch.alternateGreetings.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="icon-btn" aria-label="Remove greeting" onClick={() => set("alternateGreetings", ch.alternateGreetings.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        <button className="btn btn-quiet" onClick={() => set("alternateGreetings", [...ch.alternateGreetings, ""])}><Icon name="plus" size={16} /> Add greeting</button>
      </div>
      <TextArea label="Example dialogue" rows={6} value={ch.exampleDialogue} onChange={(v) => set("exampleDialogue", v)} hint={"Separate examples with <START>. Lines start with {{user}}: or {{char}}:"} />
      <details className="advanced">
        <summary>Prompt overrides and card details</summary>
        <TextArea label="System prompt" rows={4} value={ch.systemPrompt} onChange={(v) => set("systemPrompt", v)} hint="Replaces the app's main prompt for this companion. Include {{original}} to keep it." />
        <TextArea label="Post-history instructions" rows={3} value={ch.postHistoryInstructions} onChange={(v) => set("postHistoryInstructions", v)} />
        <TextArea label="Creator notes" rows={3} value={ch.creatorNotes} onChange={(v) => set("creatorNotes", v)} />
        <div className="grid-2">
          <TextInput label="Creator" value={ch.creator} onChange={(v) => set("creator", v)} />
          <TextInput label="Version" value={ch.characterVersion} onChange={(v) => set("characterVersion", v)} />
        </div>
        <TagInput label="Tags" value={ch.tags} onChange={(v) => set("tags", v)} />
      </details>
    </div>
  );
}

function PersonaPreference({ c, patch }: TabProps) {
  const personas = useStore((s) => s.settings.personas);
  const defaultId = useStore((s) => s.settings.defaultPersonaId);
  const setView = useStore((s) => s.setView);
  const def = personas.find((p) => p.id === defaultId);
  return (
    <Select
      label={`Your persona with ${c.character.nickname || c.character.name || "this companion"}`}
      value={c.preferredPersonaId ?? ""}
      onChange={(v) => patch((x) => ({ ...x, preferredPersonaId: v || null }))}
      options={[{ value: "", label: `Default${def ? ` (${def.name})` : ""}` }, ...personas.map((p) => ({ value: p.id, label: p.name }))]}
      hint={<>Who you are when a chat with them starts. You can still switch during a chat. <button className="link" onClick={() => setView("settings")}>Manage personas</button></>}
    />
  );
}

// ───────────────────────── Avatars ─────────────────────────

const EXPR_OPTIONS = EXPRESSIONS.map((e) => ({ value: e, label: e }));

function AvatarsTab({ c, patch }: TabProps) {
  const notify = useStore((s) => s.notify);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const [selected, setSelected] = useState<string | null>(c.activeAvatarId ?? c.avatars[0]?.id ?? null);
  const avatar = c.avatars.find((a) => a.id === selected);

  const add = (a: Avatar) => {
    patch((x) => ({ ...x, avatars: [...x.avatars, a], activeAvatarId: x.activeAvatarId ?? a.id }));
    setSelected(a.id);
  };
  const update = (a: Avatar) => patch((x) => ({ ...x, avatars: x.avatars.map((y) => (y.id === a.id ? a : y)) }));

  const add3D = async () => {
    const files = await platform().pickFiles({ accept: ["vrm", "glb", "gltf", "bin", "png", "jpg"], multiple: true, title: "Select a VRM, GLB or glTF model" });
    const main = files.find((f) => /\.(vrm|glb|gltf)$/i.test(f.name));
    if (!main) return;
    const folder = `model/${uid().slice(0, 8)}`;
    const paths = await storeAssets(c.id, folder, files);
    const mainPath = paths[files.indexOf(main)];
    add({
      id: uid("av"), kind: "model3d", label: main.name.replace(/\.\w+$/, ""),
      model: { path: mainPath, mime: mimeFromExt(main.name.split(".").pop()!) },
      animations: {}, expressionMap: {}, lipSyncKeys: [],
      camera: { distance: 1.05, height: 0, fov: 28 },
    });
  };

  const addLive2D = async () => {
    const files = (await platform().pickFolder?.("Select the Live2D model folder")) ?? [];
    const entry = files.find((f) => /\.model3\.json$/i.test(f.name)) ?? files.find((f) => /\.model\.json$/i.test(f.name));
    if (!entry) {
      if (files.length) notify("error", "That folder has no .model3.json or .model.json file.");
      return;
    }
    // Keep only the model's own directory tree.
    const root = entry.name.includes("/") ? entry.name.slice(0, entry.name.lastIndexOf("/") + 1) : "";
    const own = files.filter((f) => f.name.startsWith(root) && !/\.(psd|cmo3|can3)$/i.test(f.name));
    const folder = `live2d/${uid().slice(0, 8)}`;
    const paths = await storeAssets(c.id, folder, own.map((f) => ({ ...f, name: f.name.slice(root.length) })));
    const entryPath = paths[own.indexOf(entry)];
    const info = describeLive2D(JSON.parse(utf8Decode(entry.bytes)));
    add({
      id: uid("av"), kind: "live2d", label: entry.name.split("/").pop()!.replace(/\.model3?\.json$/i, ""),
      entry: { path: entryPath, mime: "application/json" },
      files: paths.filter((p) => p !== entryPath).map((p) => ({ path: p, mime: mimeFromExt(p.split(".").pop()!) })),
      expressionMap: guessLive2DExpressions(info.expressions),
      motionMap: {},
      lipSyncParam: "",
      scale: 1,
      offset: { x: 0, y: 0 },
    });
  };

  const addPortraits = async () => {
    const files = await platform().pickFiles({ accept: ["png", "jpg", "jpeg", "webp", "gif", "avif"], multiple: true, title: "Select portrait images (name them after expressions, e.g. happy.png)" });
    if (!files.length) return;
    const folder = `portraits/${uid().slice(0, 8)}`;
    const paths = await storeAssets(c.id, folder, files);
    const images: PortraitAvatar["images"] = {};
    files.forEach((f, i) => {
      const k = keyFromFilename(f.name);
      (images[k] ??= []).push({ path: paths[i], mime: mimeFromExt(f.name.split(".").pop()!) });
    });
    add({
      id: uid("av"), kind: "portraits", label: "Portraits", images,
      fallback: images.neutral ? "neutral" : Object.keys(images)[0], transitionMs: 180, talkingSuffix: "_talk",
    });
  };

  return (
    <div className="avatars">
      <aside className="avatar-list">
        <ul>
          {c.avatars.map((a) => (
            <li key={a.id}>
              <button aria-current={a.id === selected || undefined} onClick={() => setSelected(a.id)}>
                <span>{a.label}</span>
                <small>{{ model3d: "3D model", live2d: "Live2D", portraits: "Portrait set" }[a.kind]}{a.id === c.activeAvatarId ? " · in use" : ""}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="avatar-add">
          <button className="btn" onClick={add3D}><Icon name="plus" size={16} /> 3D model (VRM / GLB)</button>
          <button className="btn" onClick={addLive2D} disabled={!platform().pickFolder}><Icon name="plus" size={16} /> Live2D model folder</button>
          <button className="btn" onClick={addPortraits}><Icon name="plus" size={16} /> Portrait images</button>
        </div>
      </aside>

      {avatar ? (
        <div className="avatar-detail">
          <div className="avatar-preview">
            <FramingPreview c={c} avatar={avatar} update={update} reduceMotion={reduceMotion} />
            <ExpressionTester id={c.id} />
            <FramingControls avatar={avatar} update={update} />
            <CallWindowSettings c={c} patch={patch} />
          </div>
          <div className="form">
            <div className="grid-2">
              <TextInput label="Label" value={avatar.label} onChange={(v) => update({ ...avatar, label: v })} />
              <div className="field">
                <label>&nbsp;</label>
                <div className="row">
                  <button className="btn" disabled={avatar.id === c.activeAvatarId} onClick={() => patch((x) => ({ ...x, activeAvatarId: avatar.id }))}>
                    {avatar.id === c.activeAvatarId ? "In use" : "Use this avatar"}
                  </button>
                  <button
                    className="btn btn-quiet danger"
                    onClick={() => {
                      patch((x) => {
                        const avatars = x.avatars.filter((y) => y.id !== avatar.id);
                        return { ...x, avatars, activeAvatarId: x.activeAvatarId === avatar.id ? avatars[0]?.id ?? null : x.activeAvatarId };
                      });
                      setSelected(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
            {avatar.kind === "model3d" && <ModelSettings c={c} a={avatar} update={update} />}
            {avatar.kind === "live2d" && <Live2DSettings c={c} a={avatar} update={update} />}
            {avatar.kind === "portraits" && <PortraitSettings c={c} a={avatar} update={update} />}
          </div>
        </div>
      ) : (
        <div className="empty">
          <p>Add a rigged 3D model, a Live2D model, or a set of portrait images. A companion can have several and switch between them during a call.</p>
        </div>
      )}
    </div>
  );
}

function ExpressionTester({ id }: { id: string }) {
  const [expr, setExpr] = useState<Expression>(() => live(id).expression);
  return (
    <div className="tester">
      <Select label="Preview expression" value={expr} options={EXPR_OPTIONS} onChange={(v) => { setExpr(v); updateLive(id, { expression: v }); }} />
      <div className="row wrap">
        {ACTIONS.map((a) => (
          <button key={a} className="chip" onClick={() => pushAction(id, a)}>{a.replace("_", " ")}</button>
        ))}
      </div>
    </div>
  );
}

function parseWeights(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of s.split(",")) {
    const [k, w] = part.split(":").map((x) => x.trim());
    if (k) out[k] = w ? Math.max(0, Math.min(1, Number(w) || 0)) : 1;
  }
  return out;
}
const fmtWeights = (m?: Record<string, number>) => (m ? Object.entries(m).map(([k, w]) => (w === 1 ? k : `${k}:${w}`)).join(", ") : "");

function ModelSettings({ c, a, update }: { c: Companion; a: ModelAvatar; update(a: Avatar): void }) {
  const addClip = async () => {
    const [f] = await platform().pickFiles({ accept: ["glb", "gltf"], title: "Select an animation clip (GLB)" });
    if (!f) return;
    const name = window.prompt("Which action should this clip play? (e.g. wave, nod, idle)", f.name.replace(/\.\w+$/, ""))?.trim().toLowerCase();
    if (!name) return;
    const [path] = await storeAssets(c.id, `model/clips`, [f]);
    update({ ...a, animations: { ...a.animations, [name]: { path, mime: mimeFromExt(f.name.split(".").pop()!) } } });
  };
  return (
    <>
      <details className="advanced">
        <summary>Camera</summary>
        <p className="hint">Zoom and shift under the preview are usually all you need. These set the starting camera.</p>
        <div className="grid-3">
          <NumberInput label="Distance" step={0.05} value={a.camera.distance} onChange={(v) => update({ ...a, camera: { ...a.camera, distance: v } })} />
          <NumberInput label="Eye height" step={0.02} value={a.camera.height} onChange={(v) => update({ ...a, camera: { ...a.camera, height: v } })} hint="0 = find the head automatically" />
          <NumberInput label="Field of view" value={a.camera.fov} onChange={(v) => update({ ...a, camera: { ...a.camera, fov: v } })} />
        </div>
      </details>
      <h3>Expressions → shape keys</h3>
      <p className="hint">VRM models work without setup. For other models, list shape keys with optional weights, e.g. <code>Smile:0.8, EyeSquint:0.3</code>.</p>
      <div className="grid-2">
        {EXPRESSIONS.map((e) => (
          <TextInput key={e} label={e} value={fmtWeights(a.expressionMap[e])} onChange={(v) => update({ ...a, expressionMap: { ...a.expressionMap, [e]: parseWeights(v) } })} />
        ))}
      </div>
      <TextInput label="Lip sync shape keys" value={a.lipSyncKeys.join(", ")} onChange={(v) => update({ ...a, lipSyncKeys: v.split(",").map((s) => s.trim()).filter(Boolean) })} hint="Leave empty to use “aa” on VRM or a detected mouth key" />
      <h3>Animation clips</h3>
      <p className="hint">Clips named after an action (wave, nod, bow…) replace the built-in gestures. A clip named “idle” loops.</p>
      <ul className="plain">
        {Object.keys(a.animations).map((k) => (
          <li key={k} className="row">
            <span>{k}</span>
            <button className="icon-btn" aria-label={`Remove ${k} clip`} onClick={() => { const { [k]: _x, ...rest } = a.animations; update({ ...a, animations: rest }); }}><Icon name="trash" size={16} /></button>
          </li>
        ))}
      </ul>
      <button className="btn btn-quiet" onClick={addClip}><Icon name="plus" size={16} /> Add clip</button>
    </>
  );
}

function describeLive2D(json: any): { expressions: string[]; motions: string[] } {
  const refs = json.FileReferences ?? json;
  const exprs = (refs.Expressions ?? refs.expressions ?? []).map((e: any) => String(e.Name ?? e.name));
  const motions = Object.keys(refs.Motions ?? refs.motions ?? {});
  return { expressions: exprs, motions };
}

function guessLive2DExpressions(names: string[]): Live2DAvatar["expressionMap"] {
  const out: Live2DAvatar["expressionMap"] = {};
  for (const n of names) {
    const e = canonicalExpression(n);
    if (e && !out[e]) out[e] = n;
  }
  return out;
}

function Live2DSettings({ c, a, update }: { c: Companion; a: Live2DAvatar; update(a: Avatar): void }) {
  const [info, setInfo] = useState<{ expressions: string[]; motions: string[] }>({ expressions: [], motions: [] });
  useEffect(() => {
    void platform().readAsset(`companion/${c.id}`, a.entry.path).then((b) => b && setInfo(describeLive2D(JSON.parse(utf8Decode(b)))));
  }, [c.id, a.entry.path]);
  const exprOpts = [{ value: "", label: "— none —" }, ...info.expressions.map((n) => ({ value: n, label: n }))];
  const motionOpts = [{ value: "", label: "— none —" }, ...info.motions.map((n) => ({ value: n, label: n }))];
  return (
    <>
      <h3>Expressions</h3>
      {info.expressions.length === 0 && <p className="hint">This model defines no expressions; its face will only animate with lip sync and motions.</p>}
      <div className="grid-2">
        {info.expressions.length > 0 && EXPRESSIONS.map((e) => (
          <Select key={e} label={e} value={a.expressionMap[e] ?? ""} options={exprOpts} onChange={(v) => update({ ...a, expressionMap: { ...a.expressionMap, [e]: v || undefined } })} />
        ))}
      </div>
      <h3>Actions → motion groups</h3>
      <div className="grid-2">
        {ACTIONS.map((act) => (
          <Select key={act} label={act.replace("_", " ")} value={a.motionMap[act]?.group ?? ""} options={motionOpts}
            onChange={(v) => {
              const motionMap = { ...a.motionMap };
              if (v) motionMap[act] = { group: v };
              else delete motionMap[act];
              update({ ...a, motionMap });
            }} />
        ))}
      </div>
      <TextInput label="Mouth parameter" value={a.lipSyncParam} placeholder="ParamMouthOpenY" onChange={(v) => update({ ...a, lipSyncParam: v })} />
    </>
  );
}

function keyFromFilename(name: string): string {
  return portraitKeyFor(name);
}

function PortraitSettings({ c, a, update }: { c: Companion; a: PortraitAvatar; update(a: Avatar): void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const out: Record<string, string> = {};
      for (const ref of Object.values(a.images).flat()) out[ref.path] = (await assetUrl(c.id, ref.path)) ?? "";
      setUrls(out);
    })();
  }, [c.id, a.images]);

  const entries = Object.entries(a.images).flatMap(([k, refs]) => refs.map((r) => ({ key: k, ref: r })));
  const keys = [...new Set([...EXPRESSIONS, ...ACTIONS, ...Object.keys(a.images)])];
  const keyOpts = keys.map((k) => ({ value: k, label: k }));

  const reassign = (path: string, newKey: string) => {
    const images: PortraitAvatar["images"] = {};
    for (const { key, ref } of entries) {
      const k = ref.path === path ? newKey : key;
      (images[k] ??= []).push(ref);
    }
    update({ ...a, images, fallback: images[a.fallback] ? a.fallback : Object.keys(images)[0] });
  };
  const remove = (path: string) => {
    const images: PortraitAvatar["images"] = {};
    for (const { key, ref } of entries) if (ref.path !== path) (images[key] ??= []).push(ref);
    update({ ...a, images, fallback: images[a.fallback] ? a.fallback : Object.keys(images)[0] ?? "neutral" });
  };
  const addMore = async () => {
    const files = await platform().pickFiles({ accept: ["png", "jpg", "jpeg", "webp", "gif", "avif"], multiple: true });
    if (!files.length) return;
    const paths = await storeAssets(c.id, `portraits/${uid().slice(0, 8)}`, files);
    const images = structuredClone(a.images);
    files.forEach((f, i) => (images[keyFromFilename(f.name)] ??= []).push({ path: paths[i], mime: mimeFromExt(f.name.split(".").pop()!) }));
    update({ ...a, images });
  };

  const missing = EXPRESSIONS.filter((e) => !a.images[e]);
  return (
    <>
      <p className="hint">Each image shows for the expression or action it's assigned to. Several images on one expression rotate for variety. An image keyed <code>happy{a.talkingSuffix}</code> alternates with <code>happy</code> while speaking.</p>
      <ul className="portrait-grid">
        {entries.map(({ key, ref }) => (
          <li key={ref.path}>
            <img src={urls[ref.path]} alt={`${key} portrait`} />
            <select aria-label="Expression for this image" value={key} onChange={(e) => reassign(ref.path, e.target.value)}>
              {keyOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {a.talkingSuffix && <option value={`${key}${a.talkingSuffix}`}>{`${key}${a.talkingSuffix}`}</option>}
            </select>
            <button className="icon-btn" aria-label="Remove image" onClick={() => remove(ref.path)}><Icon name="trash" size={14} /></button>
          </li>
        ))}
      </ul>
      <button className="btn btn-quiet" onClick={addMore}><Icon name="plus" size={16} /> Add images</button>
      {missing.length > 0 && <p className="hint">No image yet for: {missing.join(", ")}. These fall back to “{a.fallback}”.</p>}
      <div className="grid-3">
        <Select label="Fallback image" value={a.fallback} options={Object.keys(a.images).map((k) => ({ value: k, label: k }))} onChange={(v) => update({ ...a, fallback: v })} />
        <NumberInput label="Crossfade (ms)" value={a.transitionMs} min={0} max={2000} onChange={(v) => update({ ...a, transitionMs: v })} />
        <TextInput label="Talking suffix" value={a.talkingSuffix} onChange={(v) => update({ ...a, talkingSuffix: v })} />
      </div>
    </>
  );
}

// ───────────────────────── Framing ─────────────────────────

/** Avatar preview you can drag to shift and scroll (or pinch) to zoom. */
function FramingPreview({ c, avatar, update, reduceMotion }: { c: Companion; avatar: Avatar; update(a: Avatar): void; reduceMotion: boolean }) {
  const style = useCallWindowStyle(c);
  const f = avatar.framing ?? DEFAULT_FRAMING;
  const set = (nf: Partial<AvatarFraming>) => update({ ...avatar, framing: clampFraming({ ...f, ...nf }) });
  const drag = useRef<{ x: number; y: number; f: AvatarFraming; w: number; h: number } | null>(null);
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // React's wheel listeners are passive, so the page would scroll too; use a native one.
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ f, set });
  latest.current = { f, set };
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { f: cur, set: apply } = latest.current;
      apply({ zoom: cur.zoom * Math.exp(-e.deltaY * 0.0015) });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      ref={el}
      className={`call-window frame-${c.presentation.frame} framing-target`}
      style={style}
      title="Drag to move · scroll or pinch to zoom"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const r = e.currentTarget.getBoundingClientRect();
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: f.zoom };
          drag.current = null;
        } else {
          drag.current = { x: e.clientX, y: e.clientY, f, w: r.width, h: r.height };
        }
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.current && pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          set({ zoom: pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d) });
        } else if (drag.current) {
          const d = drag.current;
          set({ x: d.f.x + (e.clientX - d.x) / d.w, y: d.f.y + (e.clientY - d.y) / d.h });
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (!pointers.current.size) drag.current = null;
      }}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
    >
      <AvatarView companion={{ ...c, activeAvatarId: avatar.id }} framing="call" reduceMotion={reduceMotion} />
    </div>
  );
}

function clampFraming(f: AvatarFraming): AvatarFraming {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { zoom: r(Math.min(4, Math.max(0.3, f.zoom))), x: r(Math.min(0.8, Math.max(-0.8, f.x))), y: r(Math.min(0.8, Math.max(-0.8, f.y))) };
}

function FramingControls({ avatar, update }: { avatar: Avatar; update(a: Avatar): void }) {
  const f = avatar.framing ?? DEFAULT_FRAMING;
  const set = (nf: Partial<AvatarFraming>) => update({ ...avatar, framing: clampFraming({ ...f, ...nf }) });
  const moved = f.zoom !== 1 || f.x !== 0 || f.y !== 0;
  return (
    <div className="framing">
      <div className="row framing-head">
        <h3>Position in the window</h3>
        <button className="btn btn-quiet" disabled={!moved} onClick={() => update({ ...avatar, framing: { ...DEFAULT_FRAMING } })}>Reset</button>
      </div>
      <Slider label="Zoom" min={0.3} max={4} step={0.05} value={f.zoom} onChange={(zoom) => set({ zoom })} format={(v) => `${Math.round(v * 100)}%`} />
      <Slider label="Left / right" min={-0.8} max={0.8} step={0.01} value={f.x} onChange={(x) => set({ x })} format={(v) => (Math.abs(v) < 0.005 ? "Centred" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`)} />
      <Slider label="Up / down" min={-0.8} max={0.8} step={0.01} value={f.y} onChange={(y) => set({ y })} format={(v) => (Math.abs(v) < 0.005 ? "Centred" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "up" : "down"}`)} />
    </div>
  );
}

// ───────────────────────── Call window ─────────────────────────

function CallWindowSettings({ c, patch }: TabProps) {
  const p = c.presentation;
  const setP = (np: Partial<typeof p>) => patch((x) => ({ ...x, presentation: { ...x.presentation, ...np } }));
  const pickBackground = async () => {
    const [f] = await platform().pickFiles({ accept: ["png", "jpg", "jpeg", "webp"], title: "Background image" });
    if (!f) return;
    const [path] = await storeAssets(c.id, "background", [f]);
    setP({ background: { type: "image", image: { path, mime: mimeFromExt(f.name.split(".").pop()!) }, fit: "cover" } });
  };
  return (
    <div className="call-window-settings">
      <h3>Call window</h3>
      <Select label="Frame" value={p.frame} onChange={(frame) => setP({ frame })} options={[
        { value: "circle", label: "Circle" }, { value: "rounded", label: "Rounded rectangle" }, { value: "rectangle", label: "Rectangle" },
      ]} />
      <Select label="Dialogue display" value={p.textStyle} onChange={(textStyle) => setP({ textStyle })} options={[
        { value: "bubble", label: "Speech bubble" }, { value: "popup", label: "Pop-up card" }, { value: "subtitle", label: "Subtitles" },
      ]} />
      <Select label="Appears as" value={p.mode} onChange={(mode) => setP({ mode })} options={[
        { value: "call", label: "Video-call window" },
        ...(platform().overlay ? [{ value: "overlay" as const, label: "Full body on the desktop" }] : []),
      ]} hint={platform().overlay ? undefined : "Desktop overlay is available on Windows and Linux"} />
      <div className="field">
        <label>Background</label>
        <div className="row wrap">
          <input type="color" aria-label="Background colour" value={p.background.type === "color" ? p.background.color : "#1d2433"} onChange={(e) => setP({ background: { type: "color", color: e.target.value } })} />
          <button className="btn btn-quiet" onClick={pickBackground}>Use an image</button>
          {p.background.type === "image" && (
            <select aria-label="Image fit" value={p.background.fit} onChange={(e) => setP({ background: { ...(p.background as { type: "image"; image: { path: string; mime: string }; fit: "cover" }), fit: e.target.value as "cover" | "contain" } })}>
              <option value="cover">Fill</option>
              <option value="contain">Fit</option>
            </select>
          )}
        </div>
      </div>
      {platform().overlay && (
        <Slider label="Size on desktop" min={0.2} max={0.9} step={0.05} value={p.overlayScale} onChange={(overlayScale) => setP({ overlayScale })} format={(x) => `${Math.round(x * 100)}% of screen height`} />
      )}
    </div>
  );
}

// ───────────────────────── Voice & behaviour ─────────────────────────

function VoiceBehaviourTab({ c, patch }: TabProps) {
  const tts = useStore((s) => s.settings.ttsEndpoints);
  const notify = useStore((s) => s.notify);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const v = c.voice;
  const b = c.behaviour;
  const setV = (nv: Partial<typeof v>) => patch((x) => ({ ...x, voice: { ...x.voice, ...nv } }));
  const set = (nb: Partial<typeof b>) => patch((x) => ({ ...x, behaviour: { ...x.behaviour, ...nb } }));
  const endpoint = tts.find((t) => t.id === v.ttsEndpointId);
  const name = c.character.nickname || c.character.name;

  useEffect(() => {
    if (!endpoint) return setVoices([]);
    void createTTS(endpoint, platform().fetch).listVoices().then(setVoices).catch(() => setVoices([]));
  }, [endpoint]);

  const testVoice = async () => {
    if (!endpoint) return;
    try {
      const res = await createTTS(endpoint, platform().fetch).synthesize({ text: `Hi, I'm ${name}.`, voice: v.voiceId, speed: v.speed });
      if (res.audio) {
        const { playAudio } = await import("../state/audio");
        playAudio(res.audio, (amp) => updateLive(c.id, { amplitude: amp }));
      }
    } catch (e) {
      notify("error", (e as Error).message);
    }
  };

  return (
    <div className="form">
      <h3>Voice</h3>
      <Select
        label="Voice engine"
        value={v.ttsEndpointId}
        onChange={(ttsEndpointId) => setV({ ttsEndpointId, hideTextWhenSpeaking: ttsEndpointId ? v.hideTextWhenSpeaking : false })}
        options={[{ value: "", label: "None — text only" }, ...tts.map((t) => ({ value: t.id, label: t.label }))]}
        hint={tts.length ? undefined : "Connect a voice engine in Settings → Voices to give companions speech."}
      />
      {endpoint && (
        <>
          <div className="grid-2">
            {voices.length ? (
              <Select label="Voice" value={v.voiceId} onChange={(voiceId) => setV({ voiceId })} options={[{ value: "", label: "Engine default" }, ...voices.map((x) => ({ value: x.id, label: x.name }))]} />
            ) : (
              <TextInput label="Voice" value={v.voiceId} onChange={(voiceId) => setV({ voiceId })} placeholder={endpoint.defaultVoice} />
            )}
            <Slider label="Speed" min={0.5} max={2} step={0.05} value={v.speed} onChange={(speed) => setV({ speed })} format={(x) => `${x.toFixed(2)}×`} />
          </div>
          <Toggle label="Hide text while speaking" checked={v.hideTextWhenSpeaking} onChange={(hideTextWhenSpeaking) => setV({ hideTextWhenSpeaking })} hint="Dialogue is only heard. The transcript still records it." />
          <button className="btn" onClick={testVoice}>Play a sample</button>
        </>
      )}

      <h3>Behaviour</h3>
      <Toggle
        label="Greets you in their own words"
        checked={b.spontaneousGreeting !== false}
        onChange={(spontaneousGreeting) => set({ spontaneousGreeting })}
        hint={`In Chat and Call, ${name} opens with a greeting of their own that reflects how well they know your persona, instead of the card's first message. Roleplay always uses the first message.`}
      />
      <div className="fourth-wall" data-on={b.fourthWallAware || undefined}>
        <Toggle
          label="Fourth Wall Awareness"
          checked={b.fourthWallAware}
          onChange={(fourthWallAware) => set({ fourthWallAware })}
          hint={`${c.character.name} knows they're an AI playing a character inside CyPals on your device, and now and then remarks on the one-sided nature of your conversations — while staying fully in character.`}
        />
        {b.fourthWallAware && (
          <Slider
            label="How often they bring it up"
            min={0.02} max={0.6} step={0.02}
            value={b.fourthWallFrequency}
            onChange={(fourthWallFrequency) => set({ fourthWallFrequency })}
            format={(x) => (x < 0.1 ? "Rarely" : x < 0.25 ? "Sometimes" : x < 0.4 ? "Often" : "Very often")}
            hint="Never more than once every four replies."
          />
        )}
      </div>
      <Toggle label="Talks with other companions" checked={b.autonomousChat} onChange={(autonomousChat) => set({ autonomousChat })} hint="When others are on the call, they can reply to each other without waiting for you." />
      <Slider
        label="Speaks up when you're quiet"
        min={0} max={600} step={30}
        value={b.idleChatterSeconds}
        onChange={(idleChatterSeconds) => set({ idleChatterSeconds })}
        format={(x) => (x === 0 ? "Never" : x < 60 ? `After ${x} s` : `After ${Math.round(x / 60)} min`)}
      />
    </div>
  );
}

// ───────────────────────── Lore & model ─────────────────────────

function LoreTab({ c, patch }: TabProps) {
  const lorebooks = useStore((s) => s.lorebooks);
  const profiles = useStore((s) => s.settings.llmProfiles);
  const promote = useStore((s) => s.promoteEmbeddedLorebook);
  const setView = useStore((s) => s.setView);
  const list = Object.values(lorebooks);
  return (
    <div className="form">
      <h3>Lorebooks</h3>
      {c.embeddedLorebook && (
        <div className="callout">
          <p>
            <strong>{c.embeddedLorebook.name}</strong> came with this character's card ({c.embeddedLorebook.entries.length} entries). It's active for {c.character.name} only.
          </p>
          <button className="btn" onClick={() => promote(c.id)}>Move to library to share with other companions</button>
        </div>
      )}
      {list.length === 0 ? (
        <p className="hint">
          No lorebooks in your library. <button className="link" onClick={() => setView("lorebooks")}>Create or import one</button>
        </p>
      ) : (
        <ul className="plain check-list">
          {list.map((lb) => {
            const on = c.lorebookIds.includes(lb.id);
            return (
              <li key={lb.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => patch((x) => ({ ...x, lorebookIds: on ? x.lorebookIds.filter((y) => y !== lb.id) : [...x.lorebookIds, lb.id] }))}
                  />
                  <span>{lb.name}</span>
                  <small>{lb.entries.length} entries</small>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <h3>Model</h3>
      <Select
        label="Language model"
        value={c.llmProfileId ?? ""}
        onChange={(v) => patch((x) => ({ ...x, llmProfileId: v || null }))}
        options={[{ value: "", label: "App default" }, ...profiles.map((p) => ({ value: p.id, label: `${p.label} — ${p.model}` }))]}
        hint="Give a companion its own model, e.g. a local model for one and a cloud model for another."
      />
    </div>
  );
}
