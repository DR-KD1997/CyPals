/**
 * Tauri implementation (Windows, Linux, Android).
 * Storage, secrets, screen capture and the overlay window are Rust commands
 * (see src-tauri/src); HTTP goes through the HTTP plugin so local LLM/TTS
 * servers and cloud APIs work without CORS restrictions.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, readDir } from "@tauri-apps/plugin-fs";
import type { CapturedFrame, Platform, PlatformKind, PickedFile } from "./types";
import type { WindowInfo } from "../core/vision/policy";

async function readPicked(paths: string[]): Promise<PickedFile[]> {
  return Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop() ?? p, bytes: await readFile(p) })));
}

async function walk(dir: string, rel = ""): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const e of await readDir(dir)) {
    const full = `${dir}/${e.name}`;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) out.push(...(await walk(full, r)));
    else if (e.isFile) out.push({ name: r, bytes: await readFile(full) });
  }
  return out;
}

export async function createTauriPlatform(): Promise<Platform> {
  const info = await invoke<{ os: string; desktop: boolean }>("platform_info");
  const kind = (["windows", "linux", "android", "macos"].includes(info.os) ? info.os : "linux") as PlatformKind;
  const osName = { windows: "Windows", linux: "Linux", android: "Android", macos: "macOS", web: "Web" }[kind];

  const platform: Platform = {
    kind,
    osName,
    isDesktop: info.desktop,
    fetch: (url, init) => tauriFetch(url, init) as Promise<Response>,

    loadJson: async (key) => {
      const s = await invoke<string | null>("store_read_json", { key });
      return s == null ? null : JSON.parse(s);
    },
    saveJson: (key, value) => invoke("store_write_json", { key, json: JSON.stringify(value) }),
    deleteKey: (key) => invoke("store_delete", { key }),
    listKeys: (prefix) => invoke<string[]>("store_list", { prefix }),
    // Returned as a raw ArrayBuffer; "not found" comes back as an error.
    readAsset: async (scope, path) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return new Uint8Array(await invoke<ArrayBuffer>("asset_read", { scope, path }));
        } catch (e) {
          if (String(e).includes("not found")) return null;
          console.warn(`asset_read ${scope}/${path} failed (attempt ${attempt + 1}):`, e);
          await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        }
      }
      return null;
    },
    // Raw bytes go as an ArrayBuffer body to avoid JSON-encoding large models.
    writeAsset: (scope, path, bytes) => invoke("asset_write", bytes, { headers: { "x-scope": encodeURIComponent(scope), "x-path": encodeURIComponent(path) } }),
    deleteAssets: (scope) => invoke("asset_delete_scope", { scope }),
    listAssets: (scope) => invoke<string[]>("asset_list", { scope }),

    getSecret: (name) => invoke<string>("secret_get", { name }),
    setSecret: (name, value) => invoke("secret_set", { name, value }),

    pickFiles: async ({ accept, multiple, title }) => {
      const res = await open({ multiple: !!multiple, title, filters: [{ name: "Supported files", extensions: accept.map((a) => a.replace(/^\./, "")) }] });
      if (!res) return [];
      return readPicked(Array.isArray(res) ? res : [res]);
    },
    pickFolder: async (title) => {
      const dir = await open({ directory: true, title });
      return typeof dir === "string" ? walk(dir) : [];
    },
    saveFile: async (name, bytes, filters) => {
      const path = await save({ defaultPath: name, filters });
      if (!path) return false;
      await writeFile(path, bytes);
      return true;
    },

    startupFiles: async () =>
      (await invoke<{ name: string; bytes: number[] }[]>("startup_files")).map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
    emit: (event, payload) => emit(event, payload),
    listen: (event, fn) => listen(event, (e) => fn(e.payload)),
  };

  if (info.desktop) {
    platform.vision = {
      setPolicy: (policy) => invoke("vision_set_policy", { policy }),
      listWindows: () => invoke<WindowInfo[]>("vision_list_windows"),
      captureAllowed: () => invoke<CapturedFrame[]>("vision_capture_allowed"),
    };
    platform.overlay = {
      open: () => invoke("overlay_open"),
      close: () => invoke("overlay_close"),
      isOpen: () => invoke<boolean>("overlay_is_open"),
      setClickThrough: (through) => invoke("overlay_set_click_through", { through }),
    };
  }
  return platform;
}
