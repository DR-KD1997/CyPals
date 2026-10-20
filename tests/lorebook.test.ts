import { describe, expect, it } from "vitest";
import { activateLore, entryMatches, type LoreState } from "../src/core/lorebook/engine";
import { parseLorebookJson, lorebookToCharacterBook, lorebookFromCharacterBook } from "../src/core/lorebook/convert";
import { emptyLoreEntry, emptyLorebook } from "../src/core/defaults";
import { rng } from "../src/core/util";

const msgs = (...t: string[]) => t.map((text, i) => ({ name: i % 2 ? "Mira" : "Kaan", text }));

describe("lorebook matching", () => {
  it("matches whole words case-insensitively by default", () => {
    const e = emptyLoreEntry({ keys: ["cat"] });
    expect(entryMatches(e, "I saw a Cat today")).toBe(true);
    expect(entryMatches(e, "concatenate")).toBe(false);
  });

  it("supports regex keys", () => {
    const e = emptyLoreEntry({ keys: ["/dragons?/"] });
    expect(entryMatches(e, "Here be DRAGONS")).toBe(true);
  });

  it("ignores invalid regex instead of throwing", () => {
    const e = emptyLoreEntry({ keys: ["/([/"] });
    expect(entryMatches(e, "anything")).toBe(false);
  });

  it("applies selective logic", () => {
    const base = { keys: ["castle"], secondaryKeys: ["night", "storm"], selective: true };
    expect(entryMatches(emptyLoreEntry({ ...base, selectiveLogic: "and_any" }), "castle at night")).toBe(true);
    expect(entryMatches(emptyLoreEntry({ ...base, selectiveLogic: "and_all" }), "castle at night")).toBe(false);
    expect(entryMatches(emptyLoreEntry({ ...base, selectiveLogic: "not_any" }), "castle at night")).toBe(false);
    expect(entryMatches(emptyLoreEntry({ ...base, selectiveLogic: "not_all" }), "castle at night")).toBe(true);
  });

  it("matches non-latin keys", () => {
    expect(entryMatches(emptyLoreEntry({ keys: ["図書館"] }), "ミラは図書館にいる")).toBe(true);
  });
});

