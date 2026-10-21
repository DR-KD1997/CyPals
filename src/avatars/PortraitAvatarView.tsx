/**
 * Portrait-set avatar: a collection of images keyed by expression (and
 * optionally by action). Switching expressions crossfades; while speaking,
 * a `<expr>_talk` image (if provided) alternates with the base for mouth
 * flaps; actions without an image play a small motion on the portrait.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FRAMING, type Companion, type PortraitAvatar } from "../core/types";
import { live, subscribeLive } from "../state/live";
import { assetUrl } from "../state/assets";
import { portraitKeysFor, talkingKeyFor } from "../core/synonyms";

interface Props {
  companion: Companion;
  avatar: PortraitAvatar;
  framing: "call" | "overlay";
  reduceMotion: boolean;
}

export function PortraitAvatarView({ companion, avatar, framing, reduceMotion }: Props) {
  const imagesKey = JSON.stringify(avatar.images);
  const [urls, setUrls] = useState<Record<string, string[]>>({});
  const [key, setKey] = useState(avatar.fallback);
  /** An action image (e.g. "wave") briefly replacing the expression; matched by exact name only. */
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  const [layers, setLayers] = useState<{ a: string; b: string; showB: boolean }>({ a: "", b: "", showB: false });
  const [motion, setMotion] = useState<string | null>(null);
  const actionImgUntil = useRef(0);

  // Resolve all images once per avatar.
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string[]> = {};
      for (const [k, refs] of Object.entries(avatar.images)) {
        out[k] = (await Promise.all(refs.map((r) => assetUrl(companion.id, r.path)))).filter((u): u is string => !!u);
      }
      if (alive) setUrls(out);
    })();
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion.id, imagesKey]);

  // Expression / action changes from the live state.
  useEffect(() => {
    const sync = () => {
      const st = live(companion.id);
      const action = st.actions.shift();
      if (action) {
        const a = String(action);
        const match = Object.keys(avatar.images).find((k) => k.toLowerCase() === a.toLowerCase() && avatar.images[k].length);
        if (match) {
          actionImgUntil.current = performance.now() + 1400;
          setActionKey(match);
          setTimeout(() => setActionKey(null), 1400);
        } else if (!reduceMotion) {
          setMotion(a);
          setTimeout(() => setMotion(null), 900);
        }
      }
      if (performance.now() > actionImgUntil.current) {
        setKey(st.expression);
        setVariant(Math.floor(Math.random() * 1000));
      }
    };
    sync();
    return subscribeLive(companion.id, sync);
  }, [companion.id, avatar.images, reduceMotion]);

  // Mouth flaps with an optional talking frame.
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!avatar.talkingSuffix) return;
    let raf = 0;
    const tick = () => {
      setTalking(live(companion.id).amplitude > 0.3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [companion.id, avatar.talkingSuffix]);

  const src = useMemo(() => {
    // Image names are kept as the user gave them ("Sadness", "sad_2"…). Every key that
    // means the wanted expression is pooled, and the images rotate for variety.
    const pool = (wanted: string) => portraitKeysFor(urls, wanted, avatar.talkingSuffix).flatMap((k) => urls[k].map((u) => ({ k, u })));
    let choices = actionKey && urls[actionKey]?.length ? urls[actionKey].map((u) => ({ k: actionKey, u })) : pool(key);
    if (!choices.length) choices = pool(avatar.fallback);
    if (!choices.length) {
      const any = Object.keys(urls).find((k) => urls[k].length);
      if (!any) return "";
      choices = urls[any].map((u) => ({ k: any, u }));
    }
    const pick = choices[variant % choices.length];
    const talkKey = talking ? talkingKeyFor(urls, pick.k, avatar.talkingSuffix) : null;
    if (talkKey) {
      const frames = urls[talkKey];
      return frames[variant % frames.length];
    }
    return pick.u;
  }, [urls, key, actionKey, variant, talking, avatar.fallback, avatar.talkingSuffix]);

  // Two-layer crossfade (skipped for mouth flaps so they stay snappy).
  useEffect(() => {
    if (!src) return;
    setLayers((l) => {
      const current = l.showB ? l.b : l.a;
      if (current === src) return l;
      if (talking || reduceMotion || avatar.transitionMs <= 0) return l.showB ? { ...l, b: src } : { ...l, a: src };
      return l.showB ? { a: src, b: l.b, showB: false } : { a: l.a, b: src, showB: true };
    });
  }, [src, talking, reduceMotion, avatar.transitionMs]);

  if (!Object.values(urls).some((l) => l.length)) {
    return <div className="avatar-canvas portrait-empty">{companion.character.name.slice(0, 1)}</div>;
  }
  const fade = { transition: `opacity ${avatar.transitionMs}ms ease` };
  const f = framing === "call" ? avatar.framing ?? DEFAULT_FRAMING : DEFAULT_FRAMING;
  return (
    <div className={`avatar-canvas portrait portrait-${framing}`} data-motion={motion ?? undefined}>
      <div className="portrait-frame" style={{ transform: `translate(${f.x * 100}%, ${f.y * 100}%) scale(${f.zoom})` }}>
        {layers.a && <img src={layers.a} alt="" style={{ ...fade, opacity: layers.showB ? 0 : 1 }} draggable={false} />}
        {layers.b && <img src={layers.b} alt="" style={{ ...fade, opacity: layers.showB ? 1 : 0 }} draggable={false} />}
      </div>
    </div>
  );
}
