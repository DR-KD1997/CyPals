/**
 * Guards against effects that implicitly return a value. React calls whatever an
 * effect returns as its cleanup; since Chrome 149 (and WebView2), scrollIntoView
 * and scrollTo return Promises, so `useEffect(() => el.scrollIntoView())` crashed
 * the screen being left. Expression-bodied effects are only allowed for calls
 * known to return an unsubscribe function.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED = /^(subscribeLive|subscribeAnyLive|watchTheme|call\.on|cleanup\b)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("effects", () => {
  it("never return a value by accident", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*([^{\s][^\n]*)/g)) {
        if (!ALLOWED.test(m[1])) bad.push(`${f}: ${m[1].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
