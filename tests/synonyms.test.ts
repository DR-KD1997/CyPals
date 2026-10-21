import { describe, expect, it } from "vitest";
import { canonicalExpression, editDistance, findExpressionKey, portraitKeyFromFile, portraitKeysFor, talkingKeyFor } from "../src/core/synonyms";
import { parsePerformance } from "../src/core/expressions";
import { EXPRESSIONS } from "../src/core/types";

describe("expression synonyms", () => {
  it("maps the examples from the brief", () => {
    expect(canonicalExpression("sad")).toBe("sad");
    expect(canonicalExpression("sadness")).toBe("sad");
    expect(canonicalExpression("surprise")).toBe("surprised");
    expect(canonicalExpression("surprised")).toBe("surprised");
    expect(canonicalExpression("embarassed")).toBe("embarrassed"); // common misspelling
    expect(canonicalExpression("embarassment")).toBe("embarrassed");
    expect(canonicalExpression("embarrassment")).toBe("embarrassed");
  });

  it("covers every canonical name and word forms", () => {
    for (const e of EXPRESSIONS) expect(canonicalExpression(e)).toBe(e);
    expect(canonicalExpression("happiness")).toBe("happy");
    expect(canonicalExpression("Anger")).toBe("angry");
    expect(canonicalExpression("fearful")).toBe("fear");
    expect(canonicalExpression("confusion")).toBe("confused");
    expect(canonicalExpression("Disgusted")).toBe("disgust");
    expect(canonicalExpression("sleepiness")).toBe("sleepy");
    expect(canonicalExpression("joyfulness")).toBe("joy");
    expect(canonicalExpression("very happy")).toBe("happy");
  });

  it("maps all 28 SillyTavern / GoEmotions labels", () => {
    const labels = ["admiration", "amusement", "anger", "annoyance", "approval", "caring", "confusion", "curiosity", "desire",
      "disappointment", "disapproval", "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", "joy", "love",
      "nervousness", "optimism", "pride", "realization", "relief", "remorse", "sadness", "surprise", "neutral"];
    for (const l of labels) expect(canonicalExpression(l), l).not.toBeNull();
  });

  it("handles file names and Live2D / VRoid prefixes", () => {
    expect(canonicalExpression("Sadness.png")).toBe("sad");
    expect(canonicalExpression("f_Embarrassment.exp3.json")).toBe("embarrassed");
    expect(canonicalExpression("Fcl_ALL_Surprised")).toBe("surprised");
  });

  it("rejects non-expressions", () => {
    for (const w of ["table", "wave", "hair", "body", "x", "", "eye_l"]) expect(canonicalExpression(w), w).toBeNull();
  });

  it("keeps portrait file names exactly as given", () => {
    expect(portraitKeyFromFile("Sadness.png")).toBe("Sadness");
    expect(portraitKeyFromFile("C:\\packs\\pip/surprise_talk.webp")).toBe("surprise_talk");
    expect(portraitKeyFromFile("happy2.png")).toBe("happy2");
    expect(portraitKeyFromFile("sadness")).toBe("sadness");
  });

  it("finds every portrait that means an expression, without talking frames", () => {
    const images = { sad: [1], Sadness: [2], sadness_talk: [3], happy: [4], empty_sad: [], wave: [5] };
    expect(portraitKeysFor(images, "sad")).toEqual(["sad", "Sadness"]);
    expect(portraitKeysFor({ sadness: [1] }, "sad")).toEqual(["sadness"]);
    expect(portraitKeysFor({ Surprise: [1] }, "surprised")).toEqual(["Surprise"]);
    expect(portraitKeysFor({ embarassment: [1] }, "embarrassed")).toEqual(["embarassment"]);
    expect(portraitKeysFor(images, "angry")).toEqual([]);
    expect(portraitKeysFor(images, "WAVE")).toEqual(["wave"]);
    expect(talkingKeyFor(images, "Sadness", "_talk")).toBe("sadness_talk");
    expect(talkingKeyFor(images, "happy", "_talk")).toBeNull();
  });

  it("finds synonym keys in a map", () => {
    expect(findExpressionKey({ sadness: 1, Surprise: 2 }, "surprised")).toBe("Surprise");
    expect(findExpressionKey({ sad: 1 }, "sad")).toBe("sad");
    expect(findExpressionKey({ table: 1 }, "sad")).toBeNull();
  });

  it("applies to model tags", () => {
    expect(parsePerformance("<expr:sadness> oh.").finalExpression).toBe("sad");
    expect(parsePerformance("<expr:embarassment> um").finalExpression).toBe("embarrassed");
  });

  it("edit distance handles transpositions", () => {
    expect(editDistance("embarassed", "embarrassed")).toBe(1);
    expect(editDistance("suprised", "surprised")).toBe(1);
    expect(editDistance("hpapy", "happy")).toBe(1);
  });
});
