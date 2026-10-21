/**
 * Model field with a searchable list of everything the provider offers.
 *
 * The text field stays editable (any id can be typed), and "Browse models"
 * opens the full list from the provider's /models endpoint. A plain
 * <datalist> was used before, but browsers filter it by whatever is already
 * typed, so a field holding "openrouter/auto" only ever suggested two models.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LLMProfile, ModelInfo } from "../core/llm/types";
import { createProvider } from "../core/llm/providers";
import { platform } from "../platform";
import { Icon } from "./controls";

const SHOWN = 250;
/** Lists per server + key, so reopening the picker is instant. */
const cache = new Map<string, ModelInfo[]>();
const cacheKey = (p: LLMProfile) => `${p.presetId}|${p.baseUrl}|${p.apiKey.slice(-6)}`;

export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Every word of the query must appear in the id or the name. */
export function filterModels(list: ModelInfo[], query: string, opts: { free?: boolean; vision?: boolean } = {}): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((m) => {
    if (opts.free && !m.free) return false;
    if (opts.vision && !m.vision) return false;
    const hay = `${m.id} ${m.name ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function ModelPicker({ profile, onPick, onType }: { profile: LLMProfile; onPick(m: ModelInfo): void; onType(id: string): void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ModelInfo[] | null>(() => cache.get(cacheKey(profile)) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [visionOnly, setVisionOnly] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const key = cacheKey(profile);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const models = await createProvider(profile, platform().fetch).listModels();
      cache.set(key, models);
      setList(models);
      if (!models.length) setError("The server answered, but listed no models. You can still type a model name.");
    } catch (e) {
      setError((e as Error).message || "Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setList(cache.get(key) ?? null);
  }, [key]);

  useEffect(() => {
    if (!open) return;
    if (!list && !loading) void load();
    search.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => filterModels(list ?? [], query, { free: freeOnly, vision: visionOnly }), [list, query, freeOnly, visionOnly]);
  const anyFree = list?.some((m) => m.free);
  const anyVision = list?.some((m) => m.vision !== undefined && !m.vision);

  const pick = (m: ModelInfo) => {
    onPick(m);
    setOpen(false);
    setQuery("");
  };

  const inputId = `m-${profile.id}`;
  return (
    <div className="field model-picker">
      <label htmlFor={inputId}>Model</label>
      <div className="row">
        <input id={inputId} value={profile.model} onChange={(e) => onType(e.target.value)} spellCheck={false} autoComplete="off" />
        <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Close list" : "Browse models"}
        </button>
      </div>
      {open && (
        <div className="model-panel">
          <div className="row model-tools">
            <input
              ref={search}
              type="search"
              placeholder={list ? `Search ${list.length} models…` : "Search models…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) pick(shown[0]);
                if (e.key === "Escape") setOpen(false);
              }}
              aria-label="Search models"
            />
            <button type="button" className="icon-btn" onClick={() => void load()} disabled={loading} aria-label="Reload the model list" title="Reload">
              <Icon name="refresh" size={16} />
            </button>
          </div>
          {(anyFree || anyVision) && (
            <div className="row model-filters">
              {anyFree && <button type="button" className="chip" aria-pressed={freeOnly} onClick={() => setFreeOnly((v) => !v)}>Free</button>}
              {anyVision && <button type="button" className="chip" aria-pressed={visionOnly} onClick={() => setVisionOnly((v) => !v)}>Accepts images</button>}
            </div>
          )}
          {loading && <p className="hint">Loading models…</p>}
          {error && <p className="hint model-error" role="alert">{error}</p>}
          {list && !loading && (
            <>
              <ul className="model-list" role="listbox" aria-label="Models">
                {shown.slice(0, SHOWN).map((m) => (
                  <li key={m.id}>
                    <button type="button" role="option" aria-selected={m.id === profile.model} onClick={() => pick(m)}>
                      <span className="model-name">{m.name ?? m.id}</span>
                      {m.name && <span className="model-id">{m.id}</span>}
                      <span className="model-tags">
                        {m.contextLength ? <span className="tag">{formatContext(m.contextLength)}</span> : null}
                        {m.vision ? <span className="tag">images</span> : null}
                        {m.free ? <span className="tag tag-free">free</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hint">
                {shown.length === 0
                  ? "No model matches. You can still type any model name in the field above."
                  : shown.length > SHOWN
                    ? `Showing ${SHOWN} of ${shown.length}. Type to narrow the list.`
                    : `${shown.length} model${shown.length === 1 ? "" : "s"}`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
