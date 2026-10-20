import { describe, expect, it } from "vitest";
import { stripAsterisks, stripAsterisksPartial, splitChatBubbles } from "../src/core/text";
import { buildPrompt } from "../src/core/llm/prompt";
import { defaultCompanion, emptyLoreEntry, emptyLorebook } from "../src/core/defaults";
import { activateLore } from "../src/core/lorebook/engine";
import { closeConversation, familiarityText, newPersona, newRelationship, personaForCompanions, sessionPersona, touchRelationship } from "../src/core/personas";
import { ConversationOrchestrator } from "../src/core/conversation/orchestrator";
import { profileFromPreset } from "../src/core/llm/providers";
import type { GenerateRequest, LLMProvider } from "../src/core/llm/types";
import type { ChatMessage, Companion, InteractionMode } from "../src/core/types";
import { encodeWav, resample, rms } from "../src/core/audio/wav";
import { TurnDetector } from "../src/core/audio/turnDetector";
import { cleanTranscript, transcribe, STT_PRESETS } from "../src/core/stt/providers";
import { rng } from "../src/core/util";

describe("asterisk stripping", () => {
  it("removes narration and tidies punctuation", () => {
    expect(stripAsterisks("*smiles warmly* Hi there! *waves*")).toBe("Hi there!");
    expect(stripAsterisks("Well, *she pauses* I suppose so.")).toBe("Well, I suppose so.");
    expect(stripAsterisks("**leans in** Listen.")).toBe("Listen.");
    expect(stripAsterisks("No narration here.")).toBe("No narration here.");
    expect(stripAsterisks("*a\nmultiline action* Okay")).toBe("Okay");
    expect(stripAsterisks("*only an action*")).toBe("");
  });
  it("hides an unclosed action while streaming", () => {
    expect(stripAsterisksPartial("Hello *she gri")).toBe("Hello");
    expect(stripAsterisksPartial("Hello *grins* there")).toBe("Hello there");
  });
  it("keeps paragraph breaks but not expression changes as separate bubbles", async () => {
    const { parsePerformance } = await import("../src/core/expressions");
    const p = parsePerformance("<expr:surprised> Ooh! <act:wave> <expr:happy> I added a word.\n\n<expr:joy> Wanna hear it?");
    expect(p.text).toBe("Ooh! I added a word.\n\nWanna hear it?");
    expect(splitChatBubbles(p.text)).toEqual(["Ooh! I added a word.", "Wanna hear it?"]);
    expect(parsePerformance("First para.\n\nSecond para.").text).toBe("First para.\n\nSecond para.");
  });
  it("splits chat bubbles on blank lines", () => {
    expect(splitChatBubbles("hey!\n\nwhat's up?\n  \nlol")).toEqual(["hey!", "what's up?", "lol"]);
  });
});

describe("prompt modes", () => {
  const c = defaultCompanion("Mira");
  c.id = "mira";
  c.character.description = "{{char}} is a librarian. *She adjusts her glasses.*";
  c.character.scenario = "*The library is quiet.* {{user}} arrives.";
  c.character.firstMessage = "*looks up* Oh, hello {{user}}!";
  c.character.exampleDialogue = "<START>\n{{char}}: *nods* Indeed.";
  c.character.systemPrompt = "Write three paragraphs of *vivid* prose.";
  const hist: ChatMessage[] = [{ id: "1", role: "companion", speakerId: "mira", name: "Mira", text: "*waves* Hi!", createdAt: "" }, { id: "2", role: "user", name: "Kaan", text: "hey", createdAt: "" }];
  const build = (mode: InteractionMode, extra = {}) =>
    buildPrompt({ speaker: c, others: [], user: { name: "Kaan", description: "A *mysterious* developer." }, history: hist, lore: null, performance: false, contextTokens: 8000, replyTokens: 300, mode, ...extra });

  it("roleplay keeps asterisk text and the card's system prompt in charge", () => {
    const p = build("roleplay");
    expect(p.messages[0].content.startsWith("Write three paragraphs")).toBe(true);
    expect(p.messages[0].content).toContain("*She adjusts her glasses.*");
    expect(p.messages.some((m) => m.content === "*waves* Hi!")).toBe(true);
  });

  it("chat drops asterisk text from every card field and history, and frames texting", () => {
    const p = build("chat");
    const all = p.messages.map((m) => m.content).join("\n");
    expect(p.messages[0].content.startsWith("You are Mira, texting with Kaan")).toBe(true);
    expect(all).not.toMatch(/adjusts her glasses|library is quiet|\*nods\*|\*waves\*|\*vivid\*/);
    expect(all).toContain("Mira is a librarian.");
    expect(all).toContain("Notes from Mira's creator");
    expect(p.messages.some((m) => m.role === "assistant" && m.content === "Hi!")).toBe(true);
    // the user's own persona text is left alone
    expect(all).toContain("A *mysterious* developer.");
    expect(p.messages.at(-1)!.content).toMatch(/text message/);
  });

  it("call frames a spoken conversation", () => {
    const p = build("call");
    expect(p.messages[0].content).toContain("live voice call");
    expect(p.messages.at(-1)!.content).toMatch(/spoken words/);
  });

  it("strips asterisks from lore in chat mode", () => {
    const lb = emptyLorebook();
    lb.entries = [emptyLoreEntry({ constant: true, content: "*Dust drifts.* The archive is old." })];
    const lore = activateLore({ books: [lb], messages: [], speakerId: "mira", state: {} });
    const p = build("chat", { lore });
    expect(p.messages[0].content).toContain("The archive is old.");
    expect(p.messages[0].content).not.toContain("Dust drifts");
  });

  it("greeting prompts use familiarity and skip the card greeting", () => {
    const p = buildPrompt({
      speaker: c, others: [], user: { name: "Kaan", description: "" }, history: [], lore: null, performance: false,
      contextTokens: 8000, replyTokens: 300, mode: "chat", autonomous: { addressee: "Kaan", kind: "greeting" },
      familiarity: "You know each other well: 4 earlier conversations.",
    });
    const all = p.messages.map((m) => m.content).join("\n");
    expect(all).toContain("starting a new text conversation with Kaan");
    expect(all).toContain("You know each other well");
    expect(all).not.toContain("Oh, hello");
  });
});

