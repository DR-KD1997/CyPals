import { describe, expect, it } from "vitest";
import { buildPalette, contrast, hexToHsl, hslToHex, TINT_PRESETS } from "../src/ui/theme";

describe("theme", () => {
  it("round-trips colours", () => {
    const { h, s, l } = hexToHsl("#8ed5c6");
    expect(hslToHex(h, s, l)).toBe("#8ed5c6");
  });

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: readable for every tint and strength`, () => {
      for (const { color } of [...TINT_PRESETS, { color: "#ffff00" }, { color: "#000080" }, { color: "#ffffff" }]) {
        for (const k of [0, 0.5, 1]) {
          const p = buildPalette(theme, color, k);
          expect(contrast(p["--paper"], p["--ink"]), `${theme} text ${color} ${k}`).toBeGreaterThanOrEqual(7);
          expect(contrast(p["--mist"], p["--ink"]), `${theme} secondary ${color} ${k}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["--glass"], p["--ink"]), `${theme} accent ${color} ${k}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["--on-glass"], p["--glass"]), `${theme} on-accent ${color} ${k}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p["--bubble-ink"], p["--bubble"]), `${theme} bubble ${color} ${k}`).toBeGreaterThanOrEqual(7);
        }
      }
    });
  }

  it("strength 0 gives neutral surfaces", () => {
    const { s } = hexToHsl(buildPalette("dark", "#f0a3c0", 0)["--ink"]);
    expect(s).toBeLessThan(1);
  });
});
