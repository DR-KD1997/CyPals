import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { packCypal, unpackCypal, safeAssetPath, CypalError } from "../src/core/format/cypal";
import { defaultCompanion, emptyLorebook } from "../src/core/defaults";
import { BLANK_PNG } from "../src/core/cards/png";

function sample() {
  const c = defaultCompanion("Mira");
  c.avatars.push(
    { id: "p", kind: "portraits", label: "P", images: { neutral: [{ path: "assets/portraits/n.png", mime: "image/png" }] }, fallback: "neutral", transitionMs: 150, talkingSuffix: "_talk" },
    {
      id: "m", kind: "model3d", label: "3D", model: { path: "assets/model/mira.vrm", mime: "model/vrm" }, animations: {},
      expressionMap: {}, lipSyncKeys: ["aa"], camera: { distance: 1.2, height: 1.35, fov: 30 },
    },
  );
  c.activeAvatarId = "m";
  const lb = emptyLorebook("Shared");
  c.lorebookIds.push(lb.id);
  const assets = new Map([
    ["assets/portraits/n.png", BLANK_PNG],
    ["assets/model/mira.vrm", new Uint8Array([1, 2, 3, 4])],
  ]);
  return { c, lb, assets };
}

describe(".cypal format", () => {
  it("packs and unpacks a companion with multiple avatars and lorebooks", () => {
    const { c, lb, assets } = sample();
    const bytes = packCypal({ companion: c, lorebooks: [lb], assets, card: BLANK_PNG });
    const out = unpackCypal(bytes);
    expect(out.manifest.format).toBe("cypal");
    expect(out.companion.character.name).toBe("Mira");
    expect(out.companion.avatars.map((a) => a.kind)).toEqual(["portraits", "model3d"]);
    expect(out.lorebooks[0].id).toBe(lb.id);
    expect([...out.assets.keys()].sort()).toEqual(["assets/model/mira.vrm", "assets/portraits/n.png"]);
    expect(out.card?.length).toBe(BLANK_PNG.length);
  });

  it("refuses to pack when referenced assets are missing", () => {
    const { c, lb } = sample();
    expect(() => packCypal({ companion: c, lorebooks: [lb], assets: new Map() })).toThrow(/Missing assets/);
  });

  it("rejects path traversal", () => {
    expect(() => safeAssetPath("../etc/passwd")).toThrow(CypalError);
    expect(() => safeAssetPath("/abs")).toThrow(CypalError);
    expect(() => safeAssetPath("C:/win")).toThrow(CypalError);
    expect(safeAssetPath("assets\\a.png")).toBe("assets/a.png");
  });

  it("rejects files from a newer format version", () => {
    const zip = zipSync({
      "cypal.json": strToU8(JSON.stringify({ format: "cypal", version: 99 })),
      "companion.json": strToU8("{}"),
    });
    expect(() => unpackCypal(zip)).toThrow(/newer CyPals/);
  });

  it("fills behaviour defaults when migrating", () => {
    const { c } = sample();
    const raw = JSON.parse(JSON.stringify({ ...c, behaviour: undefined, avatars: [] }));
    const zip = zipSync({
      "cypal.json": strToU8(JSON.stringify({ format: "cypal", version: 1 })),
      "companion.json": strToU8(JSON.stringify(raw)),
    });
    expect(unpackCypal(zip).companion.behaviour.fourthWallAware).toBe(false);
  });
});
