/**
 * Character Card import/export (Tavern V1, V2 `chara_card_v2`, V3 `chara_card_v3`, CHARX).
 *
 * Import maps every known card field onto CyPals' CharacterDefinition and keeps
 * unknown data in `extensions` so nothing is lost on re-export. An embedded
 * `character_book` becomes the companion's embedded lorebook, which the user
 * can promote into the shared lorebook library.
 */
import { unzipSync } from "fflate";
import type { CharacterDefinition, Companion, Lorebook, PortraitAvatar, AssetRef } from "../types";
import { asString, asStringArray, base64ToBytes, bytesToBase64, isRecord, uid, utf8Decode, utf8Encode } from "../util";
import { isPng, readTextChunks, writeTextChunks, BLANK_PNG } from "./png";
import { lorebookFromCharacterBook, lorebookToCharacterBook } from "../lorebook/convert";
import { defaultCompanion } from "../defaults";
import { portraitKeyFor } from "../synonyms";

export type CardVersion = "ccv1" | "ccv2" | "ccv3";

export interface ParsedCard {
  version: CardVersion;
  character: CharacterDefinition;
  lorebook: Lorebook | null;
  /** Raw JSON for debugging / round-trip. */
  raw: Record<string, unknown>;
  /** Images found in the card (PNG itself, CHARX assets). Path → bytes. */
  images: { path: string; mime: string; bytes: Uint8Array; role: "icon" | "emotion" | "background" | "other"; name: string }[];
}

export class CardParseError extends Error {}

/** Detects the card version of a parsed JSON object. */
export function detectVersion(json: Record<string, unknown>): CardVersion {
  if (json.spec === "chara_card_v3") return "ccv3";
  if (json.spec === "chara_card_v2") return "ccv2";
  if (isRecord(json.data) && (json.data as Record<string, unknown>).name !== undefined && json.spec)
    return String(json.spec).includes("v3") ? "ccv3" : "ccv2";
  if (json.name !== undefined || json.char_name !== undefined) return "ccv1";
  throw new CardParseError("Unrecognised character card JSON");
}

/** Parse card JSON (any version) into a CyPals character definition + lorebook. */
export function parseCardJson(input: unknown): ParsedCard {
  if (!isRecord(input)) throw new CardParseError("Card is not a JSON object");
  const version = detectVersion(input);
  const d: Record<string, unknown> = version === "ccv1" ? input : (input.data as Record<string, unknown>);

  // V1 fields (also present in V2/V3 `data`). Pygmalion-era aliases are accepted.
  const name = asString(d.name ?? d.char_name);
  if (!name) throw new CardParseError("Card has no character name");

  const known = new Set([
    "name", "char_name", "description", "char_persona", "personality", "scenario", "world_scenario",
    "first_mes", "char_greeting", "mes_example", "example_dialogue", "creator_notes", "system_prompt",
    "post_history_instructions", "alternate_greetings", "character_book", "tags", "creator",
    "character_version", "extensions", "assets", "nickname", "creator_notes_multilingual", "source",
    "group_only_greetings", "creation_date", "modification_date",
  ]);
  const leftovers: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (!known.has(k)) leftovers[k] = v;

  const ext: Record<string, unknown> = {
    ...(isRecord(d.extensions) ? d.extensions : {}),
  };
  if (Object.keys(leftovers).length) ext["cypals/unknown_fields"] = leftovers;
  if (version === "ccv3") {
    for (const k of ["assets", "creator_notes_multilingual", "source", "group_only_greetings", "creation_date", "modification_date"]) {
      if (d[k] !== undefined) ext[`ccv3/${k}`] = d[k];
    }
  }

  const character: CharacterDefinition = {
    name,
    tagline: firstLine(asString(d.creator_notes)),
    description: asString(d.description ?? d.char_persona),
    personality: asString(d.personality),
    scenario: asString(d.scenario ?? d.world_scenario),
    firstMessage: asString(d.first_mes ?? d.char_greeting),
    alternateGreetings: asStringArray(d.alternate_greetings),
    exampleDialogue: asString(d.mes_example ?? d.example_dialogue),
    systemPrompt: asString(d.system_prompt),
    postHistoryInstructions: asString(d.post_history_instructions),
    creatorNotes: asString(d.creator_notes),
    creator: asString(d.creator),
    characterVersion: asString(d.character_version),
    tags: asStringArray(d.tags),
    nickname: asString(d.nickname),
    extensions: ext,
  };

  const lorebook = isRecord(d.character_book)
    ? lorebookFromCharacterBook(d.character_book, `${name} — embedded lore`)
    : null;

  return { version, character, lorebook, raw: input, images: [] };
}

