import { describe, expect, it } from "vitest";
import { parsePerformance, stripTagsForDisplay, inferFromText, normalizeExpression } from "../src/core/expressions";
import { buildPrompt } from "../src/core/llm/prompt";
import { createProvider, normalizeAlternation, profileFromPreset, sseEvents, splitSystem } from "../src/core/llm/providers";
import { defaultCompanion, emptyLoreEntry, emptyLorebook } from "../src/core/defaults";
import { activateLore } from "../src/core/lorebook/engine";
import { createFourthWallScheduler, fourthWallSystemBlock } from "../src/core/fourthWall";
import { decideWindow, selectWindows, DEFAULT_VISION_POLICY } from "../src/core/vision/policy";
import { fillTemplate, speakableText } from "../src/core/tts/providers";
import { rng } from "../src/core/util";
import type { ChatMessage } from "../src/core/types";

const encoder = new TextEncoder();
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(encoder.encode(ch));
      c.close();
    },
  });
}
function sseResponse(events: unknown[], split = 7): Response {
  const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += split) chunks.push(body.slice(i, i + split)); // split mid-event on purpose
  return new Response(streamOf(chunks), { headers: { "content-type": "text/event-stream" } });
}

describe("performance tags", () => {
  it("splits a reply into expression segments with actions", () => {
    const p = parsePerformance("<expr:happy> Oh, you're back! <act:wave> I missed you. <expr:sad> ...kind of.");
    expect(p.usedTags).toBe(true);
    expect(p.segments.map((s) => [s.expression, s.actions, s.text])).toEqual([
      ["happy", [], "Oh, you're back!"],
      ["happy", ["wave"], "I missed you."],
      ["sad", [], "...kind of."],
    ]);
    expect(p.text).toBe("Oh, you're back! I missed you. ...kind of.");
    expect(p.finalExpression).toBe("sad");
  });

  it("accepts bracket tags and aliases", () => {
    const p = parsePerformance("[expression: blushing] W-what? [action: shrug]");
    expect(p.segments[0].expression).toBe("embarrassed");
    expect(p.actions).toEqual(["shrug"]);
  });

  it("keeps current expression for unknown names", () => {
    expect(parsePerformance("<expr:zxcv> hi", "smug").finalExpression).toBe("smug");
  });

  it("infers from narration when no tags", () => {
    const p = parsePerformance("*waves and smiles brightly* Hey there!");
    expect(p.usedTags).toBe(false);
    expect(p.finalExpression).toBe("happy");
    expect(p.actions).toEqual(["wave"]);
    expect(inferFromText("*blushes* um").expression).toBe("embarrassed");
    expect(inferFromText("haha that's great").expression).toBe("joy");
  });

  it("hides partial tags while streaming", () => {
    expect(stripTagsForDisplay("<expr:happy> Hello <ex")).toBe(" Hello ");
    expect(stripTagsForDisplay("Hi <act:wa")).toBe("Hi ");
    expect(stripTagsForDisplay("a < b")).toBe("a < b");
  });

  it("normalises expression names", () => {
    expect(normalizeExpression("Smirking")).toBe("smug");
    expect(normalizeExpression("nonsense")).toBeNull();
  });
});

