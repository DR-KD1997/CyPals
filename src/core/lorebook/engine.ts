/**
 * Lorebook activation engine.
 *
 * Lorebooks live in a shared library and can be attached to any number of
 * companions. On each generation, the books of the *speaking* companion (plus
 * its embedded book) are scanned against recent chat; matching entries are
 * returned grouped by insertion slot, within each book's token budget.
 *
 * Semantics follow SillyTavern World Info closely so imported books behave the
 * same: keyword / regex keys, selective secondary-key logic, constant entries,
 * probability, recursion, sticky / cooldown timers and per-entry scan depth.
 */
import type { ID, LoreEntry, Lorebook, LorePosition } from "../types";
import { estimateTokens } from "../util";

export interface ScanMessage {
  name: string;
  text: string;
}

export interface LoreState {
  [entryId: ID]: { stickyLeft: number; cooldownLeft: number };
}

export interface ActivationInput {
  books: Lorebook[];
  /** Oldest → newest. */
  messages: ScanMessage[];
  /** The companion about to speak; entries with a characterFilter must include it. */
  speakerId: ID;
  state: LoreState;
  random?: () => number;
  /** Extra text always scanned (e.g. character description when the book opts in). */
  extraScanText?: string;
}

export interface ActivatedEntry {
  entry: LoreEntry;
  bookId: ID;
  reason: "constant" | "keyword" | "sticky" | "recursive";
}

export interface ActivationResult {
  bySlot: Record<LorePosition, ActivatedEntry[]>;
  /** Updated sticky/cooldown state to persist on the session. */
  nextState: LoreState;
  tokensUsed: number;
}

const SLOTS: LorePosition[] = ["before_char", "after_char", "before_examples", "after_examples", "top_of_history", "at_depth"];

function compileKey(key: string, e: LoreEntry): RegExp | null {
  const k = key.trim();
  if (!k) return null;
  const regexLiteral = /^\/(.+)\/([gimsuy]*)$/.exec(k);
  if (regexLiteral || e.useRegex) {
    try {
      const src = regexLiteral ? regexLiteral[1] : k;
      let flags = regexLiteral ? regexLiteral[2] : "";
      if (!e.caseSensitive && !flags.includes("i")) flags += "i";
      return new RegExp(src, flags.replace("g", ""));
    } catch {
      return null; // invalid user regex: entry simply doesn't match on this key
    }
  }
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-word matching only applies when the key itself starts/ends with word chars.
  const pre = e.matchWholeWords && /^\w/.test(k) ? "(?<![\\p{L}\\p{N}_])" : "";
  const post = e.matchWholeWords && /\w$/.test(k) ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(pre + escaped + post, e.caseSensitive ? "u" : "iu");
}

function anyMatch(keys: string[], text: string, e: LoreEntry): boolean {
  return keys.some((k) => compileKey(k, e)?.test(text) ?? false);
}

function allMatch(keys: string[], text: string, e: LoreEntry): boolean {
  const valid = keys.filter((k) => k.trim());
  return valid.length > 0 && valid.every((k) => compileKey(k, e)?.test(text) ?? false);
}

export function entryMatches(e: LoreEntry, text: string): boolean {
  if (!anyMatch(e.keys, text, e)) return false;
  if (!e.selective) return true;
  const sec = e.secondaryKeys.filter((k) => k.trim());
  if (!sec.length) return true;
  switch (e.selectiveLogic) {
    case "and_any": return anyMatch(sec, text, e);
    case "and_all": return allMatch(sec, text, e);
    case "not_any": return !anyMatch(sec, text, e);
    case "not_all": return !allMatch(sec, text, e);
  }
}

function scanText(messages: ScanMessage[], depth: number, extra = ""): string {
  const recent = depth <= 0 ? [] : messages.slice(-depth);
  return [extra, ...recent.map((m) => `${m.name}: ${m.text}`)].filter(Boolean).join("\n");
}

export function activateLore(input: ActivationInput): ActivationResult {
  const random = input.random ?? Math.random;
  const nextState: LoreState = {};
  const bySlot = Object.fromEntries(SLOTS.map((s) => [s, [] as ActivatedEntry[]])) as Record<LorePosition, ActivatedEntry[]>;
  let tokensUsed = 0;
  const seen = new Set<ID>();

  for (const book of input.books) {
    const eligible = book.entries.filter(
      (e) => e.enabled && (e.characterFilter.length === 0 || e.characterFilter.includes(input.speakerId)),
    );
    const activated: ActivatedEntry[] = [];
    const take = (e: LoreEntry, reason: ActivatedEntry["reason"]) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      activated.push({ entry: e, bookId: book.id, reason });
    };

    // Pass 1: sticky + constants + keyword matches against chat.
    for (const e of eligible) {
      const st = input.state[e.id];
      if (st && st.stickyLeft > 0) {
        take(e, "sticky");
        continue;
      }
      if (st && st.cooldownLeft > 0) continue;
      if (e.constant) {
        take(e, "constant");
        continue;
      }
      const text = scanText(input.messages, e.scanDepth ?? book.scanDepth, input.extraScanText);
      if (entryMatches(e, text) && random() * 100 < e.probability) take(e, "keyword");
    }

    // Pass 2..n: recursion — activated content may trigger further entries.
    if (book.recursive) {
      let frontier = activated.slice();
      for (let step = 0; step < book.maxRecursionSteps && frontier.length; step++) {
        const text = frontier.map((a) => a.entry.content).join("\n");
        const before = activated.length;
        for (const e of eligible) {
          if (seen.has(e.id) || e.constant) continue;
          if (input.state[e.id]?.cooldownLeft) continue;
          if (entryMatches(e, text) && random() * 100 < e.probability) take(e, "recursive");
        }
        frontier = activated.slice(before);
      }
    }

    // Budget: keep highest-priority entries (constants first) until the book's budget is spent.
    activated.sort(
      (a, b) =>
        Number(b.entry.constant) - Number(a.entry.constant) ||
        b.entry.priority - a.entry.priority ||
        a.entry.insertionOrder - b.entry.insertionOrder,
    );
    let bookTokens = 0;
    for (const a of activated) {
      const t = estimateTokens(a.entry.content);
      if (bookTokens + t > book.tokenBudget && !a.entry.constant) continue;
      bookTokens += t;
      bySlot[a.entry.position].push(a);
    }
    tokensUsed += bookTokens;

    // Timers: newly triggered sticky entries start their countdown; expiring ones enter cooldown.
    for (const e of eligible) {
      const prev = input.state[e.id] ?? { stickyLeft: 0, cooldownLeft: 0 };
      const isActive = activated.some((a) => a.entry.id === e.id);
      let stickyLeft = prev.stickyLeft > 0 ? prev.stickyLeft - 1 : 0;
      let cooldownLeft = prev.cooldownLeft > 0 ? prev.cooldownLeft - 1 : 0;
      if (isActive && prev.stickyLeft === 0 && e.sticky > 0) stickyLeft = e.sticky;
      // Cooldown begins when an entry's active period ends: immediately for
      // non-sticky entries, or when the sticky countdown runs out.
      if (e.cooldown > 0 && ((isActive && e.sticky === 0) || prev.stickyLeft === 1)) cooldownLeft = e.cooldown;
      if (stickyLeft || cooldownLeft) nextState[e.id] = { stickyLeft, cooldownLeft };
    }
  }

  for (const s of SLOTS) bySlot[s].sort((a, b) => a.entry.insertionOrder - b.entry.insertionOrder);
  return { bySlot, nextState, tokensUsed };
}