function firstLine(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/** Parse a PNG character card. V3 (`ccv3`) data is preferred over V2/V1 (`chara`). */
export function parsePngCard(bytes: Uint8Array): ParsedCard {
  const text = readTextChunks(bytes);
  const payload = text.get("ccv3") ?? text.get("chara");
  if (!payload) throw new CardParseError("PNG has no embedded character card (no 'chara' or 'ccv3' chunk)");
  const json = decodeCardPayload(payload);
  const card = parseCardJson(json);
  card.images.push({ path: "assets/portraits/card.png", mime: "image/png", bytes, role: "icon", name: "main" });
  return card;
}

function decodeCardPayload(payload: string): unknown {
  const trimmed = payload.trim();
  // Some writers store raw JSON instead of base64.
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return JSON.parse(utf8Decode(base64ToBytes(trimmed)));
}

/** Parse a CHARX (zip with card.json + assets) file — the V3 container format. */
export function parseCharx(bytes: Uint8Array): ParsedCard {
  const files = unzipSync(bytes);
  const cardFile = files["card.json"];
  if (!cardFile) throw new CardParseError("CHARX archive has no card.json");
  const card = parseCardJson(JSON.parse(utf8Decode(cardFile)));
  const assets = (card.raw.data as Record<string, unknown> | undefined)?.assets;
  if (Array.isArray(assets)) {
    for (const a of assets) {
      if (!isRecord(a)) continue;
      const uri = asString(a.uri);
      const m = /^embed?ded:\/\/(.+)$/.exec(uri);
      if (!m) continue;
      const data = files[m[1]];
      if (!data) continue;
      const type = asString(a.type);
      const role = type === "icon" ? "icon" : type === "emotion" ? "emotion" : type === "background" ? "background" : "other";
      const ext = asString(a.ext, m[1].split(".").pop() ?? "png").toLowerCase();
      card.images.push({
        path: `assets/${role === "emotion" ? "portraits" : role}/${asString(a.name, "asset")}.${ext}`,
        mime: mimeFromExt(ext),
        bytes: data,
        role,
        name: asString(a.name, "main"),
      });
    }
  }
  return card;
}

export function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
    case "vrm": return "model/vrm";
    case "glb": return "model/gltf-binary";
    case "gltf": return "model/gltf+json";
    case "json": return "application/json";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "ogg": return "audio/ogg";
    default: return "application/octet-stream";
  }
}

/** Sniff the file type and parse it as a character card. */
export function parseCardFile(bytes: Uint8Array, filename = ""): ParsedCard {
  if (isPng(bytes)) return parsePngCard(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseCharx(bytes); // "PK" zip
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json") || bytes[0] === 0x7b /* { */ || bytes[0] === 0xef /* BOM */) {
    const text = utf8Decode(bytes).replace(/^﻿/, "");
    return parseCardJson(JSON.parse(text));
  }
  throw new CardParseError(`Unsupported card file: ${filename || "unknown type"}`);
}

/**
 * Build a Companion from a parsed card. Images from the card become a portrait
 * avatar (emotion images keyed by name, so a SillyTavern-style expression pack
 * in a CHARX works out of the box).
 */