describe("prompt builder", () => {
  const mira = defaultCompanion("Mira");
  mira.id = "mira";
  mira.character.description = "{{char}} is an android librarian who likes {{user}}.";
  mira.character.personality = "curious";
  mira.character.exampleDialogue = "<START>\n{{user}}: hi\n{{char}}: hello!";
  mira.character.postHistoryInstructions = "Stay as {{char}}.";
  mira.character.firstMessage = "Welcome, {{user}}!";
  const zed = defaultCompanion("Zed");
  zed.id = "zed";
  zed.character.tagline = "A grumpy cyber-cat.";

  const hist = (): ChatMessage[] => [
    { id: "1", role: "user", name: "Kaan", text: "Hello Mira", createdAt: "" },
    { id: "2", role: "companion", speakerId: "mira", name: "Mira", text: "Hi!", createdAt: "" },
    { id: "3", role: "companion", speakerId: "zed", name: "Zed", text: "Hmph.", createdAt: "" },
    { id: "4", role: "user", name: "Kaan", text: "Tell me about the archive", createdAt: "" },
  ];

  it("substitutes macros and orders blocks", () => {
    const lb = emptyLorebook();
    lb.entries = [
      emptyLoreEntry({ keys: ["archive"], content: "ARCHIVE_LORE", position: "after_char" }),
      emptyLoreEntry({ constant: true, content: "DEPTH_LORE", position: "at_depth", depth: 1 }),
    ];
    const lore = activateLore({ books: [lb], messages: hist(), speakerId: "mira", state: {} });
    const p = buildPrompt({
      speaker: mira, others: [zed], user: { name: "Kaan", description: "A developer." }, history: hist(), lore,
      performance: true, contextTokens: 8000, replyTokens: 300,
    });
    const sys = p.messages[0].content;
    expect(sys).toContain("Mira is an android librarian who likes Kaan.");
    expect(sys.indexOf("android librarian")).toBeLessThan(sys.indexOf("ARCHIVE_LORE"));
    expect(sys).toContain("Zed: A grumpy cyber-cat.");
    expect(sys).toContain("<expr:");
    expect(sys).toContain("Kaan: hi\nMira: hello!");
    // Own lines are assistant; other companion's are user with name prefix.
    expect(p.messages).toContainEqual({ role: "assistant", content: "Hi!" });
    expect(p.messages).toContainEqual({ role: "user", content: "Zed: Hmph." });
    // depth 1 lore sits right before the last message.
    const idx = p.messages.findIndex((m) => m.content === "DEPTH_LORE");
    expect(p.messages[idx + 1].content).toBe("Kaan: Tell me about the archive");
    expect(p.messages[p.messages.length - 1].content).toBe("Stay as Mira.");
  });

  it("trims oldest history to fit the context window", () => {
    const long: ChatMessage[] = Array.from({ length: 200 }, (_, i) => ({
      id: String(i), role: "user", name: "Kaan", text: `message ${i} ${"x".repeat(200)}`, createdAt: "",
    }));
    const p = buildPrompt({ speaker: mira, others: [], user: { name: "Kaan", description: "" }, history: long, lore: null, performance: false, contextTokens: 2000, replyTokens: 300 });
    expect(p.historyIncluded).toBeLessThan(200);
    expect(p.historyIncluded).toBeGreaterThan(5);
    expect(p.messages[p.messages.length - 2].content).toContain("message 199");
  });

  it("uses the greeting in a fresh chat", () => {
    const p = buildPrompt({ speaker: mira, others: [], user: { name: "Kaan", description: "" }, history: [], lore: null, performance: false, contextTokens: 4000, replyTokens: 200 });
    expect(p.messages.some((m) => m.content === "Welcome, Kaan!")).toBe(true);
  });

  it("adds fourth-wall context and nudge only when enabled", () => {
    const fw = { ...mira, behaviour: { ...mira.behaviour, fourthWallAware: true } };
    const ctx = { os: "Linux", formFactor: "desktop" as const, presentation: "overlay" as const, localTime: "23:40", others: ["Zed"] };
    const p = buildPrompt({ speaker: fw, others: [], user: { name: "Kaan", description: "" }, history: hist(), lore: null, performance: false, contextTokens: 8000, replyTokens: 200, fourthWall: { ctx, nudge: true, random: rng(1) } });
    expect(p.messages[0].content).toContain("[Fourth Wall Awareness: ON]");
    expect(p.messages[0].content).toContain("Linux desktop");
    expect(p.messages[p.messages.length - 1].content).toMatch(/For this reply only/);
    const off = buildPrompt({ speaker: mira, others: [], user: { name: "Kaan", description: "" }, history: hist(), lore: null, performance: false, contextTokens: 8000, replyTokens: 200 });
    expect(off.messages[0].content).not.toContain("Fourth Wall");
  });

  it("attaches consented images to the newest user turn", () => {
    const p = buildPrompt({ speaker: mira, others: [], user: { name: "Kaan", description: "" }, history: hist(), lore: null, performance: false, contextTokens: 8000, replyTokens: 200, images: [{ mime: "image/png", data: "AAA", label: "Screen: Krita" }] });
    const withImg = p.messages.find((m) => m.images?.length);
    expect(withImg?.content).toContain("Screen: Krita");
  });
});