describe("personas & familiarity", () => {
  const a = newPersona("Kaan", "A developer");
  const b = newPersona("Captain Vale", "A starship captain");
  const settings = { personas: [a, b], defaultPersonaId: a.id };
  const mk = (pref: string | null): Companion => ({ ...defaultCompanion("X"), preferredPersonaId: pref });

  it("uses a companion's preferred persona, else the default", () => {
    expect(personaForCompanions(settings, [mk(null)]).id).toBe(a.id);
    expect(personaForCompanions(settings, [mk(null), mk(b.id)]).id).toBe(b.id);
    expect(personaForCompanions(settings, [mk("deleted")]).id).toBe(a.id);
  });

  it("a chat's chosen persona wins, falling back when deleted", () => {
    const session = ConversationOrchestrator.newSession();
    expect(sessionPersona(settings, { ...session, personaId: b.id }, [mk(null)]).id).toBe(b.id);
    expect(sessionPersona(settings, { ...session, personaId: "gone" }, [mk(null)]).id).toBe(a.id);
  });

  it("describes familiarity from first meeting to close", () => {
    expect(familiarityText(undefined, "Kaan")).toMatch(/first time/);
    let r = newRelationship("c", a.id);
    for (let i = 0; i < 120; i++) r = touchRelationship(r);
    r = closeConversation(r, [{ name: "Kaan", text: "See you tomorrow!" }]);
    const t = familiarityText(r, "Kaan", new Date(Date.now() + 3 * 86400000));
    expect(t).toMatch(/know each other well/);
    expect(t).toMatch(/1 earlier conversation\b/);
    expect(t).toMatch(/3 days ago/);
    expect(t).toContain("See you tomorrow!");
  });
});

function fakeProvider(reply: (req: GenerateRequest) => string, prompts: GenerateRequest[]): LLMProvider {
  const profile = profileFromPreset("ollama");
  return {
    profile,
    async listModels() {
      return [];
    },
    async generate(req) {
      prompts.push(req);
      const text = reply(req);
      req.onDelta?.(text);
      return { text, finishReason: "stop" };
    },
  };
}

function orchestrator(mode: InteractionMode, reply: (req: GenerateRequest) => string, companion?: Partial<Companion["behaviour"]>) {
  const c = defaultCompanion("Mira");
  c.id = "m";
  c.character.firstMessage = "*looks up from a book* Oh! Hi {{user}}.";
  Object.assign(c.behaviour, companion);
  const prompts: GenerateRequest[] = [];
  const session = { ...ConversationOrchestrator.newSession(), mode };
  const orch = new ConversationOrchestrator(session, {
    getCompanion: () => c,
    lorebooks: () => new Map(),
    providerFor: () => {
      const p = fakeProvider(reply, prompts);
      return { provider: p, profile: p.profile };
    },
    user: () => ({ name: "Kaan", description: "" }),
    device: () => ({ os: "Linux", formFactor: "desktop", presentation: "call", localTime: "", others: [] }),
    familiarity: () => "You've talked twice before.",
    random: rng(1),
    sleep: async () => {},
  });
  return { orch, prompts, session };
}

