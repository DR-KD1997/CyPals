/**
 * Rigged 3D avatar (VRM, GLB, glTF) via three.js + three-vrm.
 *
 *  - Expressions: VRM presets / custom expressions, or morph targets (shape keys)
 *    on plain glTF, using the avatar's expressionMap with sensible guesses.
 *  - Lip sync: mouth shape key driven by voice amplitude.
 *  - Blink, breathing and idle sway; eyes follow the pointer.
 *  - Actions: matching animation clip if the model (or an attached clip file)
 *    has one, otherwise a procedural gesture on the humanoid rig.
 *  - "call" mode frames head & shoulders; "overlay" mode frames the full body
 *    on a transparent background.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { DEFAULT_FRAMING, type AvatarFraming, type Companion, type ModelAvatar } from "../core/types";
import { live } from "../state/live";
import { assetUrl } from "../state/assets";
import { BLINK_GUESSES, GLTF_GUESSES, MOUTH_GUESSES, VRM_EXPRESSIONS } from "./expressionMaps";
import { GESTURE_DURATION, gesture, type BoneOffsets } from "./gestures";
import { canonicalExpression } from "../core/synonyms";

interface Props {
  companion: Companion;
  avatar: ModelAvatar;
  framing: "call" | "overlay";
  reduceMotion: boolean;
  /** Solid call background, painted inside the scene (not relying on canvas alpha). */
  backgroundColor?: string;
  onError(msg: string): void;
}

type MorphIndex = Map<string, { mesh: THREE.Mesh; index: number }[]>;

function indexMorphs(root: THREE.Object3D): MorphIndex {
  const idx: MorphIndex = new Map();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(m.morphTargetDictionary)) {
      if (!idx.has(name)) idx.set(name, []);
      idx.get(name)!.push({ mesh: m, index });
    }
  });
  return idx;
}

function firstPresent(idx: MorphIndex, names: string[]): string | null {
  return names.find((n) => idx.has(n)) ?? null;
}

