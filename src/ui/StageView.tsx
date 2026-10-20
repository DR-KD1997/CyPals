import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { runtime } from "../state/runtime";
import { MAX_ON_SCREEN, type Companion } from "../core/types";
import { platform } from "../platform";
import { CallFrame, SpeechBubble, renderNarration } from "./CallFrame";
import { Icon } from "./controls";
import { PortraitThumb } from "./CompanionsView";

export function StageView() {
  const companions = useStore((s) => s.companions);
  const session = useStore((s) => s.session);
  const vision = useStore((s) => s.settings.vision);
  const updateSettings = useStore((s) => s.updateSettings);
  const setView = useStore((s) => s.setView);
  const saveCompanion = useStore((s) => s.saveCompanion);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [picking, setPicking] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const present = session.companionIds.map((id) => companions[id]).filter((c): c is Companion => !!c);
  const inCall = present.filter((c) => c.presentation.mode === "call" || !platform().overlay);
  const onDesktop = present.filter((c) => c.presentation.mode === "overlay" && platform().overlay);
  const size = inCall.length <= 1 ? "lg" : inCall.length === 2 ? "md" : "sm";
  const subtitles = present.filter((c) => c.presentation.textStyle !== "bubble");
  const visionOn = vision.screen.enabled || vision.webcam.enabled;

  useEffect(() => {
    const fn = (what: string) => {
      setCaptured(what);
      setTimeout(() => setCaptured(null), 2500);
    };
    runtime.captureListeners.add(fn);
    return () => void runtime.captureListeners.delete(fn);
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || !present.length) return;
    setText("");
    setBusy(true);
    try {
      await runtime.send(t, visionOn);
    } finally {
      setBusy(false);
    }
  };

  if (!Object.keys(companions).length) {
    return (
      <section className="stage stage-empty">
        <h1>No one to call yet</h1>
        <p>Create a companion or import a character card (PNG, JSON, CHARX) or a .cypal file.</p>
        <button className="btn btn-primary" onClick={() => setView("companions")}>Add a companion</button>
      </section>
    );
  }

  return (
    <section className="stage" onPointerMove={() => runtime.markActivity()}>
      <div className="stage-frames" data-count={inCall.length}>
        {inCall.map((c) => (
          <CallFrame key={c.id} companion={c} size={size} />
        ))}
        {onDesktop.map((c) => (
          <div key={c.id} className="call call-away">
            <p>{c.character.name} is on your desktop</p>
            <button className="btn btn-quiet" onClick={() => saveCompanion({ ...c, presentation: { ...c.presentation, mode: "call" } })}>
              Bring back to the call
            </button>
          </div>
        ))}
        {present.length < MAX_ON_SCREEN && (
          <div className="call-add">
            <button className="add-slot" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              <Icon name="plus" size={28} />
              <span>{present.length ? "Add to call" : "Start a call"}</span>
            </button>
            {picking && (
              <ul className="picker" role="listbox" aria-label="Choose a companion">
                {Object.values(companions)
                  .filter((c) => !session.companionIds.includes(c.id))
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          runtime.addCompanion(c.id);
                          setPicking(false);
                          input.current?.focus();
                        }}
                      >
                        <PortraitThumb companion={c} />
                        <span>{c.character.name}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {subtitles.length > 0 && (
        <div className="subtitles">
          {subtitles.map((c) => (
            <SpeechBubble key={c.id} companion={c} style={c.presentation.textStyle as "popup" | "subtitle"} />
          ))}
        </div>
      )}

      {showLog && <ChatLog onClose={() => setShowLog(false)} />}

      <div className="composer-wrap">
        <div className="vision-bar" aria-label="What the AI can see">
          <button
            className="chip"
            aria-pressed={vision.screen.enabled}
            disabled={!platform().vision}
            title={platform().vision ? "Share your screen with companions (filtered by your Vision settings)" : "Screen sharing is available on Windows and Linux"}
            onClick={() => updateSettings({ vision: { ...vision, screen: { ...vision.screen, enabled: !vision.screen.enabled } } })}
          >
            <Icon name="eye" size={16} /> Screen {vision.screen.enabled ? (vision.screen.mode === "allowlist" ? `· ${vision.screen.apps.length + vision.screen.titles.length} allowed` : "· filtered") : "off"}
          </button>
          <button
            className="chip"
            aria-pressed={vision.webcam.enabled}
            onClick={() => updateSettings({ vision: { ...vision, webcam: { ...vision.webcam, enabled: !vision.webcam.enabled } } })}
          >
            <Icon name="camera" size={16} /> Webcam {vision.webcam.enabled ? "on" : "off"}
          </button>
          {captured && <span className="capture-flash" role="status">Shared {captured}</span>}
          <span className="spacer" />
          <button className="chip" onClick={() => setShowLog((v) => !v)} aria-pressed={showLog}>
            <Icon name="history" size={16} /> Transcript
          </button>
          <button className="chip" onClick={() => runtime.newChat()} title="Start a new conversation with the same companions">
            <Icon name="refresh" size={16} /> New chat
          </button>
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={text}
            placeholder={present.length ? `Say something to ${present.map((c) => c.character.nickname || c.character.name).join(", ")}` : "Add a companion to start"}
            disabled={!present.length}
            onChange={(e) => {
              setText(e.target.value);
              runtime.markActivity();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="send" onClick={() => runtime.interrupt()} aria-label="Stop">
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!text.trim() || !present.length} aria-label="Send">
              <Icon name="send" />
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

function ChatLog({ onClose }: { onClose(): void }) {
  const session = useStore((s) => s.session);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [session.messages.length]);
  return (
    <aside className="log" aria-label="Transcript">
      <header>
        <h2>Transcript</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close transcript"><Icon name="close" /></button>
      </header>
      <ol>
        {session.messages.map((m) => (
          <li key={m.id} className={`log-${m.role}`} data-auto={m.autonomous || undefined}>
            <span className="log-name">{m.name}{m.autonomous ? " (to the group)" : ""}</span>
            <p>{renderNarration(m.text)}</p>
            {m.attachments?.length ? <span className="log-attach">Shared: {m.attachments.map((a) => a.description ?? a.kind).join(", ")}</span> : null}
          </li>
        ))}
      </ol>
      <div ref={end} />
      {session.messages.some((m) => m.role === "companion") && (
        <footer>
          <button className="btn btn-quiet" onClick={() => void runtime.orch?.regenerateLast()}>
            <Icon name="refresh" size={16} /> Regenerate last reply
          </button>
        </footer>
      )}
    </aside>
  );
}