describe("orchestrator modes", () => {
  it("roleplay greets with the card's first message, narration intact", async () => {
    const { orch, prompts, session } = orchestrator("roleplay", () => "x");
    await orch.addCompanion("m");
    expect(session.messages[0].text).toBe("*looks up from a book* Oh! Hi Kaan.");
    expect(prompts).toHaveLength(0);
  });

  it("chat writes its own greeting from familiarity", async () => {
    const { orch, prompts, session } = orchestrator("chat", () => "<expr:joy> heyyy kaan!! *bounces*\n\nlong time no see");
    await orch.addCompanion("m");
    expect(prompts).toHaveLength(1);
    expect(prompts[0].messages.map((m) => m.content).join("\n")).toContain("You've talked twice before.");
    expect(session.messages[0]).toMatchObject({ text: "heyyy kaan!!\n\nlong time no see", expression: "joy", autonomous: false });
  });

  it("chat with spontaneous greetings off uses the card greeting minus narration", async () => {
    const { orch, prompts, session } = orchestrator("chat", () => "x", { spontaneousGreeting: false });
    await orch.addCompanion("m");
    expect(prompts).toHaveLength(0);
    expect(session.messages[0].text).toBe("Oh! Hi Kaan.");
  });

  it("call replies drop narration but keep the expression it implied", async () => {
    const { orch, session } = orchestrator("call", () => "*smiles brightly* That sounds great.", { spontaneousGreeting: false });
    await orch.addCompanion("m", false);
    await orch.sendUserMessage("I got the job");
    expect(session.messages.at(-1)).toMatchObject({ text: "That sounds great.", expression: "happy" });
  });

  it("records voice notes on the user's message", async () => {
    const { orch, session, prompts } = orchestrator("chat", () => "nice");
    await orch.addCompanion("m", false);
    await orch.sendUserMessage("on my way", { voiceSeconds: 7.4 });
    expect(session.messages[0].attachments).toEqual([{ kind: "voice", description: "Voice note (0:07)" }]);
    expect(prompts[0].messages.some((m) => m.content === "[voice note] on my way")).toBe(true);
  });

  it("reports narration-only replies clearly in plain modes", async () => {
    const { orch } = orchestrator("chat", () => "*nods silently*", { spontaneousGreeting: false });
    const errors: string[] = [];
    orch.on((e) => e.type === "turn:error" && errors.push(e.error.message));
    await orch.addCompanion("m", false);
    await orch.sendUserMessage("ok?");
    expect(errors[0]).toMatch(/only narration/);
  });
});

describe("audio", () => {
  it("encodes a valid 16-bit mono WAV", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });

  it("resamples 48 kHz to 16 kHz", () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(rms(new Float32Array([1, -1]))).toBe(1);
  });

  it("ends a turn only after speech followed by at least 3 s of silence", () => {
    const d = new TurnDetector({ silenceMs: 1000 }); // clamped up to 3000
    const feed = (level: number, ms: number) => {
      const events: string[] = [];
      for (let t = 0; t < ms; t += 20) {
        const e = d.push(level, 20);
        if (e) events.push(e);
      }
      return events;
    };
    expect(feed(0.002, 5000)).toEqual([]); // silence alone never ends a turn
    expect(feed(0.2, 100)).toEqual([]); // a blip is too short
    expect(feed(0.002, 4000)).toEqual([]);
    expect(feed(0.2, 800)).toEqual(["speech-start"]);
    expect(feed(0.002, 2500)).toEqual([]); // pause shorter than 3 s
    expect(d.inTurn).toBe(true);
    expect(feed(0.2, 600)).toEqual([]); // keeps talking: same turn
    expect(feed(0.002, 2980)).toEqual([]);
    expect(feed(0.002, 40)).toEqual(["turn-end"]);
    expect(d.inTurn).toBe(false);
  });

  it("adapts to background noise", () => {
    const d = new TurnDetector();
    for (let i = 0; i < 1000; i++) d.push(0.03, 20); // 20 s of steady fan noise
    expect(d.threshold).toBeGreaterThan(0.06);
    expect(d.push(0.04, 20)).toBeNull();
  });
});

describe("speech-to-text", () => {
  const wav = encodeWav(new Float32Array(160), 16000);
  it("posts multipart audio to OpenAI-compatible servers", async () => {
    let url = "";
    let body: FormData | null = null;
    let headers: Record<string, string> = {};
    const text = await transcribe({ ...STT_PRESETS[2], apiKey: "gsk" }, { wav, hint: "Mira" }, async (u, init) => {
      url = u;
      body = init!.body as FormData;
      headers = init!.headers as Record<string, string>;
      return new Response(JSON.stringify({ text: " hello there " }), { headers: { "content-type": "application/json" } });
    });
    expect(text).toBe("hello there");
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(headers.Authorization).toBe("Bearer gsk");
    expect(body!.get("model")).toBe("whisper-large-v3-turbo");
    expect(body!.get("prompt")).toBe("Mira");
    expect((body!.get("file") as File).type).toBe("audio/wav");
  });

  it("asks Gemini to transcribe inline audio", async () => {
    let sent: any;
    const text = await transcribe({ ...STT_PRESETS[4], apiKey: "g" }, { wav }, async (_u, init) => {
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Good morning" }] } }] }));
    });
    expect(text).toBe("Good morning");
    expect(sent.contents[0].parts[0].inlineData.mimeType).toBe("audio/wav");
  });

  it("filters silence hallucinations", () => {
    expect(cleanTranscript("Thanks for watching!")).toBe("");
    expect(cleanTranscript("[BLANK_AUDIO]")).toBe("");
    expect(cleanTranscript("Thanks for watching my stream, Mira")).toBe("Thanks for watching my stream, Mira");
  });
});
