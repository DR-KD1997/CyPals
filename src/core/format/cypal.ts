/**
 * The `.cypal` companion file format.
 *
 * A .cypal file is a ZIP archive:
 *
 *   cypal.json              – manifest { format: "cypal", version: 1, app, exportedAt, companionId }
 *   companion.json          – the Companion object (schema 1)
 *   lorebooks/<id>.json     – every shared lorebook the companion references (so it
 *                             travels with the file; on import they merge into the library)
 *   assets/...              – models, Live2D folders, portraits, backgrounds, voice samples
 *   card.png                – optional: a V2+V3 character card for other apps
 *
 * Text entries are deflated; already-compressed binaries (png, vrm, glb, jpg…)
 * are stored to keep packing fast. Asset paths in companion.json are relative
 * to the archive root, and any path traversal is rejected on import.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { Companion, Lorebook } from "../types";
import { isRecord, nowIso } from "../util";
import pkg from "../../../package.json";

export const CYPAL_FORMAT = "cypal";
export const CYPAL_VERSION = 1;
export const CYPAL_EXTENSION = ".cypal";
export const CYPAL_MIME = "application/x-cypal+zip";

export interface CypalManifest {
  format: typeof CYPAL_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  companionId: string;
  name: string;
}

export interface CypalBundle {
  manifest: CypalManifest;
  companion: Companion;
  lorebooks: Lorebook[];
  /** Archive path → bytes, for everything under `assets/`. */
  assets: Map<string, Uint8Array>;
  card?: Uint8Array;
}

export class CypalError extends Error {}

const STORE_EXT = /\.(png|jpe?g|webp|gif|avif|vrm|glb|moc3|mp3|ogg|opus|m4a|mp4|webm|zip)$/i;
/** Hard caps protect against zip bombs from untrusted files. */
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 20000;

export function safeAssetPath(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!norm || norm.startsWith("/") || /^[a-z]:/i.test(norm) || norm.split("/").some((s) => s === ".." || s === "")) {
    throw new CypalError(`Unsafe asset path: ${p}`);
  }
  return norm;
}

/** Collect every asset path a companion references (avatars + background). */
export function referencedAssets(c: Companion): string[] {
  const paths = new Set<string>();
  for (const a of c.avatars) {
    if (a.kind === "model3d") {
      paths.add(a.model.path);
      Object.values(a.animations).forEach((r) => paths.add(r.path));
    } else if (a.kind === "live2d") {
      paths.add(a.entry.path);
      a.files.forEach((r) => paths.add(r.path));
    } else {
      Object.values(a.images).flat().forEach((r) => paths.add(r.path));
    }
  }
  if (c.presentation.background.type === "image") paths.add(c.presentation.background.image.path);
  return [...paths];
}

export function packCypal(bundle: Omit<CypalBundle, "manifest"> & { app?: string }): Uint8Array {
  const { companion, lorebooks, assets, card } = bundle;
  const missing = referencedAssets(companion).filter((p) => !assets.has(p));
  if (missing.length) throw new CypalError(`Missing assets: ${missing.join(", ")}`);

  const manifest: CypalManifest = {
    format: CYPAL_FORMAT,
    version: CYPAL_VERSION,
    app: bundle.app ?? `CyPals ${pkg.version}`,
    exportedAt: nowIso(),
    companionId: companion.id,
    name: companion.character.name,
  };
  const files: Zippable = {
    "cypal.json": strToU8(JSON.stringify(manifest, null, 2)),
    "companion.json": strToU8(JSON.stringify(companion, null, 2)),
  };
  for (const lb of lorebooks) files[`lorebooks/${safeAssetPath(lb.id)}.json`] = strToU8(JSON.stringify(lb, null, 2));
  for (const [path, bytes] of assets) {
    const p = safeAssetPath(path);
    if (!p.startsWith("assets/")) throw new CypalError(`Assets must live under assets/: ${p}`);
    files[p] = STORE_EXT.test(p) ? [bytes, { level: 0 }] : bytes;
  }
  if (card) files["card.png"] = [card, { level: 0 }];
  return zipSync(files, { level: 6 });
}

export function unpackCypal(bytes: Uint8Array): CypalBundle {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new CypalError("Not a .cypal archive");
  let entries = 0;
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      entries++;
      total += f.originalSize;
      if (entries > MAX_ENTRIES) throw new CypalError("Archive has too many entries");
      if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new CypalError("Archive is too large");
      return true;
    },
  });

  const manifestRaw = files["cypal.json"];
  if (!manifestRaw) throw new CypalError("Missing cypal.json manifest");
  const manifest = JSON.parse(strFromU8(manifestRaw)) as CypalManifest;
  if (manifest.format !== CYPAL_FORMAT) throw new CypalError("Wrong manifest format");
  if (manifest.version > CYPAL_VERSION) {
    throw new CypalError(`This file was made by a newer CyPals (format v${manifest.version}). Please update the app.`);
  }

  const compRaw = files["companion.json"];
  if (!compRaw) throw new CypalError("Missing companion.json");
  const companion = migrateCompanion(JSON.parse(strFromU8(compRaw)));

  const lorebooks: Lorebook[] = [];
  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if (path.startsWith("lorebooks/") && path.endsWith(".json")) {
      lorebooks.push(JSON.parse(strFromU8(data)) as Lorebook);
    } else if (path.startsWith("assets/")) {
      assets.set(safeAssetPath(path), data);
    }
  }
  for (const p of referencedAssets(companion)) safeAssetPath(p);
  return { manifest, companion, lorebooks, assets, card: files["card.png"] };
}

/** Upgrades older companion objects. Schema 1 is current. */
export function migrateCompanion(raw: unknown): Companion {
  if (!isRecord(raw)) throw new CypalError("companion.json is not an object");
  if (raw.schema !== 1) throw new CypalError(`Unsupported companion schema ${String(raw.schema)}`);
  const c = raw as unknown as Companion;
  // Forward-compatible defaults for fields added after 0.1.
  c.behaviour = {
    fourthWallAware: false,
    fourthWallFrequency: 0.15,
    autonomousChat: true,
    idleChatterSeconds: 0,
    ...((c.behaviour as Partial<Companion["behaviour"]> | undefined) ?? {}),
  } as Companion["behaviour"];
  c.lorebookIds ??= [];
  c.avatars ??= [];
  return c;
}