describe("fourth wall", () => {
  it("keeps the character's identity in the system block", () => {
    const c = defaultCompanion("Mira");
    const s = fourthWallSystemBlock(c, { os: "Android", formFactor: "mobile", presentation: "call", localTime: "", others: [] }, "Kaan");
    expect(s).toContain("You remain Mira completely");
    expect(s).toContain("Android phone");
    expect(s).toMatch(/never claim to be human/i);
  });

  it("schedules remarks with frequency and minimum gap", () => {
    const c = defaultCompanion("Mira");
    c.behaviour.fourthWallAware = true;
    c.behaviour.fourthWallFrequency = 1;
    const s = createFourthWallScheduler(rng(3), 4);
    const nudges = Array.from({ length: 12 }, (_, t) => s.shouldNudge(c, t));
    expect(nudges.filter(Boolean).length).toBe(3); // turns 0, 4, 8
    c.behaviour.fourthWallAware = false;
    expect(s.shouldNudge(c, 100)).toBe(false);
  });
});

describe("providers", () => {
  it("parses SSE split across chunks", async () => {
    const out: string[] = [];
    for await (const d of sseEvents(streamOf(["data: a\n", "\ndata: b", "\r\n\r\ndata: [DONE]\n\n"]))) out.push(d);
    expect(out).toEqual(["a", "b", "[DONE]"]);
  });

  it("merges same-role turns and avoids a leading assistant turn", () => {
    const n = normalizeAlternation([
      { role: "assistant", content: "hi" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(n.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(n[2].content).toBe("a\n\nb");
  });

  it("keeps mid-history system notes in place", () => {
    const { system, rest } = splitSystem([
      { role: "system", content: "S" },
      { role: "user", content: "u" },
      { role: "system", content: "lore" },
    ]);
    expect(system).toBe("S");
    expect(rest[1]).toEqual({ role: "user", content: "[System note: lore]" });
  });

  it("streams an OpenAI-compatible reply (OpenRouter preset)", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return sseResponse([
        { choices: [{ delta: { content: "<expr:happy> Hel" } }] },
        { choices: [{ delta: { content: "lo!" }, finish_reason: "stop" }] },
        "[DONE]",
      ]);
    };
    const profile = profileFromPreset("openrouter", { apiKey: "sk-or-test", model: "x/y" });
    const deltas: string[] = [];
    const res = await createProvider(profile, fetchImpl).generate({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "hi", images: [{ mime: "image/png", data: "QQ==" }] }],
      sampling: profile.sampling,
      onDelta: (d) => deltas.push(d),
    });
    expect(res.text).toBe("<expr:happy> Hello!");
    expect(deltas.join("")).toBe(res.text);
    expect(captured!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = captured!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
    expect(headers["X-Title"]).toBe("CyPals");
    const body = JSON.parse(String(captured!.init!.body));
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,QQ==");
  });

  it("targets the xAI endpoint for Grok", async () => {
    let url = "";
    const p = profileFromPreset("grok", { apiKey: "k" });
    await createProvider(p, async (u) => {
      url = u;
      return sseResponse(["[DONE]"]);
    }).generate({ messages: [{ role: "user", content: "x" }], sampling: p.sampling });
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("streams Gemini and maps roles / system instruction", async () => {
    let body: any;
    let url = "";
    let headers: Record<string, string> = {};
    const p = profileFromPreset("gemini", { apiKey: "g-key" });
    const res = await createProvider(p, async (u, init) => {
      url = u;
      body = JSON.parse(String(init!.body));
      headers = init!.headers as Record<string, string>;
      return sseResponse([
        { candidates: [{ content: { parts: [{ text: "Hi " }] } }] },
        { candidates: [{ content: { parts: [{ text: "there" }] }, finishReason: "STOP" }] },
      ]);
    }).generate({
      messages: [{ role: "system", content: "SYS" }, { role: "assistant", content: "greet" }, { role: "user", content: "yo" }],
      sampling: p.sampling,
    });
    expect(res.text).toBe("Hi there");
    expect(url).toContain(":streamGenerateContent?alt=sse");
    expect(headers["x-goog-api-key"]).toBe("g-key");
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.contents.map((c: any) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("streams Anthropic", async () => {
    const p = profileFromPreset("anthropic", { apiKey: "a" });
    const res = await createProvider(p, async () =>
      sseResponse([
        { type: "content_block_delta", delta: { type: "text_delta", text: "Yo" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ]),
    ).generate({ messages: [{ role: "user", content: "x" }], sampling: p.sampling });
    expect(res).toMatchObject({ text: "Yo", finishReason: "end_turn" });
  });

  it("surfaces API errors with the server message", async () => {
    const p = profileFromPreset("openai", { apiKey: "bad" });
    await expect(
      createProvider(p, async () => new Response(JSON.stringify({ error: { message: "Invalid key" } }), { status: 401 })).generate({
        messages: [{ role: "user", content: "x" }], sampling: p.sampling,
      }),
    ).rejects.toThrow(/401.*Invalid key/);
  });
});

describe("vision policy", () => {
  const screen = { ...DEFAULT_VISION_POLICY.screen, enabled: true, apps: ["krita", "code"] };
  const w = (app: string, title: string, focused = false) => ({ id: 1, app, title, focused, minimized: false });

  it("is off by default", () => {
    expect(decideWindow(w("krita", "x"), DEFAULT_VISION_POLICY.screen)).toEqual({ allowed: false, reason: "Screen sharing is off" });
  });

  it("enforces allow-list, block-list and protected apps", () => {
    expect(decideWindow(w("Krita", "art.kra"), screen).allowed).toBe(true);
    expect(decideWindow(w("firefox", "news"), screen).allowed).toBe(false);
    expect(decideWindow(w("firefox", "news"), { ...screen, mode: "blocklist", apps: ["discord"] }).allowed).toBe(true);
    expect(decideWindow(w("KeePassXC", "db"), { ...screen, mode: "blocklist", apps: [] }).allowed).toBe(false);
    expect(decideWindow(w("code", "Online Banking - Code"), screen).allowed).toBe(false);
    expect(decideWindow(w("CyPals", "CyPals"), { ...screen, mode: "blocklist" }).allowed).toBe(false);
  });

  it("selects only the focused allowed window by default", () => {
    const sel = selectWindows([w("krita", "a"), { ...w("code", "b", true), id: 2 }, { ...w("firefox", "c", true), id: 3 }], screen);
    expect(sel.map((x) => x.id)).toEqual([2]);
  });
});

describe("tts helpers", () => {
  it("strips narration for speech", () => {
    expect(speakableText("*smiles* Hello (softly) there!")).toBe("Hello there!");
  });
  it("escapes template values", () => {
    expect(fillTemplate('{"t":"{text}"}', { text: 'say "hi"' }, (s) => JSON.stringify(s).slice(1, -1))).toBe('{"t":"say \\"hi\\""}');
    expect(fillTemplate("/tts?t={text}", { text: "a b&c" }, encodeURIComponent)).toBe("/tts?t=a%20b%26c");
  });
});