export function ModelAvatarView({ companion, avatar, framing, reduceMotion, backgroundColor, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Framing changes re-aim the camera live instead of reloading the model.
  const avatarKey = JSON.stringify({ ...avatar, framing: undefined });
  const framingRef = useRef<AvatarFraming>(avatar.framing ?? DEFAULT_FRAMING);
  framingRef.current = avatar.framing ?? DEFAULT_FRAMING;
  const reframe = useRef<() => void>(() => {});
  const framingKey = JSON.stringify(framingRef.current);
  useEffect(() => reframe.current(), [framingKey]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    if (framing === "call" && backgroundColor) scene.background = new THREE.Color(backgroundColor);
    const camera = new THREE.PerspectiveCamera(avatar.camera.fov, 1, 0.05, 50);
    scene.add(new THREE.HemisphereLight(0xfff4e8, 0x2a3b44, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.4, 1.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fe3d6, 0.9);
    rim.position.set(-1, 1.2, -1.2);
    scene.add(rim);

    const lookTarget = new THREE.Object3D();
    scene.add(lookTarget);
    const clock = new THREE.Clock();
    let vrm: VRM | null = null;
    let root: THREE.Object3D | null = null;
    let morphs: MorphIndex = new Map();
    let mixer: THREE.AnimationMixer | null = null;
    const clips = new Map<string, THREE.AnimationClip>();
    const weights = new Map<string, number>();
    let raf = 0;
    let blinkAt = 2;
    let blinkT = -1;
    let currentGesture: { name: string; start: number } | null = null;

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      frame();
    };

    const frame = () => {
      if (!root) return;
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      if (framing === "overlay") {
        const fitH = size.y / 2 / Math.tan((camera.fov * Math.PI) / 360);
        camera.position.set(center.x, center.y, box.max.z + fitH * 1.08);
        camera.lookAt(center.x, center.y, center.z);
      } else {
        const headY = vrm?.humanoid?.getNormalizedBoneNode("head")?.getWorldPosition(new THREE.Vector3()).y ?? box.max.y - size.y * 0.08;
        // The head bone sits at the base of the skull; eyes are ~7 cm above it.
        const y = avatar.camera.height > 0 ? avatar.camera.height : headY + 0.07;
        // User framing: zoom moves the camera in/out; x/y shift the character within the window.
        const f = framingRef.current;
        const dist = avatar.camera.distance / Math.max(0.2, f.zoom);
        const visH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
        const visW = visH * camera.aspect;
        const cx = center.x - f.x * visW;
        const cy = y + f.y * visH;
        camera.position.set(cx, cy, center.z + dist);
        camera.lookAt(cx, cy - 0.05, center.z);
      }
      lookTarget.position.copy(camera.position);
    };

    reframe.current = frame;

    const onPointer = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      lookTarget.position.set(camera.position.x + nx * 0.6, camera.position.y + ny * 0.4, camera.position.z);
    };
    window.addEventListener("pointermove", onPointer);

    const setMorph = (name: string, w: number) => {
      if (vrm?.expressionManager?.getExpression(name)) {
        vrm.expressionManager.setValue(name, w);
        return;
      }
      for (const t of morphs.get(name) ?? []) if (t.mesh.morphTargetInfluences) t.mesh.morphTargetInfluences[t.index] = w;
    };

    const targetsFor = (expr: keyof typeof VRM_EXPRESSIONS): Record<string, number> => {
      const custom = avatar.expressionMap[expr];
      if (custom && Object.keys(custom).length) return custom;
      if (vrm?.expressionManager) return VRM_EXPRESSIONS[expr];
      const out: Record<string, number> = {};
      for (const group of GLTF_GUESSES[expr]) {
        const hit = firstPresent(morphs, group);
        if (hit) out[hit] = 1;
      }
      if (!Object.keys(out).length && expr !== "neutral") {
        // Any shape key whose name is a synonym of the expression ("Sadness", "Embarassed").
        for (const name of morphs.keys()) if (canonicalExpression(name) === expr) out[name] = 1;
      }
      return out;
    };

    const mouthKeys = () => {
      if (avatar.lipSyncKeys.length) return avatar.lipSyncKeys;
      if (vrm?.expressionManager) return ["aa"];
      const m = firstPresent(morphs, MOUTH_GUESSES);
      return m ? [m] : [];
    };

    const applyGesture = (offs: BoneOffsets) => {
      if (!vrm?.humanoid) return;
      for (const [bone, [x, y, z]] of Object.entries(offs) as [string, [number, number, number]][]) {
        const node = vrm.humanoid.getNormalizedBoneNode(bone as never);
        if (!node) continue;
        node.rotation.x += x;
        node.rotation.y += y;
        node.rotation.z += z;
      }
    };

    const restPose = () => {
      if (!vrm?.humanoid) return;
      const h = vrm.humanoid;
      // Relax the T-pose into a natural A-pose; gestures add on top each frame.
      h.resetNormalizedPose();
      // Facing +Z, the left arm points along +X: negative Z rotation lowers it.
      h.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, -1.2);
      h.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, 1.2);
      h.getNormalizedBoneNode("leftLowerArm")?.rotation.set(0, -0.15, 0);
      h.getNormalizedBoneNode("rightLowerArm")?.rotation.set(0, 0.15, 0);
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const t = clock.elapsedTime;
      const st = live(companion.id);

      // ── expression blending ──
      const target = targetsFor(st.expression);
      const keys = new Set([...weights.keys(), ...Object.keys(target)]);
      for (const k of keys) {
        const cur = weights.get(k) ?? 0;
        const goal = target[k] ?? 0;
        const next = cur + (goal - cur) * Math.min(1, dt * 8);
        weights.set(k, next);
        setMorph(k, next);
      }

      // ── lip sync ──
      const amp = st.amplitude;
      for (const k of mouthKeys()) setMorph(k, Math.min(1, amp * 1.1));

      // ── blink ──
      if (!reduceMotion) {
        if (blinkT < 0 && t > blinkAt) blinkT = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          const b = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.1);
          const name = vrm?.expressionManager ? "blink" : firstPresent(morphs, BLINK_GUESSES);
          if (name && st.expression !== "sleepy") setMorph(name, b);
          if (blinkT > 0.2) {
            blinkT = -1;
            blinkAt = t + 1.8 + Math.random() * 4;
          }
        }
      }

      // ── body: rest pose + breathing + gesture ──
      if (vrm?.humanoid) {
        restPose();
        if (!reduceMotion) {
          applyGesture({
            spine: [Math.sin(t * 1.6) * 0.015, Math.sin(t * 0.35) * 0.03, 0],
            chest: [Math.sin(t * 1.6 + 0.6) * 0.01, 0, 0],
            head: [st.speaking ? Math.sin(t * 3.1) * 0.03 * amp : 0, Math.sin(t * 0.45) * 0.05, Math.sin(t * 0.3) * 0.03],
          });
        }
        if (!currentGesture && st.actions.length) {
          const name = String(st.actions.shift());
          const clip = clips.get(name) ?? clips.get(name.replace(/_/g, ""));
          if (clip && mixer) {
            const action = mixer.clipAction(clip);
            action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play();
            action.clampWhenFinished = false;
          } else if (!reduceMotion) {
            currentGesture = { name, start: t };
          }
        }
        if (currentGesture) {
          const dur = GESTURE_DURATION[currentGesture.name] ?? 1.5;
          const p = (t - currentGesture.start) / dur;
          if (p >= 1) currentGesture = null;
          else applyGesture(gesture(currentGesture.name, p));
        }
      } else if (st.actions.length && mixer) {
        const name = String(st.actions.shift());
        const clip = clips.get(name);
        if (clip) mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
      }

      mixer?.update(dt);
      vrm?.update(dt);
      renderer.render(scene, camera);
    };

    (async () => {
      try {
        const url = await assetUrl(companion.id, avatar.model.path);
        if (!url) throw new Error(`Model file missing: ${avatar.model.path}`);
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf: GLTF = await loader.loadAsync(url);
        if (disposed) return;
        vrm = (gltf.userData.vrm as VRM | undefined) ?? null;
        if (vrm) {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.combineSkeletons(gltf.scene);
          VRMUtils.rotateVRM0(vrm);
          if (vrm.lookAt) vrm.lookAt.target = lookTarget;
          root = vrm.scene;
        } else {
          root = gltf.scene;
        }
        scene.add(root);
        morphs = indexMorphs(root);
        mixer = new THREE.AnimationMixer(root);
        for (const c of gltf.animations) clips.set(c.name.toLowerCase(), c);
        // Extra clips attached to the avatar (GLB files containing animations).
        for (const [name, ref] of Object.entries(avatar.animations)) {
          const u = await assetUrl(companion.id, ref.path);
          if (!u) continue;
          const extra = await new GLTFLoader().loadAsync(u).catch(() => null);
          if (extra?.animations[0]) clips.set(name.toLowerCase(), extra.animations[0]);
        }
        const idle = clips.get("idle");
        if (idle && !vrm) mixer.clipAction(idle).play();
        restPose();
        vrm?.update(0);
        resize();
        setLoading(false);
        tick();
      } catch (e) {
        if (!disposed) onError(`3D model failed to load: ${(e as Error).message}`);
      }
    })();

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      if (root) VRMUtils.deepDispose(root);
      renderer.dispose();
      renderer.domElement.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion.id, avatarKey, framing, reduceMotion, backgroundColor, onError]);

  return (
    <div ref={host} className="avatar-canvas" data-loading={loading || undefined}>
      {loading && <span className="avatar-loading">Loading model…</span>}
    </div>
  );
}
