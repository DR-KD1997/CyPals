import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Companion } from "../core/types";
import { AvatarView } from "../avatars/AvatarView";
import { live, subscribeLive } from "../state/live";
import { assetUrl } from "../state/assets";
import { useStore } from "../state/store";
import { platform } from "../platform";
import { runtime } from "../state/runtime";
import { Icon } from "./controls";

/** Re-render when the companion's live state changes (not on every amplitude tick). */
export function useLive(id: string) {
  const [, force] = useState(0);
  useEffect(() => subscribeLive(id, () => force((n) => n + 1)), [id]);
  return live(id);
}

export function SpeechBubble({ companion, style }: { companion: Companion; style: "bubble" | "popup" | "subtitle" }) {
  const st = useLive(companion.id);
  if (st.thinking && !st.bubbleVisible) {
    return (
      <div className={`speech speech-${style} speech-thinking`} aria-label={`${companion.character.name} is thinking`}>
        <span /><span /><span />
      </div>
    );
  }
  if (!st.bubbleVisible || !st.bubble) return null;
  return (
    <div className={`speech speech-${style}`} aria-live="polite">
      {style !== "bubble" && <strong>{companion.character.nickname || companion.character.name}</strong>}
      <p>{renderNarration(st.bubble)}</p>
    </div>
  );
}

/** *narration* renders as quieter italic text. */
export function renderNarration(text: string) {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
      <em key={i} className="narration">{part.slice(1, -1)}</em>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function CallFrame({ companion, size }: { companion: Companion; size: "lg" | "md" | "sm" }) {
  const ring = useRef<HTMLDivElement>(null);
  const st = useLive(companion.id);
  const saveCompanion = useStore((s) => s.saveCompanion);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const [bg, setBg] = useState<string | null>(null);
  const p = companion.presentation;

  // Voice-reactive ring: scale & glow follow amplitude every frame without React renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ring.current?.style.setProperty("--amp", live(companion.id).amplitude.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [companion.id]);

  useEffect(() => {
    if (p.background.type === "image") void assetUrl(companion.id, p.background.image.path).then(setBg);
    else setBg(null);
  }, [companion.id, p.background]);

  const style: CSSProperties = {
    background: p.background.type === "color" ? p.background.color : undefined,
    backgroundImage: bg ? `url("${bg}")` : undefined,
    backgroundSize: p.background.type === "image" ? p.background.fit : undefined,
  };

  const switchAvatar = () => {
    const i = companion.avatars.findIndex((a) => a.id === companion.activeAvatarId);
    const next = companion.avatars[(i + 1) % companion.avatars.length];
    void saveCompanion({ ...companion, activeAvatarId: next.id });
  };

  const toDesktop = async () => {
    await saveCompanion({ ...companion, presentation: { ...p, mode: "overlay" } });
    await platform().overlay?.open();
  };

  const name = companion.character.nickname || companion.character.name;
  return (
    <figure className={`call call-${size}`} data-speaking={st.speaking || undefined}>
      {p.textStyle === "bubble" && <SpeechBubble companion={companion} style="bubble" />}
      <div ref={ring} className={`call-ring frame-${p.frame}`}>
        <div className={`call-window frame-${p.frame}`} style={style}>
          <AvatarView companion={companion} framing="call" reduceMotion={reduceMotion} />
        </div>
      </div>
      <figcaption>
        <span className="call-name">{name}</span>
        <span className="call-tools">
          {companion.avatars.length > 1 && (
            <button className="icon-btn" onClick={switchAvatar} title="Switch avatar" aria-label={`Switch ${name}'s avatar`}>
              <Icon name="swap" size={16} />
            </button>
          )}
          {platform().overlay && (
            <button className="icon-btn" onClick={toDesktop} title="Show on desktop" aria-label={`Show ${name} on the desktop`}>
              <Icon name="desktop" size={16} />
            </button>
          )}
          <button className="icon-btn" onClick={() => runtime.removeCompanion(companion.id)} title="Leave call" aria-label={`Remove ${name} from the call`}>
            <Icon name="close" size={16} />
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
