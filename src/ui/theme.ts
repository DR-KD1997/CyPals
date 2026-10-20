/**
 * Interface theming: light/dark mode and colour tinting.
 *
 * The palette is generated from one tint colour: the accent takes the tint
 * (lightened or darkened until it reads clearly on the background), and the
 * surfaces take its hue at a user-chosen strength, from neutral grey to
 * strongly tinted. Text colours are derived to keep WCAG contrast.
 */
export type ResolvedTheme = "dark" | "light";

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  let v = m ? m[1] : "8ed5c6";
  if (v.length === 3) v = [...v].map((c) => c + c).join("");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Move a colour's lightness until it reaches `ratio` contrast against `bg`. */
function ensureContrast(h: number, s: number, l: number, bg: string, ratio: number, direction: 1 | -1): string {
  let ll = l;
  let hex = hslToHex(h, s, ll);
  for (let i = 0; i < 60 && contrast(hex, bg) < ratio; i++) {
    ll = Math.max(0, Math.min(100, ll + direction * 1.5));
    hex = hslToHex(h, s, ll);
  }
  return hex;
}

export interface Palette {
  [cssVar: string]: string;
}

export function buildPalette(theme: ResolvedTheme, tint: string, strength: number): Palette {
  const t = hexToHsl(tint);
  const k = Math.max(0, Math.min(1, strength));
  const h = t.h;
  const accentS = Math.max(35, t.s);
  if (theme === "dark") {
    const ink = hslToHex(h, 45 * k, 12);
    const glass = ensureContrast(h, accentS, Math.max(t.l, 60), ink, 6.5, 1);
    return {
      "--ink": ink,
      "--ink-2": hslToHex(h, 42 * k, 16),
      "--ink-3": hslToHex(h, 38 * k, 22),
      "--line": hslToHex(h, 34 * k, 31),
      "--glass": glass,
      "--glass-strong": ensureContrast(h, accentS, Math.min(92, Math.max(t.l, 60) + 12), ink, 9, 1),
      "--on-glass": hslToHex(h, 45 * k, 11),
      "--paper": ensureContrast(h, 22 * k, 92, ink, 12, 1),
      "--mist": ensureContrast(h, 16 * k, 66, ink, 5.5, 1),
      "--bubble": hslToHex(h, 28 * k, 95),
      "--bubble-ink": hslToHex(h, 45 * k, 13),
      "--bubble-mist": hslToHex(h, 18 * k, 40),
      "--lantern": "#f2b25c",
      "--on-lantern": "#1c1408",
      "--danger": "#f0877a",
      "--stage-glow": hslToHex(h, 42 * k, 19),
      "--shadow": "rgba(0, 0, 0, 0.45)",
      "--scrim": `${hslToHex(h, 40 * k, 9)}e6`,
      "--color-scheme": "dark",
    };
  }
  const ink = hslToHex(h, 32 * k, 97);
  const glass = ensureContrast(h, accentS, Math.min(t.l, 42), ink, 4.8, -1);
  return {
    "--ink": ink,
    "--ink-2": hslToHex(h, 30 * k, 93),
    "--ink-3": hslToHex(h, 28 * k, 87),
    "--line": hslToHex(h, 22 * k, 78),
    "--glass": glass,
    "--glass-strong": ensureContrast(h, accentS, Math.min(t.l, 42) - 8, ink, 7, -1),
    "--on-glass": "#ffffff",
    "--paper": ensureContrast(h, 40 * k, 13, ink, 13, -1),
    "--mist": ensureContrast(h, 16 * k, 40, ink, 5.5, -1),
    "--bubble": "#ffffff",
    "--bubble-ink": hslToHex(h, 40 * k, 13),
    "--bubble-mist": hslToHex(h, 16 * k, 42),
    "--lantern": "#e59a2c",
    "--on-lantern": "#1c1408",
    "--danger": "#b93f31",
    "--stage-glow": hslToHex(h, 38 * k, 90),
    "--shadow": "rgba(20, 30, 40, 0.16)",
    "--scrim": `${hslToHex(h, 30 * k, 97)}eb`,
    "--color-scheme": "light",
  };
}

export const TINT_PRESETS: { name: string; color: string }[] = [
  { name: "Sea glass", color: "#8ed5c6" },
  { name: "Sky", color: "#8fc2f2" },
  { name: "Lilac", color: "#b9a3f0" },
  { name: "Rose", color: "#f0a3c0" },
  { name: "Ember", color: "#f2a472" },
  { name: "Moss", color: "#a9cf7f" },
  { name: "Graphite", color: "#a7b0ba" },
];

export function resolveTheme(mode: "dark" | "light" | "system"): ResolvedTheme {
  if (mode !== "system") return mode;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(mode: "dark" | "light" | "system", tint: string, strength: number, root: HTMLElement = document.documentElement): ResolvedTheme {
  const theme = resolveTheme(mode);
  const pal = buildPalette(theme, tint, strength);
  for (const [k, v] of Object.entries(pal)) {
    if (k === "--color-scheme") root.style.colorScheme = v;
    else root.style.setProperty(k, v);
  }
  root.dataset.theme = theme;
  return theme;
}

/** Keep the document themed from settings, following the OS when set to "system". */
export function watchTheme(get: () => { theme: "dark" | "light" | "system"; tint: string; tintStrength: number }): () => void {
  const apply = () => {
    const a = get();
    applyTheme(a.theme, a.tint, a.tintStrength);
  };
  apply();
  const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : null;
  mq?.addEventListener("change", apply);
  return () => mq?.removeEventListener("change", apply);
}
