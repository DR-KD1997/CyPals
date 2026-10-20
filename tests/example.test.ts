import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { companionFromCard, parseCardFile } from "../src/core/cards/parse";
import { packCypal, unpackCypal } from "../src/core/format/cypal";
import { parsePerformance } from "../src/core/expressions";

describe("bundled example: Pip.charx", () => {
  const bytes = new Uint8Array(readFileSync(new URL("../examples/Pip.charx", import.meta.url)));

  it("imports as a V3 card with portraits, talking frames and lore", () => {
    const card = parseCardFile(bytes, "Pip.charx");
    expect(card.version).toBe("ccv3");
    expect(card.lorebook?.entries).toHaveLength(2);
    const { companion, assets } = companionFromCard(card, "Pip.charx");
    const av = companion.avatars[0];
    expect(av.kind).toBe("portraits");
    if (av.kind !== "portraits") return;
    expect(av.images.happy_talk).toHaveLength(1);
    // the card icon (a smile) must not be mixed into the real neutral face
    expect(av.images.neutral.map((r) => r.path)).toEqual(["assets/portraits/neutral.png"]);
    // the greeting's tags drive the avatar
    expect(parsePerformance(companion.character.firstMessage).segments[1].actions).toEqual(["wave"]);
    // and it survives a .cypal round trip with all images
    const back = unpackCypal(packCypal({ companion, lorebooks: [], assets }));
    expect(back.assets.size).toBe(assets.size);
  });
});
