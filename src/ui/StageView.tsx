/**
 * The conversation screen, in one of three modes:
 *   Chat     – a messaging thread; characters text back.
 *   Call     – video-call windows; hands-free voice with a pause-to-answer rule.
 *   Roleplay – avatars above a full story log, classic roleplay-app behaviour.
 */
import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { runtime } from "../state/runtime";
import { call, type CallState } from "../state/call";
import { MAX_ON_SCREEN, type ChatMessage, type Companion, type InteractionMode } from "../core/types";
import { splitChatBubbles, stripAsterisks } from "../core/text";
import { platform } from "../platform";
import { CallFrame, SpeechBubble, renderNarration, useLive } from "./CallFrame";
import { subscribeAnyLive } from "../state/live";
import { AvatarView } from "../avatars/AvatarView";
import { Icon } from "./controls";
import { PortraitThumb } from "./CompanionsView";
import { VoiceNoteButton } from "./VoiceNote";

const MODES: { id: InteractionMode; label: string; icon: "chat" | "phone" | "mask"; hint: string }[] = [
  { id: "chat", label: "Chat", icon: "chat", hint: "Text messaging" },
  { id: "call", label: "Call", icon: "phone", hint: "A spoken conversation, hands-free" },
  { id: "roleplay", label: "Roleplay", icon: "mask", hint: "Story-style roleplay with narration" },
];

export function StageView() {
  const companions = useStore((s) => s.companions);
  const session = useStore((s) => s.session);
  const setView = useStore((s) => s.setView);
  const mode = session.mode ?? "roleplay";
  const present = session.companionIds.map((id) => companions[id]).filter((c): c is Companion => !!c);

  if (!Object.keys(companions).length) {
    return (
      <section className="stage stage-empty">
        <h1>No one to talk to yet</h1>
        <p>Create a companion or import a character card (PNG, JSON, CHARX) or a .cypal file.</p>
        <button className="btn btn-primary" onClick={() => setView("companions")}>Add a companion</button>
      </section>
    );
  }

  return (
    <section className={`stage stage-${mode}`} onPointerMove={() => runtime.markActivity()}>
      <StageBar mode={mode} />
      {mode === "call" && <CallLayout present={present} />}
      {mode === "chat" && <ChatLayout present={present} />}
      {mode === "roleplay" && <RoleplayLayout present={present} />}
      <Composer mode={mode} present={present} />
    </section>
  );
}

// ───────────────────────── top bar ─────────────────────────

function StageBar({ mode }: { mode: InteractionMode }) {
  const personas = useStore((s) => s.settings.personas);
  useStore((s) => s.session.personaId);
  const persona = runtime.persona();
  return (
    <header className="stage-bar">
      <div className="mode-switch" role="radiogroup" aria-label="Conversation mode">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} title={m.hint} onClick={() => void runtime.setMode(m.id)}>
            <Icon name={m.icon} size={18} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
      <label className="persona-pick">
        <Icon name="user" size={16} />
        <span className="sr-only">You are</span>
        <select value={persona.id} onChange={(e) => runtime.setPersona(e.target.value)} aria-label="Your persona in this chat">
          {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button className="chip" onClick={() => runtime.newChat()} title="Start a new conversation with the same companions">
        <Icon name="refresh" size={16} /> New chat
      </button>
    </header>
  );
}