describe("lorebook activation", () => {
  const book = () => {
    const b = emptyLorebook("World");
    b.entries = [
      emptyLoreEntry({ id: "a", keys: ["archive"], content: "Archive lore", insertionOrder: 20 }),
      emptyLoreEntry({ id: "b", constant: true, content: "Always on", insertionOrder: 10 }),
      emptyLoreEntry({ id: "c", keys: ["basement"], content: "Basement lore", position: "at_depth", depth: 2 }),
      emptyLoreEntry({ id: "d", keys: ["secret"], content: "Only for Zed", characterFilter: ["zed"] }),
    ];
    return b;
  };

  it("activates constants and keyword entries within scan depth", () => {
    const r = activateLore({ books: [book()], messages: msgs("old basement talk", "x", "the archive?"), speakerId: "mira", state: {} });
    const ids = r.bySlot.before_char.map((a) => a.entry.id);
    expect(ids).toEqual(["b", "a"]); // sorted by insertion order
    expect(r.bySlot.at_depth.map((a) => a.entry.id)).toEqual(["c"]);
  });

  it("respects scan depth", () => {
    const b = book();
    b.scanDepth = 1;
    const r = activateLore({ books: [b], messages: msgs("basement", "archive", "hello"), speakerId: "mira", state: {} });
    expect(r.bySlot.at_depth).toHaveLength(0);
    expect(r.bySlot.before_char.map((a) => a.entry.id)).toEqual(["b"]);
  });

  it("honours per-companion character filters", () => {
    const m = msgs("a secret");
    expect(activateLore({ books: [book()], messages: m, speakerId: "mira", state: {} }).bySlot.before_char.some((a) => a.entry.id === "d")).toBe(false);
    expect(activateLore({ books: [book()], messages: m, speakerId: "zed", state: {} }).bySlot.before_char.some((a) => a.entry.id === "d")).toBe(true);
  });

  it("recurses through activated content", () => {
    const b = emptyLorebook();
    b.recursive = true;
    b.entries = [
      emptyLoreEntry({ id: "x", keys: ["tower"], content: "The tower holds the crystal." }),
      emptyLoreEntry({ id: "y", keys: ["crystal"], content: "The crystal hums." }),
    ];
    const r = activateLore({ books: [b], messages: msgs("look, a tower"), speakerId: "m", state: {} });
    expect(r.bySlot.before_char.map((a) => [a.entry.id, a.reason])).toEqual([["x", "keyword"], ["y", "recursive"]]);
  });

  it("enforces token budget by priority", () => {
    const b = emptyLorebook();
    b.tokenBudget = 10;
    b.entries = [
      emptyLoreEntry({ id: "lo", keys: ["k"], priority: 1, content: "x".repeat(36) }),
      emptyLoreEntry({ id: "hi", keys: ["k"], priority: 9, content: "y".repeat(36) }),
    ];
    const r = activateLore({ books: [b], messages: msgs("k"), speakerId: "m", state: {} });
    expect(r.bySlot.before_char.map((a) => a.entry.id)).toEqual(["hi"]);
  });

  it("applies probability with a seeded RNG", () => {
    const b = emptyLorebook();
    b.entries = [emptyLoreEntry({ keys: ["k"], probability: 50 })];
    let hits = 0;
    const r = rng(7);
    for (let i = 0; i < 200; i++) hits += activateLore({ books: [b], messages: msgs("k"), speakerId: "m", state: {}, random: r }).bySlot.before_char.length;
    expect(hits).toBeGreaterThan(70);
    expect(hits).toBeLessThan(130);
  });

  it("runs sticky then cooldown timers", () => {
    const b = emptyLorebook();
    b.entries = [emptyLoreEntry({ id: "s", keys: ["spark"], sticky: 2, cooldown: 2 })];
    let state: LoreState = {};
    const step = (text: string) => {
      const r = activateLore({ books: [b], messages: msgs(text), speakerId: "m", state });
      state = r.nextState;
      return r.bySlot.before_char.length;
    };
    expect(step("spark")).toBe(1); // triggers, sticky=2
    expect(step("nothing")).toBe(1); // sticky 2→1
    expect(step("nothing")).toBe(1); // sticky 1→0, cooldown starts
    expect(step("spark")).toBe(0); // cooling down
    expect(step("spark")).toBe(0);
    expect(step("spark")).toBe(1); // available again
  });
});

describe("lorebook conversion", () => {
  it("imports SillyTavern World Info JSON", () => {
    const wi = {
      entries: {
        "0": { uid: 0, key: ["sword"], keysecondary: [], comment: "Sword", content: "A blade.", constant: false, selective: false, order: 50, position: 1, disable: false, probability: 80, useProbability: true },
        "1": { uid: 1, key: ["shield"], content: "Round.", disable: true, position: 4, depth: 3 },
      },
    };
    const lb = parseLorebookJson(wi, "Gear");
    expect(lb.name).toBe("Gear");
    expect(lb.entries[0]).toMatchObject({ name: "Sword", position: "after_char", insertionOrder: 50, probability: 80, enabled: true });
    expect(lb.entries[1]).toMatchObject({ enabled: false, position: "at_depth", depth: 3 });
  });

  it("round-trips through character_book", () => {
    const lb = emptyLorebook("RT");
    lb.entries = [emptyLoreEntry({ name: "e", keys: ["k"], position: "after_examples", sticky: 3, characterFilter: ["c1"] })];
    const back = lorebookFromCharacterBook(lorebookToCharacterBook(lb), "x");
    expect(back.entries[0]).toMatchObject({ name: "e", keys: ["k"], position: "after_examples", sticky: 3, characterFilter: ["c1"] });
  });
});
