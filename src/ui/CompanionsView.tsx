import { useEffect, useState } from "react";
import type { Companion } from "../core/types";
import { useStore } from "../state/store";
import { runtime } from "../state/runtime";
import { assetUrl } from "../state/assets";
import { platform } from "../platform";
import { Icon } from "./controls";

const KIND_LABEL = { model3d: "3D", live2d: "Live2D", portraits: "Portraits" } as const;

export function PortraitThumb({ companion }: { companion: Companion }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const p = companion.avatars.find((a) => a.kind === "portraits");
    if (p?.kind !== "portraits") return setUrl(null);
    const ref = p.images[p.fallback]?.[0] ?? Object.values(p.images)[0]?.[0];
    if (ref) void assetUrl(companion.id, ref.path).then(setUrl);
  }, [companion]);
  return url ? (
    <img className="thumb" src={url} alt="" />
  ) : (
    <span className="thumb thumb-letter" aria-hidden>{companion.character.name.slice(0, 1)}</span>
  );
}

export function CompanionsView() {
  const companions = useStore((s) => s.companions);
  const session = useStore((s) => s.session);
  const { importFiles, createCompanion, setView, exportCypal, exportCard, deleteCompanion } = useStore.getState();
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = Object.values(companions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const doImport = async () => {
    const files = await platform().pickFiles({ accept: ["png", "json", "charx", "cypal"], multiple: true, title: "Import companions" });
    if (files.length) await importFiles(files);
  };

  return (
    <section
      className="page"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
        await importFiles(files);
      }}
    >
      <header className="page-head">
        <div>
          <h1>Companions</h1>
          <p>Import Character Card V1–V3 files (PNG, JSON, CHARX) or .cypal companions, or drop them here.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={doImport}><Icon name="upload" size={18} /> Import</button>
          <button className="btn btn-primary" onClick={async () => setView("editor", (await createCompanion()).id)}>
            <Icon name="plus" size={18} /> New companion
          </button>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="empty">
          <p>Your companions will appear here.</p>
        </div>
      ) : (
        <ul className="roster">
          {list.map((c) => {
            const inCall = session.companionIds.includes(c.id);
            return (
              <li key={c.id} className="roster-item">
                <PortraitThumb companion={c} />
                <div className="roster-body">
                  <h2>{c.character.name}</h2>
                  {c.character.tagline && <p className="roster-tag">{c.character.tagline}</p>}
                  <p className="roster-meta">
                    {c.avatars.length ? c.avatars.map((a) => KIND_LABEL[a.kind]).join(", ") : "No avatar yet"}
                    {c.behaviour.fourthWallAware && <span className="badge">Fourth wall aware</span>}
                    {c.source.kind !== "created" && c.source.kind !== "cypal" && <span className="badge badge-quiet">{c.source.kind.toUpperCase()}</span>}
                  </p>
                </div>
                <div className="roster-actions">
                  <button
                    className="btn btn-primary"
                    disabled={!inCall && session.companionIds.length >= 3}
                    onClick={() => {
                      if (!inCall) runtime.addCompanion(c.id);
                      setView("stage");
                    }}
                  >
                    {inCall ? "In call" : "Call"}
                  </button>
                  <button className="btn" onClick={() => setView("editor", c.id)}>Edit</button>
                  <details className="more">
                    <summary className="btn btn-quiet" aria-label={`More actions for ${c.character.name}`}>More</summary>
                    <div className="menu">
                      <button onClick={() => exportCypal(c.id)}><Icon name="download" size={16} /> Export .cypal</button>
                      <button onClick={() => exportCard(c.id)}><Icon name="download" size={16} /> Export character card (PNG)</button>
                      {confirm === c.id ? (
                        <button className="danger" onClick={() => deleteCompanion(c.id)}><Icon name="trash" size={16} /> Delete {c.character.name} permanently</button>
                      ) : (
                        <button className="danger" onClick={() => setConfirm(c.id)}><Icon name="trash" size={16} /> Delete…</button>
                      )}
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
