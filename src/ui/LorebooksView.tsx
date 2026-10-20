import { useState } from "react";
import type { LoreEntry, Lorebook, LorePosition } from "../core/types";
import { useStore } from "../state/store";
import { emptyLoreEntry } from "../core/defaults";
import { lorebookToCharacterBook } from "../core/lorebook/convert";
import { utf8Encode } from "../core/util";
import { platform } from "../platform";
import { Icon, NumberInput, Select, Slider, TagInput, TextArea, TextInput, Toggle } from "./controls";

const POSITIONS: { value: LorePosition; label: string }[] = [
  { value: "before_char", label: "Before the character description" },
  { value: "after_char", label: "After the character description" },
  { value: "before_examples", label: "Before example dialogue" },
  { value: "after_examples", label: "After example dialogue" },
  { value: "top_of_history", label: "Top of the chat history" },
  { value: "at_depth", label: "Inside the chat, N messages from the end" },
];

export function LorebooksView() {
  const lorebooks = useStore((s) => s.lorebooks);
  const companions = useStore((s) => s.companions);
  const { createLorebook, importLorebook, saveLorebook, deleteLorebook } = useStore.getState();
  const [openId, setOpenId] = useState<string | null>(null);
  const book = openId ? lorebooks[openId] : undefined;
  const list = Object.values(lorebooks).sort((a, b) => a.name.localeCompare(b.name));

  const doImport = async () => {
    const files = await platform().pickFiles({ accept: ["json"], multiple: true, title: "Import lorebooks (SillyTavern World Info, Chub, or card JSON)" });
    for (const f of files) {
      try {
        setOpenId((await importLorebook(f)).id);
      } catch (e) {
        useStore.getState().notify("error", `${f.name}: ${(e as Error).message}`);
      }
    }
  };

  if (book) {
    const users = Object.values(companions).filter((c) => c.lorebookIds.includes(book.id));
    return <BookEditor book={book} users={users.map((c) => c.character.name)} onBack={() => setOpenId(null)} onSave={saveLorebook} onDelete={() => { void deleteLorebook(book.id); setOpenId(null); }} />;
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Lorebooks</h1>
          <p>World and character knowledge that enters the conversation when its keywords come up. One lorebook can be linked to any number of companions.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={doImport}><Icon name="upload" size={18} /> Import</button>
          <button className="btn btn-primary" onClick={async () => setOpenId((await createLorebook()).id)}><Icon name="plus" size={18} /> New lorebook</button>
        </div>
      </header>
      {list.length === 0 ? (
        <div className="empty"><p>Import a SillyTavern World Info file, a Chub lorebook, or start a new one.</p></div>
      ) : (
        <ul className="roster">
          {list.map((lb) => {
            const users = Object.values(companions).filter((c) => c.lorebookIds.includes(lb.id));
            return (
              <li key={lb.id} className="roster-item">
                <span className="thumb thumb-letter" aria-hidden><Icon name="book" /></span>
                <div className="roster-body">
                  <h2>{lb.name}</h2>
                  <p className="roster-meta">
                    {lb.entries.length} entries · {users.length ? `Used by ${users.map((c) => c.character.name).join(", ")}` : "Not linked to any companion"}
                  </p>
                </div>
                <div className="roster-actions">
                  <button className="btn" onClick={() => setOpenId(lb.id)}>Edit</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BookEditor({ book, users, onBack, onSave, onDelete }: { book: Lorebook; users: string[]; onBack(): void; onSave(lb: Lorebook): void; onDelete(): void }) {
  const [entryId, setEntryId] = useState<string | null>(book.entries[0]?.id ?? null);
  const [filter, setFilter] = useState("");
  const set = (p: Partial<Lorebook>) => onSave({ ...book, ...p });
  const entry = book.entries.find((e) => e.id === entryId);
  const setEntry = (p: Partial<LoreEntry>) => set({ entries: book.entries.map((e) => (e.id === entryId ? { ...e, ...p } : e)) });
  const shown = book.entries.filter((e) => !filter || `${e.name} ${e.keys.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));

  const exportBook = () =>
    platform().saveFile(`${book.name || "lorebook"}.json`, utf8Encode(JSON.stringify(lorebookToCharacterBook(book), null, 2)), [{ name: "Lorebook", extensions: ["json"] }]);

  return (
    <section className="page editor">
      <header className="page-head">
        <div>
          <button className="link" onClick={onBack}>Lorebooks</button>
          <h1>{book.name || "Untitled lorebook"}</h1>
          <p>{users.length ? `Linked to ${users.join(", ")}` : "Link this lorebook to companions from their Lore & model tab."}</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={exportBook}><Icon name="download" size={18} /> Export</button>
          <button className="btn btn-quiet danger" onClick={onDelete}>Delete</button>
        </div>
      </header>
      <div className="form">
        <div className="grid-2">
          <TextInput label="Name" value={book.name} onChange={(name) => set({ name })} />
          <TextInput label="Description" value={book.description} onChange={(description) => set({ description })} />
        </div>
        <div className="grid-3">
          <NumberInput label="Scan depth" min={0} value={book.scanDepth} onChange={(scanDepth) => set({ scanDepth })} hint="How many recent messages are searched for keywords" />
          <NumberInput label="Token budget" min={0} step={64} value={book.tokenBudget} onChange={(tokenBudget) => set({ tokenBudget })} />
          <Toggle label="Recursive" checked={book.recursive} onChange={(recursive) => set({ recursive })} hint="Entries can trigger other entries" />
        </div>
      </div>
      <div className="lore">
        <aside className="lore-list">
          <input type="search" placeholder="Filter entries" aria-label="Filter entries" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul>
            {shown.map((e) => (
              <li key={e.id}>
                <button aria-current={e.id === entryId || undefined} onClick={() => setEntryId(e.id)} data-off={!e.enabled || undefined}>
                  <span>{e.name || e.keys[0] || "Untitled entry"}</span>
                  <small>{e.constant ? "Always on" : e.keys.slice(0, 3).join(", ") || "No keywords"}</small>
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn btn-quiet"
            onClick={() => {
              const e = emptyLoreEntry({ name: "New entry" });
              set({ entries: [...book.entries, e] });
              setEntryId(e.id);
            }}
          >
            <Icon name="plus" size={16} /> Add entry
          </button>
        </aside>
        {entry ? (
          <div className="form lore-entry">
            <div className="grid-2">
              <TextInput label="Title" value={entry.name} onChange={(name) => setEntry({ name })} />
              <div className="row">
                <Toggle label="Enabled" checked={entry.enabled} onChange={(enabled) => setEntry({ enabled })} />
                <Toggle label="Always on" checked={entry.constant} onChange={(constant) => setEntry({ constant })} />
              </div>
            </div>
            <TagInput label="Keywords" value={entry.keys} onChange={(keys) => setEntry({ keys })} hint="Comma-separated. Wrap in slashes for a regex, e.g. /dragons?/" />
            <TextArea label="Content" rows={8} value={entry.content} onChange={(content) => setEntry({ content })} />
            <details className="advanced">
              <summary>Matching and placement</summary>
              <Toggle label="Require secondary keywords" checked={entry.selective} onChange={(selective) => setEntry({ selective })} />
              {entry.selective && (
                <div className="grid-2">
                  <TagInput label="Secondary keywords" value={entry.secondaryKeys} onChange={(secondaryKeys) => setEntry({ secondaryKeys })} />
                  <Select label="Logic" value={entry.selectiveLogic} onChange={(selectiveLogic) => setEntry({ selectiveLogic })} options={[
                    { value: "and_any", label: "…and any of these" }, { value: "and_all", label: "…and all of these" },
                    { value: "not_any", label: "…but none of these" }, { value: "not_all", label: "…but not all of these" },
                  ]} />
                </div>
              )}
              <div className="grid-2">
                <Toggle label="Case sensitive" checked={entry.caseSensitive} onChange={(caseSensitive) => setEntry({ caseSensitive })} />
                <Toggle label="Match whole words" checked={entry.matchWholeWords} onChange={(matchWholeWords) => setEntry({ matchWholeWords })} />
              </div>
              <Select label="Insert" value={entry.position} options={POSITIONS} onChange={(position) => setEntry({ position })} />
              <div className="grid-3">
                {entry.position === "at_depth" && <NumberInput label="Depth" min={0} value={entry.depth} onChange={(depth) => setEntry({ depth })} />}
                <NumberInput label="Order" value={entry.insertionOrder} onChange={(insertionOrder) => setEntry({ insertionOrder })} />
                <NumberInput label="Priority" value={entry.priority} onChange={(priority) => setEntry({ priority })} hint="Kept first when over budget" />
              </div>
              <div className="grid-3">
                <Slider label="Chance" min={0} max={100} step={5} value={entry.probability} onChange={(probability) => setEntry({ probability })} format={(v) => `${v}%`} />
                <NumberInput label="Sticky (turns)" min={0} value={entry.sticky} onChange={(sticky) => setEntry({ sticky })} />
                <NumberInput label="Cooldown (turns)" min={0} value={entry.cooldown} onChange={(cooldown) => setEntry({ cooldown })} />
              </div>
              <CharacterFilter value={entry.characterFilter} onChange={(characterFilter) => setEntry({ characterFilter })} />
            </details>
            <button className="btn btn-quiet danger" onClick={() => { set({ entries: book.entries.filter((e) => e.id !== entry.id) }); setEntryId(null); }}>
              Delete entry
            </button>
          </div>
        ) : (
          <div className="empty"><p>Select or add an entry.</p></div>
        )}
      </div>
    </section>
  );
}

function CharacterFilter({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const companions = useStore((s) => s.companions);
  return (
    <fieldset className="field">
      <legend>Only for these companions</legend>
      <p className="hint">Leave all unticked to apply to every companion using this lorebook.</p>
      <div className="row wrap">
        {Object.values(companions).map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={value.includes(c.id)} onChange={() => onChange(value.includes(c.id) ? value.filter((x) => x !== c.id) : [...value, c.id])} />
            {c.character.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
