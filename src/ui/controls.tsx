import { useId, type ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function TextInput(props: { label: string; value: string; onChange(v: string): void; hint?: ReactNode; placeholder?: string; type?: string }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <input id={id} type={props.type ?? "text"} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function TextArea(props: { label: string; value: string; onChange(v: string): void; hint?: ReactNode; rows?: number; placeholder?: string }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <textarea id={id} rows={props.rows ?? 4} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function NumberInput(props: { label: string; value: number; onChange(v: number): void; min?: number; max?: number; step?: number; hint?: ReactNode }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <input
          id={id}
          type="number"
          value={Number.isFinite(props.value) ? props.value : ""}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          onChange={(e) => props.onChange(e.target.valueAsNumber)}
        />
      )}
    </Field>
  );
}

export function Slider(props: { label: string; value: number; onChange(v: number): void; min: number; max: number; step: number; format?(v: number): string; hint?: ReactNode }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <div className="slider">
          <input id={id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(e.target.valueAsNumber)} />
          <output htmlFor={id}>{props.format ? props.format(props.value) : props.value}</output>
        </div>
      )}
    </Field>
  );
}

export function Select<T extends string>(props: { label: string; value: T; onChange(v: T): void; options: { value: T; label: string }[]; hint?: ReactNode }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {(id) => (
        <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange(v: boolean): void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div>
        <label htmlFor={id}>{props.label}</label>
        {props.hint && <p className="hint">{props.hint}</p>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        className="switch"
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ label, value, onChange, hint, placeholder }: { label: string; value: string[]; onChange(v: string[]): void; hint?: ReactNode; placeholder?: string }) {
  return (
    <TextInput
      label={label}
      hint={hint ?? "Separate with commas"}
      placeholder={placeholder}
      value={value.join(", ")}
      onChange={(v) => onChange(v.split(",").map((s) => s.trim()).filter((s, i, a) => s || i < a.length - 1))}
    />
  );
}

export function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const ICONS = {
  call: <><rect x="3" y="5" width="18" height="14" rx="4" /><circle cx="12" cy="11" r="3" /><path d="M7.5 19c.8-2.2 2.5-3.3 4.5-3.3s3.7 1.1 4.5 3.3" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.4.2 4 1.7 4.5 4.3" /></>,
  book: <><path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17z" /><path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H17" /><path d="M19 7v12.5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2" /><circle cx="12" cy="12" r="7" /></>,
  send: <><path d="M4 12 20 4l-4 16-4-7z" /><path d="m12 13 8-9" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  camera: <><rect x="3" y="6.5" width="13" height="11" rx="3" /><path d="m16 10.5 5-3v9l-5-3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  swap: <><path d="M7 7h11l-3-3" /><path d="M17 17H6l3 3" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  desktop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /><path d="M12 8v4l3 2" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4h-4" /></>,
  trash: <><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" /></>,
  chat: <><path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M7.5 10h9M7.5 13h6" /></>,
  phone: <><path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a12 12 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  micOff: <><path d="M15 10V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.8 2.4" /><path d="M5.5 11a6.5 6.5 0 0 0 10.6 5M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M8.5 21h7M4 4l16 16" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.7 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10" cy="7.3" r="1.2" /><circle cx="14.5" cy="7.3" r="1.2" /></>,
  mask: <><path d="M4 6c3 1.2 13 1.2 16 0v5c0 4.5-3.6 8-8 8s-8-3.5-8-8z" /><path d="M8.5 11.5c.8-.6 1.7-.6 2.5 0M13 11.5c.8-.6 1.7-.6 2.5 0" /></>,
} as const;
