/** Browser implementation (dev server / preview). Storage in IndexedDB; no overlay or screen capture. */
import type { Platform, PickedFile } from "./types";

const DB = "cypals";
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("json");
      req.result.createObjectStore("assets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function keysWithPrefix(store: string, prefix: string): Promise<string[]> {
  const keys = (await tx(store, "readonly", (s) => s.getAllKeys())) as string[];
  return keys.filter((k) => k.startsWith(prefix));
}

function pick(accept: string[], multiple: boolean, directory = false): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple || directory;
    if (directory) input.setAttribute("webkitdirectory", "");
    else input.accept = accept.map((a) => (a.startsWith(".") ? a : `.${a}`)).join(",");
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(
        await Promise.all(
          files.map(async (f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
        ),
      );
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export function createWebPlatform(): Platform {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cypals") : null;
  channel?.addEventListener("message", (e) => listeners.get(e.data.event)?.forEach((fn) => fn(e.data.payload)));
  const ua = navigator.userAgent;
  const osName = /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : /Mac/i.test(ua) ? "macOS" : "this device";

  return {
    kind: "web",
    osName,
    isDesktop: !/Android|iPhone|iPad/i.test(ua),
    fetch: (u, init) => fetch(u, init),
    loadJson: async (key) => ((await tx("json", "readonly", (s) => s.get(key))) ?? null) as never,
    saveJson: async (key, value) => void (await tx("json", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(value)), key))),
    deleteKey: async (key) => void (await tx("json", "readwrite", (s) => s.delete(key))),
    listKeys: (prefix) => keysWithPrefix("json", prefix),
    readAsset: async (scope, path) => ((await tx("assets", "readonly", (s) => s.get(`${scope}/${path}`))) as Uint8Array | undefined) ?? null,
    writeAsset: async (scope, path, bytes) => void (await tx("assets", "readwrite", (s) => s.put(bytes, `${scope}/${path}`))),
    deleteAssets: async (scope) => {
      for (const k of await keysWithPrefix("assets", `${scope}/`)) await tx("assets", "readwrite", (s) => s.delete(k));
    },
    listAssets: async (scope) => (await keysWithPrefix("assets", `${scope}/`)).map((k) => k.slice(scope.length + 1)),
    // Dev only: browser has no keychain, so keys live in IndexedDB.
    getSecret: async (name) => ((await tx("json", "readonly", (s) => s.get(`secret:${name}`))) as string | undefined) ?? "",
    setSecret: async (name, value) => void (await tx("json", "readwrite", (s) => s.put(value, `secret:${name}`))),
    pickFiles: ({ accept, multiple }) => pick(accept, !!multiple),
    pickFolder: () => pick([], true, true),
    saveFile: async (name, bytes) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    },
    emit: async (event, payload) => {
      channel?.postMessage({ event, payload });
    },
    listen: async (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
  };
}
