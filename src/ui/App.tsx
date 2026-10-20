import { useEffect } from "react";
import { useStore, type View } from "../state/store";
import { runtime } from "../state/runtime";
import { StageView } from "./StageView";
import { CompanionsView } from "./CompanionsView";
import { CompanionEditor } from "./CompanionEditor";
import { LorebooksView } from "./LorebooksView";
import { SettingsView } from "./SettingsView";
import { Icon } from "./controls";

const NAV: { view: View; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { view: "stage", label: "Call", icon: "call" },
  { view: "companions", label: "Companions", icon: "people" },
  { view: "lorebooks", label: "Lorebooks", icon: "book" },
  { view: "settings", label: "Settings", icon: "gear" },
];

export function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const toast = useStore((s) => s.toast);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);

  useEffect(() => {
    if (ready) runtime.start();
  }, [ready]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
  }, [reduceMotion]);

  if (!ready) return <div className="boot">CyPals</div>;
  const active = view === "editor" ? "companions" : view;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand" aria-hidden>
          <span className="brand-mark" />
        </div>
        {NAV.map((n) => (
          <button key={n.view} className="rail-btn" aria-current={active === n.view ? "page" : undefined} onClick={() => setView(n.view)}>
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        {view === "stage" && <StageView />}
        {view === "companions" && <CompanionsView />}
        {view === "editor" && <CompanionEditor />}
        {view === "lorebooks" && <LorebooksView />}
        {view === "settings" && <SettingsView />}
      </main>
      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
