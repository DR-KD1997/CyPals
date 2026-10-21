import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  companionFromCard,
  companionToCardV3,
  exportPngCard,
  parseCardFile,
  parseCardJson,
  parsePngCard,
} from "../src/core/cards/parse";
import { BLANK_PNG, readTextChunks, writeTextChunks } from "../src/core/cards/png";
import { bytesToBase64, utf8Encode } from "../src/core/util";

const v1 = {
  name: "Mira",
  description: "A cheerful android librarian.",
  personality: "curious, warm",
  scenario: "{{user}} visits the library after hours.",
  first_mes: "Oh! Hello, {{user}}.",
  mes_example: "<START>\n{{user}}: Hi\n{{char}}: Hello!",
};

const v2 = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    ...v1,
    creator_notes: "Made for testing.\nSecond line.",
    system_prompt: "You are {{char}}.",
    post_history_instructions: "Stay in character.",
    alternate_greetings: ["Welcome back!"],
    tags: ["android", "library"],
    creator: "kaan",
    character_version: "2",
    extensions: { depth_prompt: { prompt: "x", depth: 4 } },
    custom_field: 42,
    character_book: {
      name: "Library lore",
      scan_depth: 3,
      token_budget: 500,
      recursive_scanning: true,
      extensions: {},
      entries: [
        { keys: ["archive"], content: "The archive is in the basement.", enabled: true, insertion_order: 10, extensions: {} },
        { keys: ["Mira"], content: "Mira was built in 2091.", enabled: true, insertion_order: 5, constant: true, extensions: { position: 4, depth: 2 } },
      ],
    },
  },
};

const v3 = {
  spec: "chara_card_v3",
  spec_version: "3.0",
  data: { ...v2.data, nickname: "Mi", group_only_greetings: [], assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }] },
};

describe("card parsing", () => {
  it("parses V1 JSON", () => {
    const c = parseCardJson(v1);
    expect(c.version).toBe("ccv1");
    expect(c.character.name).toBe("Mira");
    expect(c.character.firstMessage).toBe("Oh! Hello, {{user}}.");
    expect(c.lorebook).toBeNull();
  });

  it("parses V2 JSON with lorebook and preserves unknown fields", () => {
    const c = parseCardJson(v2);
    expect(c.version).toBe("ccv2");
    expect(c.character.alternateGreetings).toEqual(["Welcome back!"]);
    expect(c.character.tagline).toBe("Made for testing.");
    expect(c.character.extensions["cypals/unknown_fields"]).toEqual({ custom_field: 42 });
    expect(c.lorebook?.entries).toHaveLength(2);
    expect(c.lorebook?.recursive).toBe(true);
    expect(c.lorebook?.entries[1].position).toBe("at_depth");
    expect(c.lorebook?.entries[1].depth).toBe(2);
  });

  it("parses V3 JSON and keeps V3-only fields", () => {
    const c = parseCardJson(v3);
    expect(c.version).toBe("ccv3");
    expect(c.character.nickname).toBe("Mi");
    expect(c.character.extensions["ccv3/assets"]).toBeDefined();
  });

  it("accepts Pygmalion-era alias fields", () => {
    const c = parseCardJson({ char_name: "Old", char_persona: "persona", world_scenario: "w", char_greeting: "hi", example_dialogue: "ex" });
    expect(c.character).toMatchObject({ name: "Old", description: "persona", scenario: "w", firstMessage: "hi", exampleDialogue: "ex" });
  });

  it("rejects non-cards", () => {
    expect(() => parseCardJson({ foo: 1 })).toThrow();
    expect(() => parseCardJson([])).toThrow();
  });

  it("reads a V2 PNG card and prefers ccv3 when both chunks exist", () => {
    const enc = (o: unknown) => bytesToBase64(utf8Encode(JSON.stringify(o)));
    const onlyV2 = writeTextChunks(BLANK_PNG, { chara: enc(v2) });
    expect(parsePngCard(onlyV2).version).toBe("ccv2");
    const both = writeTextChunks(BLANK_PNG, { chara: enc(v2), ccv3: enc(v3) });
    const parsed = parsePngCard(both);
    expect(parsed.version).toBe("ccv3");
    expect(parsed.images[0].role).toBe("icon");
  });

  it("handles non-ASCII text in cards", () => {
    const card = { ...v2, data: { ...v2.data, name: "ミラ", description: "Ñandú ✨" } };
    const png = writeTextChunks(BLANK_PNG, { chara: bytesToBase64(utf8Encode(JSON.stringify(card))) });
    expect(parsePngCard(png).character.name).toBe("ミラ");
    expect(parsePngCard(png).character.description).toBe("Ñandú ✨");
  });

  it("parses CHARX archives with emotion assets", () => {
    const card = {
      ...v3,
      data: {
        ...v3.data,
        assets: [
          { type: "icon", uri: "embeded://assets/icon/main.png", name: "main", ext: "png" },
          { type: "emotion", uri: "embeded://assets/emotion/happy.png", name: "happy", ext: "png" },
          { type: "emotion", uri: "embeded://assets/emotion/sadness.png", name: "sadness", ext: "png" },
          { type: "emotion", uri: "embeded://assets/emotion/sad.png", name: "sad", ext: "png" },
        ],
      },
    };
    const zip = zipSync({
      "card.json": strToU8(JSON.stringify(card)),
      "assets/icon/main.png": BLANK_PNG,
      "assets/emotion/happy.png": BLANK_PNG,
      "assets/emotion/sadness.png": BLANK_PNG,
      "assets/emotion/sad.png": BLANK_PNG,
    });
    const parsed = parseCardFile(zip, "mira.charx");
    expect(parsed.images.map((i) => i.role).sort()).toEqual(["emotion", "emotion", "emotion", "icon"]);
    const { companion, assets } = companionFromCard(parsed);
    const av = companion.avatars[0];
    expect(av.kind).toBe("portraits");
    if (av.kind === "portraits") {
      // Names are kept as the card gives them: "sadness" isn't renamed to "sad".
      expect(Object.keys(av.images).sort()).toEqual(["happy", "neutral", "sad", "sadness"]);
      expect(Object.values(av.images).every((refs) => refs.length === 1)).toBe(true);
      expect(av.fallback).toBe("neutral");
    }
    expect(assets.size).toBe(4);
  });

  it("round-trips through PNG export (V2 + V3 chunks)", () => {
    const parsed = parseCardJson(v2);
    const { companion } = companionFromCard(parsed);
    companion.behaviour.fourthWallAware = true;
    const png = exportPngCard(companion, parsed.lorebook);
    const chunks = readTextChunks(png);
    expect(chunks.has("chara")).toBe(true);
    expect(chunks.has("ccv3")).toBe(true);
    const back = parsePngCard(png);
    expect(back.version).toBe("ccv3");
    expect(back.character.name).toBe("Mira");
    expect(back.character.extensions["cypals/unknown_fields"]).toEqual({ custom_field: 42 });
    expect(back.lorebook?.entries).toHaveLength(2);
    expect(back.lorebook?.entries[1].position).toBe("at_depth");
    expect((back.character.extensions.cypals as { behaviour: { fourthWallAware: boolean } }).behaviour.fourthWallAware).toBe(true);
  });

  it("V3 export has spec fields", () => {
    const { companion } = companionFromCard(parseCardJson(v1));
    const out = companionToCardV3(companion, null) as { spec: string; data: Record<string, unknown> };
    expect(out.spec).toBe("chara_card_v3");
    expect(out.data.first_mes).toBe(v1.first_mes);
  });
});
