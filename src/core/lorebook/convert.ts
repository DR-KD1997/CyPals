/**
 * Conversion between CyPals lorebooks and the two lorebook formats in the wild:
 *   - Character Card `character_book` (V2/V3 spec, embedded in cards; also Chub's standalone export)
 *   - SillyTavern World Info JSON (`{ entries: { "0": {...}, ... } }`)
 */
import type { LoreEntry, Lorebook, LorePosition } from "../types";
import { emptyLoreEntry, emptyLorebook } from "../defaults";
import { asBool, asNumber, asString, asStringArray, isRecord, uid } from "../util";

const ST_POSITIONS: LorePosition[] = [
  "before_char", // 0
  "after_char", // 1
  "top_of_history", // 2 (Author's Note top)
  "top_of_history", // 3 (Author's Note bottom)
  "at_depth", // 4
  "before_examples", // 5
  "after_examples", // 6
];

const LOGIC: LoreEntry["selectiveLogic"][] = ["and_any", "not_all", "not_any", "and_all"];

function positionFromCard(v: unknown): LorePosition {
  if (v === "before_char" || v === "after_char") return v;
  if (typeof v === "number") return ST_POSITIONS[v] ?? "before_char";
  return "before_char";
}

function entryFromCard(e: Record<string, unknown>, index: number): LoreEntry {
  const ext = isRecord(e.extensions) ? e.extensions : {};
  // SillyTavern stores its richer settings in extensions when exporting a card book.
  const stPos = ext.position;
  const position = stPos !== undefined ? positionFromCard(stPos) : positionFromCard(e.position);
  return emptyLoreEntry({
    id: uid("le"),
    name: asString(e.name ?? e.comment, `Entry ${index + 1}`),
    keys: asStringArray(e.keys ?? e.key),
    secondaryKeys: asStringArray(e.secondary_keys ?? e.keysecondary),
    selective: asBool(e.selective, false),
    selectiveLogic: LOGIC[asNumber(ext.selectiveLogic ?? e.selectiveLogic, 0)] ?? "and_any",
    content: asString(e.content),
    enabled: e.enabled !== undefined ? asBool(e.enabled, true) : !asBool(e.disable, false),
    constant: asBool(e.constant, false),
    caseSensitive: asBool(e.case_sensitive ?? ext.case_sensitive ?? e.caseSensitive, false),
    matchWholeWords: asBool(ext.match_whole_words ?? e.matchWholeWords, true),
    useRegex: asBool(e.use_regex, false),
    insertionOrder: asNumber(e.insertion_order ?? e.order, 100),
    priority: asNumber(e.priority, 10),
    position,
    depth: asNumber(ext.depth ?? e.depth, 4),
    scanDepth: ext.scan_depth == null && e.scanDepth == null ? null : asNumber(ext.scan_depth ?? e.scanDepth, 4),
    probability: asBool(ext.useProbability ?? e.useProbability, true)
      ? asNumber(ext.probability ?? e.probability, 100)
      : 100,
    sticky: asNumber(ext.sticky ?? e.sticky, 0),
    cooldown: asNumber(ext.cooldown ?? e.cooldown, 0),
    characterFilter: asStringArray(ext.cypals_character_filter),
    extensions: ext,
  });
}

/** From a card's `character_book` object. */
export function lorebookFromCharacterBook(book: Record<string, unknown>, fallbackName: string): Lorebook {
  const lb = emptyLorebook(asString(book.name, fallbackName) || fallbackName);
  lb.description = asString(book.description);
  lb.scanDepth = asNumber(book.scan_depth, lb.scanDepth);
  lb.tokenBudget = asNumber(book.token_budget, lb.tokenBudget);
  lb.recursive = asBool(book.recursive_scanning, false);
  lb.extensions = isRecord(book.extensions) ? book.extensions : {};
  const entries = Array.isArray(book.entries) ? book.entries : [];
  lb.entries = entries.filter(isRecord).map(entryFromCard);
  return lb;
}

/** From a SillyTavern World Info export (entries as an object keyed by uid). */
export function lorebookFromWorldInfo(json: Record<string, unknown>, name: string): Lorebook {
  const lb = emptyLorebook(asString(json.name, name) || name);
  const raw = json.entries;
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : [];
  lb.entries = list.filter(isRecord).map(entryFromCard);
  return lb;
}

/** Accepts any supported lorebook JSON shape. */
export function parseLorebookJson(json: unknown, filename = "Imported Lorebook"): Lorebook {
  if (!isRecord(json)) throw new Error("Lorebook is not a JSON object");
  // CyPals native
  if (json.schema === 1 && Array.isArray(json.entries) && typeof json.id === "string") {
    return json as unknown as Lorebook;
  }
  // A whole character card: pull its book out.
  const data = isRecord(json.data) ? json.data : null;
  if (data && isRecord(data.character_book)) {
    return lorebookFromCharacterBook(data.character_book, `${asString(data.name, "Card")} — lore`);
  }
  // Chub / spec `character_book` exported on its own, or an ST WI file.
  if (Array.isArray(json.entries)) return lorebookFromCharacterBook(json, filename);
  if (isRecord(json.entries)) return lorebookFromWorldInfo(json, filename);
  throw new Error("Unrecognised lorebook format");
}

/** To a spec-compliant `character_book`, preserving ST-style extras in extensions. */
export function lorebookToCharacterBook(lb: Lorebook): Record<string, unknown> {
  return {
    name: lb.name,
    description: lb.description,
    scan_depth: lb.scanDepth,
    token_budget: lb.tokenBudget,
    recursive_scanning: lb.recursive,
    extensions: lb.extensions,
    entries: lb.entries.map((e, i) => ({
      id: i,
      keys: e.keys,
      secondary_keys: e.secondaryKeys,
      content: e.content,
      enabled: e.enabled,
      insertion_order: e.insertionOrder,
      case_sensitive: e.caseSensitive,
      use_regex: e.useRegex,
      constant: e.constant,
      selective: e.selective,
      priority: e.priority,
      name: e.name,
      comment: e.name,
      position: e.position === "after_char" ? "after_char" : "before_char",
      extensions: {
        ...e.extensions,
        position: ST_POSITIONS.indexOf(e.position),
        depth: e.depth,
        selectiveLogic: LOGIC.indexOf(e.selectiveLogic),
        match_whole_words: e.matchWholeWords,
        probability: e.probability,
        useProbability: e.probability < 100,
        scan_depth: e.scanDepth,
        sticky: e.sticky,
        cooldown: e.cooldown,
        cypals_character_filter: e.characterFilter,
      },
    })),
  };
}
