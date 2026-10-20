/**
 * Vision privacy policy.
 *
 * The AI sees nothing by default. Screen and webcam access are separate,
 * explicit opt-ins. Screen sharing can be narrowed to specific windows or
 * programs (allow-list) or everything except some (block-list). Password
 * managers, banking and similar apps are always excluded, and the policy is
 * re-checked by the native side before any pixels are captured.
 */

export interface VisionPolicy {
  screen: {
    enabled: boolean;
    mode: "allowlist" | "blocklist";
    /** Program/executable names, case-insensitive ("firefox", "code", "krita"). */
    apps: string[];
    /** Substrings of window titles. */
    titles: string[];
    /** Capture the focused window only (default) or every allowed visible window. */
    scope: "focused" | "all-allowed";
    /** When to capture: on each user message, or every N seconds while chatting. */
    trigger: "on-message" | "interval";
    intervalSeconds: number;
    /** Downscale before sending to the model. */
    maxWidth: number;
  };
  webcam: {
    enabled: boolean;
    deviceId: string;
    trigger: "on-message" | "interval";
    intervalSeconds: number;
    maxWidth: number;
  };
  /** Show a visible indicator whenever a capture happens (cannot be disabled). */
  readonly indicator: true;
}

export const DEFAULT_VISION_POLICY: VisionPolicy = {
  screen: { enabled: false, mode: "allowlist", apps: [], titles: [], scope: "focused", trigger: "on-message", intervalSeconds: 30, maxWidth: 1280 },
  webcam: { enabled: false, deviceId: "", trigger: "on-message", intervalSeconds: 30, maxWidth: 640 },
  indicator: true,
};

/** Never captured, regardless of user lists. Matched against app name and title. */
export const ALWAYS_BLOCKED = [
  "1password", "bitwarden", "keepass", "keepassxc", "lastpass", "dashlane", "enpass", "proton pass",
  "keychain access", "seahorse", "kwalletmanager", "windows security", "credential manager",
  "cypals", // never show the AI its own window (feedback loop)
];

/** Window titles that suggest sensitive pages even inside allowed browsers. */
export const SENSITIVE_TITLE_PATTERNS = [/\bbank(ing)?\b/i, /\bpassword\b/i, /\bsign[\s-]?in\b/i, /\blog[\s-]?in\b/i, /\b2fa\b|\bauthenticator\b/i, /\bincognito\b|\bprivate browsing\b|\binprivate\b/i];

export interface WindowInfo {
  id: number;
  app: string;
  title: string;
  focused: boolean;
  minimized: boolean;
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

export function decideWindow(w: WindowInfo, p: VisionPolicy["screen"]): Decision {
  if (!p.enabled) return { allowed: false, reason: "Screen sharing is off" };
  if (w.minimized) return { allowed: false, reason: "Window is minimized" };
  const app = w.app.toLowerCase();
  const title = w.title.toLowerCase();
  if (ALWAYS_BLOCKED.some((b) => app.includes(b) || title.includes(b))) return { allowed: false, reason: "Protected app" };
  if (SENSITIVE_TITLE_PATTERNS.some((re) => re.test(w.title))) return { allowed: false, reason: "Sensitive page" };
  const appHit = p.apps.some((a) => a.trim() && app.includes(a.trim().toLowerCase()));
  const titleHit = p.titles.some((t) => t.trim() && title.includes(t.trim().toLowerCase()));
  const listed = appHit || titleHit;
  if (p.mode === "allowlist") return listed ? { allowed: true } : { allowed: false, reason: "Not on the allow-list" };
  return listed ? { allowed: false, reason: "On the block-list" } : { allowed: true };
}

/** Which windows to capture right now under the policy. */
export function selectWindows(windows: WindowInfo[], p: VisionPolicy["screen"]): WindowInfo[] {
  const allowed = windows.filter((w) => decideWindow(w, p).allowed);
  if (p.scope === "focused") return allowed.filter((w) => w.focused).slice(0, 1);
  return allowed.slice(0, 4);
}
