import type { Platform } from "./types";
import { createWebPlatform } from "./web";

let current: Platform | null = null;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function initPlatform(): Promise<Platform> {
  if (current) return current;
  current = isTauri() ? await (await import("./tauri")).createTauriPlatform() : createWebPlatform();
  return current;
}

export function platform(): Platform {
  if (!current) throw new Error("Platform not initialised");
  return current;
}

export type { Platform } from "./types";