function AddToConversation({ compact = false }: { compact?: boolean }) {
  const companions = useStore((s) => s.companions);
  const session = useStore((s) => s.session);
  const [open, setOpen] = useState(false);
  if (session.companionIds.length >= MAX_ON_SCREEN) return null;
  const empty = !session.companionIds.length;
  return (
    <div className={`call-add${compact ? " call-add-compact" : ""}`}>
      <button className="add-slot" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="plus" size={compact ? 20 : 28} />
        <span>{empty ? "Start a conversation" : "Add someone"}</span>
      </button>
      {open && (
        <ul className="picker" role="listbox" aria-label="Choose a companion">
          {Object.values(companions)
            .filter((c) => !session.companionIds.includes(c.id))
            .map((c) => (
              <li key={c.id}>
                <button onClick={() => { runtime.addCompanion(c.id); setOpen(false); }}>
                  <PortraitThumb companion={c} />
                  <span>{c.character.name}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── Call ─────────────────────────

function CallLayout({ present }: { present: Companion[] }) {
  const saveCompanion = useStore((s) => s.saveCompanion);
  const [showLog, setShowLog] = useState(false);
  const inCall = present.filter((c) => c.presentation.mode === "call" || !platform().overlay);
  const onDesktop = present.filter((c) => c.presentation.mode === "overlay" && platform().overlay);
  const size = inCall.length <= 1 ? "lg" : inCall.length === 2 ? "md" : "sm";
  const subtitles = present.filter((c) => c.presentation.textStyle !== "bubble");
  return (
    <>
      <div className="stage-frames" data-count={inCall.length}>
        {inCall.map((c) => <CallFrame key={c.id} companion={c} size={size} />)}
        {onDesktop.map((c) => (
          <div key={c.id} className="call call-away">
            <p>{c.character.name} is on your desktop</p>
            <button className="btn btn-quiet" onClick={() => saveCompanion({ ...c, presentation: { ...c.presentation, mode: "call" } })}>
              Bring back to the call
            </button>
          </div>
        ))}
        <AddToConversation />
      </div>
      {subtitles.length > 0 && (
        <div className="subtitles">
          {subtitles.map((c) => <SpeechBubble key={c.id} companion={c} style={c.presentation.textStyle as "popup" | "subtitle"} />)}
        </div>
      )}
      <CallBar hasCompanions={present.length > 0} onToggleLog={() => setShowLog((v) => !v)} logOpen={showLog} />
      {showLog && <TranscriptPanel onClose={() => setShowLog(false)} />}
    </>
  );
}

function CallBar({ hasCompanions, onToggleLog, logOpen }: { hasCompanions: boolean; onToggleLog(): void; logOpen: boolean }) {
  const autoListen = useStore((s) => s.settings.call.autoListen);
  const sttReady = useStore((s) => !!s.settings.stt);
  const setView = useStore((s) => s.setView);
  const [st, setSt] = useState<CallState>(call.state);
  const [muted, setMuted] = useState(call.isMuted);
  useEffect(() => call.on(setSt), []);
  // Listen while the call is open with someone in it.
  useEffect(() => {
    if (hasCompanions && autoListen && sttReady) void call.start();
    return () => call.stop();
  }, [hasCompanions, autoListen, sttReady]);

  let text: string;
  let tone = "";
  switch (st.kind) {
    case "off": text = sttReady ? (hasCompanions ? "Microphone off" : "Add someone to start the call") : "Voice input isn't set up"; break;
    case "muted": text = "Muted"; break;
    case "listening": text = "Listening…"; tone = "live"; break;
    case "hearing": {
      const left = Math.max(0, Math.ceil((st.silenceMs - st.pauseMs) / 1000));
      text = st.pauseMs > 300 ? `Pause for ${left}s more to hand over` : "Hearing you…";
      tone = "live";
      break;
    }
    case "transcribing": text = "Catching what you said…"; break;
    case "their-turn": text = "Their turn"; break;
    case "error": text = st.message; tone = "error"; break;
  }
  const progress = st.kind === "hearing" && st.pauseMs > 300 ? Math.min(1, st.pauseMs / st.silenceMs) : 0;

  return (
    <div className="call-bar" data-tone={tone || undefined}>
      <span className="call-status" role="status">
        <span className="call-dot" />
        {text}
        {!sttReady && (
          <button className="link" onClick={() => setView("settings")}>Set up speech-to-text</button>
        )}
      </span>
      {progress > 0 && <span className="pause-meter" style={{ ["--p" as string]: progress }} aria-hidden />}
      <span className="spacer" />
      {sttReady && hasCompanions && (
        st.kind === "off" || st.kind === "error" ? (
          <button className="chip" onClick={() => void call.start()}><Icon name="mic" size={16} /> Start listening</button>
        ) : (
          <button className="chip" aria-pressed={muted} onClick={() => { call.setMuted(!muted); setMuted(!muted); }}>
            <Icon name={muted ? "micOff" : "mic"} size={16} /> {muted ? "Unmute" : "Mute"}
          </button>
        )
      )}
      <button className="chip" aria-pressed={logOpen} onClick={onToggleLog}><Icon name="history" size={16} /> Transcript</button>
    </div>
  );
}

// ───────────────────────── Chat ─────────────────────────

function ChatLayout({ present }: { present: Companion[] }) {
  const session = useStore((s) => s.session);
  const group = present.length > 1;
  const end = useAutoScroll(session.messages.length);
  return (
    <div className="chat">
      <div className="chat-contacts">
        {present.map((c) => <ChatContact key={c.id} c={c} />)}
        <AddToConversation compact />
      </div>
      <ol className="thread" aria-label="Messages">
        {session.messages.map((m, i) => (
          <ChatItem key={m.id} m={m} group={group} first={i === 0 || session.messages[i - 1].speakerId !== m.speakerId || session.messages[i - 1].role !== m.role} />
        ))}
        {present.map((c) => <TypingIndicator key={c.id} c={c} />)}
        <li ref={end} className="scroll-end" aria-hidden />
      </ol>
    </div>
  );
}

function ChatContact({ c }: { c: Companion }) {
  const st = useLive(c.id);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  return (
    <div className="contact">
      <div className={`contact-avatar frame-circle`}>
        <AvatarView companion={c} framing="call" reduceMotion={reduceMotion} />
      </div>
      <div>
        <strong>{c.character.nickname || c.character.name}</strong>
        <small>{st.streaming || st.thinking ? "typing…" : "online"}</small>
      </div>
      <button className="icon-btn" onClick={() => runtime.removeCompanion(c.id)} aria-label={`Remove ${c.character.name} from the chat`}><Icon name="close" size={14} /></button>
    </div>
  );
}

function VoiceTag({ m }: { m: ChatMessage }) {
  const v = m.attachments?.find((a) => a.kind === "voice");
  return v ? <span className="voice-tag"><Icon name="mic" size={14} /> {v.description ?? "Voice note"} · transcribed</span> : null;
}

function ChatItem({ m, group, first }: { m: ChatMessage; group: boolean; first: boolean }) {
  if (m.role === "system" || m.role === "narrator") return <li className="thread-note">{m.text}</li>;
  const mine = m.role === "user";
  // Chat shows no *narration*, including in lines carried over from Roleplay.
  const shown = stripAsterisks(m.text) || m.text;
  const bubbles = mine ? [shown] : splitChatBubbles(shown);
  return (
    <li className={`thread-item ${mine ? "mine" : "theirs"}`}>
      {!mine && group && first && <span className="thread-name">{m.name}</span>}
      {bubbles.map((b, i) => (
        <p key={i} className="msg">
          {i === 0 && <VoiceTag m={m} />}
          {b}
        </p>
      ))}
      {m.attachments?.some((a) => a.kind !== "voice") && <span className="thread-attach">Shared: {m.attachments.filter((a) => a.kind !== "voice").map((a) => a.description ?? a.kind).join(", ")}</span>}
    </li>
  );
}

function TypingIndicator({ c }: { c: Companion }) {
  const st = useLive(c.id);
  if (!st.streaming && !st.thinking) return null;
  return (
    <li className="thread-item theirs" aria-label={`${c.character.name} is typing`}>
      <p className="msg typing"><span /><span /><span /></p>
    </li>
  );
}

// ───────────────────────── Roleplay ─────────────────────────

function RoleplayLayout({ present }: { present: Companion[] }) {
  const session = useStore((s) => s.session);
  const end = useAutoScroll(session.messages.length);
  const lastCompanion = [...session.messages].reverse().find((m) => m.role === "companion");
  return (
    <div className="roleplay">
      <div className="rp-cast">
        {present.map((c) => <CallFrame key={c.id} companion={c} size="sm" showBubble={false} />)}
        <AddToConversation compact />
      </div>
      <ol className="story" aria-label="Story">
        {session.messages.map((m) => (
          <li key={m.id} className={`story-item story-${m.role}`}>
            <span className="story-name">{m.name}</span>
            <VoiceTag m={m} />
            <div className="story-text">{m.text.split(/\n+/).map((para, i) => <p key={i}>{renderNarration(para)}</p>)}</div>
            {m.id === lastCompanion?.id && (
              <button className="btn btn-quiet story-regen" onClick={() => void runtime.orch?.regenerateLast()}>
                <Icon name="refresh" size={14} /> Regenerate
              </button>
            )}
          </li>
        ))}
        {present.map((c) => <StreamingStory key={c.id} c={c} />)}
        <li ref={end} className="scroll-end" aria-hidden />
      </ol>
    </div>
  );
}

function StreamingStory({ c }: { c: Companion }) {
  const st = useLive(c.id);
  if (!st.streaming) return null;
  return (
    <li className="story-item story-companion story-pending">
      <span className="story-name">{c.character.nickname || c.character.name}</span>
      <div className="story-text">
        {st.bubble ? st.bubble.split(/\n+/).map((p, i) => <p key={i}>{renderNarration(p)}</p>) : <p className="speech-thinking"><span /><span /><span /></p>}
      </div>
    </li>
  );
}

// ───────────────────────── shared ─────────────────────────

/** Keep a list scrolled to its newest entry, including while replies stream in. */
function useAutoScroll(count: number) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  useEffect(() => {
    let raf = 0;
    return subscribeAnyLive(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        end.current?.scrollIntoView({ block: "end" });
      });
    });
  }, []);
  return end;
}

function Composer({ mode, present }: { mode: InteractionMode; present: Companion[] }) {
  const vision = useStore((s) => s.settings.vision);
  const updateSettings = useStore((s) => s.updateSettings);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const visionOn = vision.screen.enabled || vision.webcam.enabled;

  useEffect(() => {
    const fn = (what: string) => {
      setCaptured(what);
      setTimeout(() => setCaptured(null), 2500);
    };
    runtime.captureListeners.add(fn);
    return () => void runtime.captureListeners.delete(fn);
  }, []);

  const send = async (t = text.trim(), voiceSeconds?: number) => {
    if (!t || !present.length) return;
    if (voiceSeconds === undefined) setText("");
    setBusy(true);
    try {
      await runtime.send(t, visionOn, voiceSeconds);
    } finally {
      setBusy(false);
    }
  };

  const names = present.map((c) => c.character.nickname || c.character.name).join(", ");
  const placeholder = !present.length
    ? "Add someone to start"
    : mode === "chat" ? `Message ${names}` : mode === "call" ? `Or type to ${names}` : `What do you say or do?`;

  return (
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
        <button className="chip" aria-pressed={vision.webcam.enabled} onClick={() => updateSettings({ vision: { ...vision, webcam: { ...vision.webcam, enabled: !vision.webcam.enabled } } })}>
          <Icon name="camera" size={16} /> Webcam {vision.webcam.enabled ? "on" : "off"}
        </button>
        {captured && <span className="capture-flash" role="status">Shared {captured}</span>}
      </div>
      <form className="composer" data-recording={recording || undefined} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          hidden={recording}
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={!present.length}
          onChange={(e) => { setText(e.target.value); runtime.markActivity(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {mode !== "call" && !text.trim() && !busy && (
          <VoiceNoteButton disabled={!present.length} onTranscribed={(t, sec) => void send(t, sec)} onActiveChange={setRecording} />
        )}
        {recording ? null : busy ? (
          <button type="button" className="send" onClick={() => runtime.interrupt()} aria-label="Stop"><Icon name="stop" /></button>
        ) : (
          <button type="submit" className="send" disabled={!text.trim() || !present.length} aria-label="Send"><Icon name="send" /></button>
        )}
      </form>
    </div>
  );
}

function TranscriptPanel({ onClose }: { onClose(): void }) {
  const session = useStore((s) => s.session);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [session.messages.length]);
  return (
    <aside className="log" aria-label="Transcript">
      <header>
        <h2>Transcript</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close transcript"><Icon name="close" /></button>
      </header>
      <ol>
        {session.messages.map((m) => (
          <li key={m.id} className={`log-${m.role}`}>
            <span className="log-name">{m.name}{m.autonomous ? " (to the group)" : ""}</span>
            <p>{renderNarration(m.text)}</p>
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
