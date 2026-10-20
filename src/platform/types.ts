/**
 * Platform abstraction. The UI and core never touch Tauri directly; they go
 * through this interface, implemented by:
 *   - tauri.ts  (Windows, Linux, Android builds)
 *   - web.ts    (plain browser dev server; IndexedDB storage, no overlay/screen capture)
 */
import type { FetchLike } from "../core/llm/types";
import type { VisionPolicy, WindowInfo } from "../core/vision/policy";

export type PlatformKind = "windows" | "linux" | "android" | "macos" | "web";

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

export interface CapturedFrame {
  label: string;
  mime: string;
  /** base64 */
  data: string;
}

export interface Platform {
  kind: PlatformKind;
  osName: string;
  isDesktop: boolean;
  /** CORS-free fetch (Tauri HTTP plugin) or window.fetch. */
  fetch: FetchLike;

  // persistence (app data dir / IndexedDB)
  loadJson<T>(key: string): Promise<T | null>;
  saveJson(key: string, value: unknown): Promise<void>;
  deleteKey(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  readAsset(scope: string, path: string): Promise<Uint8Array | null>;
  writeAsset(scope: string, path: string, bytes: Uint8Array): Promise<void>;
  deleteAssets(scope: string): Promise<void>;
  listAssets(scope: string): Promise<string[]>;

  // secrets (API keys) — OS keychain on desktop/Android, never exported
  getSecret(name: string): Promise<string>;
  setSecret(name: string, value: string): Promise<void>;

  // files
  pickFiles(opts: { accept: string[]; multiple?: boolean; title?: string }): Promise<PickedFile[]>;
  /** Pick a folder's worth of files (Live2D models are folders). */
  pickFolder?(title?: string): Promise<PickedFile[]>;
  saveFile(suggestedName: string, bytes: Uint8Array, filters?: { name: string; extensions: string[] }[]): Promise<boolean>;

  // vision (desktop only; screen capture re-checks the policy natively)
  vision?: {
    setPolicy(p: VisionPolicy): Promise<void>;
    listWindows(): Promise<WindowInfo[]>;
    captureAllowed(): Promise<CapturedFrame[]>;
  };

  // overlay (Windows / Linux)
  overlay?: {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): Promise<boolean>;
    /** Let clicks pass through transparent areas; false while hovering a character. */
    setClickThrough(through: boolean): Promise<void>;
  };

  /** Files the app was opened with (double-clicked .cypal / card files). */
  startupFiles?(): Promise<PickedFile[]>;

  /** Broadcast between the main window and the overlay window. */
  emit(event: string, payload: unknown): Promise<void>;
  listen(event: string, fn: (payload: unknown) => void): Promise<() => void>;
}