export function companionFromCard(card: ParsedCard, origin?: string): { companion: Companion; assets: Map<string, Uint8Array> } {
  const c = defaultCompanion(card.character.name);
  c.character = card.character;
  c.embeddedLorebook = card.lorebook;
  c.source = { kind: card.version, origin };
  const assets = new Map<string, Uint8Array>();

  const portraitImages: Record<string, AssetRef[]> = {};
  // The card icon is only a stand-in for "neutral" when the card ships no neutral emotion image.
  const hasNeutralEmotion = card.images.some((i) => i.role === "emotion" && portraitKeyFor(i.name) === "neutral");
  for (const img of card.images) {
    if (img.role === "icon" && hasNeutralEmotion) {
      assets.set(img.path, img.bytes); // kept for card re-export
      continue;
    }
    if (img.role === "background") {
      assets.set(img.path, img.bytes);
      c.presentation.background = { type: "image", image: { path: img.path, mime: img.mime }, fit: "cover" };
      continue;
    }
    if (img.role !== "icon" && img.role !== "emotion") continue;
    assets.set(img.path, img.bytes);
    const key = img.role === "icon" ? "neutral" : portraitKeyFor(img.name);
    (portraitImages[key] ??= []).push({ path: img.path, mime: img.mime });
  }
  if (Object.keys(portraitImages).length) {
    const avatar: PortraitAvatar = {
      id: uid("av"),
      kind: "portraits",
      label: "Card portraits",
      images: portraitImages,
      fallback: portraitImages.neutral ? "neutral" : Object.keys(portraitImages)[0],
      transitionMs: 180,
      talkingSuffix: "_talk",
    };
    c.avatars.push(avatar);
    c.activeAvatarId = avatar.id;
  }
  return { companion: c, assets };
}

// ───────────── export ─────────────

/** Export a companion as a V3 card JSON object (V2-compatible fields are filled too). */
export function companionToCardV3(c: Companion, lorebook: Lorebook | null): Record<string, unknown> {
  const ch = c.character;
  const extensions: Record<string, unknown> = { ...ch.extensions };
  const unknown = extensions["cypals/unknown_fields"];
  delete extensions["cypals/unknown_fields"];
  const v3Extras: Record<string, unknown> = {};
  for (const k of Object.keys(extensions)) {
    if (k.startsWith("ccv3/")) {
      v3Extras[k.slice(5)] = extensions[k];
      delete extensions[k];
    }
  }
  extensions.cypals = {
    behaviour: c.behaviour,
    voice: c.voice,
    presentation: { mode: c.presentation.mode, frame: c.presentation.frame, textStyle: c.presentation.textStyle },
  };
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      ...(isRecord(unknown) ? unknown : {}),
      name: ch.name,
      description: ch.description,
      personality: ch.personality,
      scenario: ch.scenario,
      first_mes: ch.firstMessage,
      mes_example: ch.exampleDialogue,
      creator_notes: ch.creatorNotes,
      system_prompt: ch.systemPrompt,
      post_history_instructions: ch.postHistoryInstructions,
      alternate_greetings: ch.alternateGreetings,
      tags: ch.tags,
      creator: ch.creator,
      character_version: ch.characterVersion,
      nickname: ch.nickname || undefined,
      group_only_greetings: [],
      ...v3Extras,
      character_book: lorebook ? lorebookToCharacterBook(lorebook) : undefined,
      extensions,
    },
  };
}

/** Downgrade to a V2 object (for tools that don't read V3). */
export function cardV3ToV2(v3: Record<string, unknown>): Record<string, unknown> {
  const data = { ...(v3.data as Record<string, unknown>) };
  for (const k of ["nickname", "group_only_greetings", "assets", "source", "creator_notes_multilingual", "creation_date", "modification_date"]) delete data[k];
  return { spec: "chara_card_v2", spec_version: "2.0", data };
}

/** Write a PNG card containing both `chara` (V2) and `ccv3` chunks, like SillyTavern does. */
export function exportPngCard(c: Companion, lorebook: Lorebook | null, portrait?: Uint8Array): Uint8Array {
  const v3 = companionToCardV3(c, lorebook);
  const v2 = cardV3ToV2(v3);
  const enc = (o: unknown) => bytesToBase64(utf8Encode(JSON.stringify(o)));
  return writeTextChunks(portrait && isPng(portrait) ? portrait : BLANK_PNG, { chara: enc(v2), ccv3: enc(v3) });
}
