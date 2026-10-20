/** Resolves bundle asset paths to object URLs for renderers, with caching. */
import { platform } from "../platform";
import { mimeFromExt } from "../core/cards/parse";

const cache = new Map<string, Promise<string | null>>();

export function companionScope(id: string): string {
  return `companion/${id}`;
}

export function assetUrl(companionId: string, path: string): Promise<string | null> {
  const key = `${companionId}::${path}`;
  let p = cache.get(key);
  if (!p) {
    p = platform()
      .readAsset(companionScope(companionId), path)
      .then((bytes) => {
        // Never cache a miss: the asset may still be being written, or the read failed transiently.
        if (!bytes) {
          cache.delete(key);
          return null;
        }
        return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFromExt(path.split(".").pop() ?? "") }));
      });
    cache.set(key, p);
  }
  return p;
}

/** Drop cached URLs for a companion after its assets change. */
export function invalidateAssets(companionId: string): void {
  for (const [k, p] of cache) {
    if (k.startsWith(`${companionId}::`)) {
      p.then((u) => u && URL.revokeObjectURL(u));
      cache.delete(k);
    }
  }
}

/** Store picked files under `assets/<folder>/` and return their bundle paths. */
export async function storeAssets(companionId: string, folder: string, files: { name: string; bytes: Uint8Array }[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const clean = f.name.replace(/\\/g, "/").split("/").filter((s) => s && s !== "." && s !== "..").join("/");
    const path = `assets/${folder}/${clean}`;
    await platform().writeAsset(companionScope(companionId), path, f.bytes);
    out.push(path);
  }
  invalidateAssets(companionId);
  return out;
}
