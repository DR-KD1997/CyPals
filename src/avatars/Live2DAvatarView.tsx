/**
 * Live2D avatar via pixi-live2d-display (Cubism 2 and 3/4/5 models).
 *
 * Live2D's Cubism Core runtime is proprietary and can't be redistributed in
 * the app bundle. CyPals loads `live2dcubismcore.min.js` from public/vendor/
 * (dev) or asks the user to point at the file once (stored as an app asset).
 * Cubism 2 models additionally need `live2d.min.js`.
 */
import { useEffect, useRef, useState } from "react";
import type { Companion, Live2DAvatar } from "../core/types";
import { live } from "../state/live";
import { platform } from "../platform";
import { useStore } from "../state/store";

interface Props {
  companion: Companion;
  avatar: Live2DAvatar;
  framing: "call" | "overlay";
  reduceMotion: boolean;
  onError(msg: string): void;
}

const CORE_SCOPE = "vendor";
const CORE_FILES = { cubism4: "live2dcubismcore.min.js", cubism2: "live2d.min.js" } as const;

async function loadScript(name: keyof typeof CORE_FILES): Promise<boolean> {
  const g = window as unknown as Record<string, unknown>;
  if (name === "cubism4" && g.Live2DCubismCore) return true;
  if (name === "cubism2" && g.Live2D) return true;
  const file = CORE_FILES[name];
  // 1) user-provided copy stored in app data, 2) bundled dev copy in public/vendor.
  const stored = await platform().readAsset(CORE_SCOPE, file);
  const src = stored ? URL.createObjectURL(new Blob([stored as BlobPart], { type: "text/javascript" })) : `/vendor/${file}`;
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export async function installLive2DCore(): Promise<boolean> {
  const files = await platform().pickFiles({ accept: ["js"], multiple: true, title: "Select live2dcubismcore.min.js (and live2d.min.js for Cubism 2)" });
  let ok = false;
  for (const f of files) {
    const base = f.name.split(/[\\/]/).pop()!;
    if (base === CORE_FILES.cubism4 || base === CORE_FILES.cubism2) {
      await platform().writeAsset(CORE_SCOPE, base, f.bytes);
      ok = true;
    }
  }
  return ok;
}

export function Live2DAvatarView({ companion, avatar, framing, reduceMotion, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const avatarKey = JSON.stringify(avatar);
  const [needsCore, setNeedsCore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    let app: import("pixi.js").Application | null = null;
    let detachPointer = () => {};

    (async () => {
      const cubism2 = avatar.entry.path.endsWith(".model.json");
      if (!(await loadScript(cubism2 ? "cubism2" : "cubism4"))) {
        setNeedsCore(true);
        return;
      }
      setNeedsCore(false);
      const PIXI = await import("pixi.js");
      (window as unknown as { PIXI: unknown }).PIXI = PIXI; // pixi-live2d-display hooks the global ticker
      const mod = cubism2 ? await import("pixi-live2d-display/cubism2") : await import("pixi-live2d-display/cubism4");
      const { Live2DModel } = mod;
      Live2DModel.registerTicker(PIXI.Ticker);
      if (disposed) return;

      app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio), resizeTo: el });
      el.appendChild(app.view);

      // Load from in-memory files so relative paths inside model3.json resolve.
      const files: File[] = [];
      const prefix = avatar.entry.path.slice(0, avatar.entry.path.lastIndexOf("/") + 1);
      for (const ref of [avatar.entry, ...avatar.files]) {
        const bytes = await platform().readAsset(`companion/${companion.id}`, ref.path);
        if (!bytes) continue;
        const rel = ref.path.startsWith(prefix) ? ref.path.slice(prefix.length) : ref.path;
        const f = new File([bytes as BlobPart], rel.split("/").pop()!, { type: ref.mime });
        Object.defineProperty(f, "webkitRelativePath", { value: `model/${rel}` });
        files.push(f);
      }
      let model: InstanceType<typeof Live2DModel>;
      try {
        model = await Live2DModel.from(files, { autoInteract: false });
      } catch (e) {
        onError(`Live2D model failed to load: ${(e as Error).message}`);
        return;
      }
      if (disposed) {
        model.destroy();
        return;
      }
      app.stage.addChild(model as unknown as import("pixi.js").DisplayObject);

      const layout = () => {
        if (!app) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        const mw = model.internalModel.originalWidth;
        const mh = model.internalModel.originalHeight;
        // Call mode crops to the upper body; overlay shows the whole model.
        const s = framing === "overlay" ? Math.min(w / mw, h / mh) : Math.max(w / mw, (h / mh) * 1.9);
        model.scale.set(s * avatar.scale);
        model.anchor.set(0.5, framing === "overlay" ? 0.5 : 0.18);
        model.position.set(w / 2 + avatar.offset.x * w, (framing === "overlay" ? h / 2 : 0) + avatar.offset.y * h);
      };
      layout();
      const ro = new ResizeObserver(layout);
      ro.observe(el);

      const onPointer = (e: PointerEvent) => {
        if (reduceMotion) return;
        const r = el.getBoundingClientRect();
        model.focus(e.clientX - r.left, e.clientY - r.top);
      };
      window.addEventListener("pointermove", onPointer);
      detachPointer = () => {
        window.removeEventListener("pointermove", onPointer);
        ro.disconnect();
      };

      let lastExpr = "";
      const core = model.internalModel.coreModel as unknown as {
        setParameterValueById?(id: string, v: number): void;
        setParamFloat?(id: string, v: number): void;
      };
      model.internalModel.on("beforeModelUpdate", () => {
        const st = live(companion.id);
        if (st.expression !== lastExpr) {
          lastExpr = st.expression;
          const name = avatar.expressionMap[st.expression];
          if (name) void model.expression(name);
          else if (st.expression === "neutral") model.internalModel.motionManager.expressionManager?.resetExpression();
        }
        const param = avatar.lipSyncParam || (cubism2 ? "PARAM_MOUTH_OPEN_Y" : "ParamMouthOpenY");
        const v = Math.min(1, st.amplitude * 1.2);
        if (st.speaking || v > 0) {
          if (core.setParameterValueById) core.setParameterValueById(param, v);
          else core.setParamFloat?.(param, v);
        }
        const action = st.actions.shift();
        if (action) {
          const m = avatar.motionMap[String(action)];
          if (m) void model.motion(m.group, m.index);
          else if (!reduceMotion) void model.motion("TapBody");
        }
      });
    })().catch((e) => !disposed && onError(`Live2D error: ${(e as Error).message}`));

    return () => {
      disposed = true;
      detachPointer();
      app?.destroy(true, { children: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion.id, avatarKey, framing, reduceMotion, onError, attempt]);

  return (
    <div ref={host} className="avatar-canvas">
      {needsCore && (
        <div className="avatar-setup">
          <p>Live2D needs the Cubism Core runtime, which Live2D Inc. distributes separately.</p>
          <p>Download the Cubism SDK for Web from live2d.com and select <code>live2dcubismcore.min.js</code> from its Core folder.</p>
          <button
            className="btn"
            onClick={async () => {
              if (await installLive2DCore()) {
                notify("info", "Cubism Core installed");
                setAttempt((n) => n + 1);
              }
            }}
          >
            Select Cubism Core file
          </button>
        </div>
      )}
    </div>
  );
}
