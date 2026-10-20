/**
 * Overlay window (Windows / Linux): a transparent, always-on-top, click-through
 * window covering the screen. Companions set to "Full body on the desktop"
 * stand along the bottom edge; their dialogue appears beside them. Clicks pass
 * through to apps underneath except when the pointer is over a character,
 * which can be dragged sideways.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { platform } from "../platform";
import { applySnapshot, live, type LiveState } from "../state/live";
import { AvatarView } from "../avatars/AvatarView";
import { SpeechBubble } from "./CallFrame";
import type { Companion } from "../core/types";

export function OverlayApp() {
  const ready = useStore((s) => s.ready);
  const companions = useStore((s) => s.companions);
  const session = useStore((s) => s.session);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const hovering = useRef(false);

  // Mirror state from the main window.
  useEffect(() => {
    const offs: (() => void)[] = [];
    void platform().listen("cypals://live", (p) => applySnapshot(p as Record<string, LiveState>)).then((u) => offs.push(u));
    void platform().listen("cypals://amp", (p) => {
      for (const [id, a] of Object.entries(p as Record<string, number>)) live(id).amplitude = a;
    }).then((u) => offs.push(u));
    // Companion/session edits saved by the main window are reloaded from disk.
    let pending: ReturnType<typeof setTimeout> | undefined;
    void platform().listen("cypals://data", () => {
      clearTimeout(pending);
      pending = setTimeout(() => void useStore.getState().load(), 150);
    }).then((u) => offs.push(u));
    return () => {
      offs.forEach((f) => f());
      clearTimeout(pending);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    void platform().overlay?.setClickThrough(true);
  }, []);

  const shown = session.companionIds
    .map((id) => companions[id])
    .filter((c): c is Companion => !!c && c.presentation.mode === "overlay");

  useEffect(() => {
    if (ready && shown.length === 0) void platform().overlay?.close();
  }, [ready, shown.length]);

  const setHover = (h: boolean) => {
    if (hovering.current === h) return;
    hovering.current = h;
    void platform().overlay?.setClickThrough(!h);
  };

  return (
    <div className="overlay">
      {shown.map((c, i) => {
        const x = positions[c.id] ?? 1 - (i + 1) * 0.18;
        const h = `${Math.round(c.presentation.overlayScale * 100)}vh`;
        return (
          <div
            key={c.id}
            className="overlay-char"
            style={{ left: `${x * 100}%`, height: h, width: `calc(${h} * 0.6)` }}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            onPointerDown={(e) => {
              const startX = e.clientX;
              const start = x;
              const move = (ev: PointerEvent) => setPositions((p) => ({ ...p, [c.id]: Math.min(0.95, Math.max(0, start + (ev.clientX - startX) / window.innerWidth)) }));
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <SpeechBubble companion={c} style="bubble" />
            <AvatarView companion={c} framing="overlay" reduceMotion={reduceMotion} />
          </div>
        );
      })}
    </div>
  );
}
