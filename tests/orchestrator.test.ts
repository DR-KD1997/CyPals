import { describe, expect, it } from "vitest";
import { ConversationOrchestrator, TooManyCompanionsError, cleanReply, type OrchestratorEvent } from "../src/core/conversation/orchestrator";
import { defaultCompanion } from "../src/core/defaults";
import { profileFromPreset } from "../src/core/llm/providers";
import type { GenerateRequest, LLMProvider } from "../src/core/llm/types";
import type { Companion } from "../src/core/types";
import { rng } from "../src/core/util";

function makeCompanion(id: string, name: string): Companion {
  const c = defaultCompanion(name);
  c.id = id;
  c.avatars.push({ id: `${id}-p`, kind: "portraits", label: "p", images: {}, fallback: "neutral", transitionMs: 0, talkingSuffix: "" });
  return c;
}

/** Fake LLM: replies with "<expr:happy> I am NAME (n)" and records prompts. */
function fakeProvider(name: () => string, prompts: GenerateRequest[], opts: { delayMs?: number; fail?: boolean } = {}): LLMProvider {
  const profile = profileFromPreset("ollama");
  let n = 0;
  return {
    profile,
    async listModels() {
      return [];
    },
    async generate(req) {
      prompts.push(req);
      if (opts.fail) throw new Error("boom");
      const text = `<expr:happy> I am ${name()} (${++n})`;
      for (const ch of text.match(/.{1,5}/g)!) {
        if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        req.onDelta?.(ch);
      }
      return { text, finishReason: "stop" };
    },
  };
}

function setup(ids: [string, string][], settings: Partial<ConstructorParameters<typeof ConversationOrchestrator>[2]> = {}, seed = 1) {
  const comps = new Map(ids.map(([id, name]) => [id, makeCompanion(id, name)]));
  const prompts: GenerateRequest[] = [];
  let current = "";
  const events: OrchestratorEvent[] = [];
  const session = ConversationOrchestrator.newSession();
  const orch = new ConversationOrchestrator(
    session,
    {
      getCompanion: (id) => comps.get(id),
      lorebooks: () => new Map(),
      providerFor: (c) => {
        current = c.character.name;
        const provider = fakeProvider(() => current, prompts);
        return { provider, profile: provider.profile };
      },
      user: () => ({ name: "Kaan", description: "" }),
      device: () => ({ os: "Linux", formFactor: "desktop", presentation: "call", localTime: "12:00", others: [] }),
      random: rng(seed),
      sleep: async () => {},
    },
    { autonomousDelayMs: 0, ...settings },
  );
  orch.on((e) => events.push(e));
  for (const [id] of ids) orch.addCompanion(id, false);
  return { orch, comps, prompts, events, session };
}

describe("orchestrator", () => {
  it("caps the roster at three companions", () => {
    const { orch, comps } = setup([["a", "Ann"], ["b", "Bo"], ["c", "Cy"]]);
    comps.set("d", makeCompanion("d", "Di"));
    expect(() => orch.addCompanion("d")).toThrow(TooManyCompanionsError);
    expect(() => ConversationOrchestrator.newSession(["1", "2", "3", "4"])).toThrow(TooManyCompanionsError);
  });

  it("single companion answers and expression is emitted", async () => {
    const { orch, session, events } = setup([["a", "Ann"]]);
    await orch.sendUserMessage("hello");
    expect(session.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "hello"],
      ["companion", "I am Ann (1)"],
    ]);
    expect(events.some((e) => e.type === "expression" && e.expression === "happy")).toBe(true);
    const deltas = events.filter((e) => e.type === "turn:delta").map((e) => (e as any).displayText);
    expect(deltas.every((d: string) => !d.includes("<"))).toBe(true);
  });

  it("routes to mentioned companions in mention order", async () => {
    const { orch, session } = setup([["a", "Ann"], ["b", "Bo"]], { autonomyChance: 0 });
    await orch.sendUserMessage("Bo, then Ann — what do you think?");
    expect(session.messages.slice(1).map((m) => m.name)).toEqual(["Bo", "Ann"]);
  });

  it("companions converse autonomously up to the chain limit", async () => {
    const { orch, session } = setup([["a", "Ann"], ["b", "Bo"], ["c", "Cy"]], { autonomyChance: 1, maxAutonomousChain: 3 });
    await orch.sendUserMessage("hi everyone");
    const companionTurns = session.messages.filter((m) => m.role === "companion");
    expect(companionTurns).toHaveLength(4); // 1 reply + 3 autonomous
    expect(companionTurns.slice(1).every((m) => m.autonomous)).toBe(true);
    for (let i = 1; i < companionTurns.length; i++) expect(companionTurns[i].speakerId).not.toBe(companionTurns[i - 1].speakerId);
  });

  it("respects per-companion autonomousChat opt-out", async () => {
    const { orch, session, comps } = setup([["a", "Ann"], ["b", "Bo"]], { autonomyChance: 1 });
    comps.get("b")!.behaviour.autonomousChat = false;
    await orch.sendUserMessage("Ann?");
    expect(session.messages.filter((m) => m.role === "companion")).toHaveLength(1);
  });

  it("each speaker sees others' lines as user-role with names", async () => {
    const { orch, prompts } = setup([["a", "Ann"], ["b", "Bo"]], { autonomyChance: 1, maxAutonomousChain: 1 });
    await orch.sendUserMessage("Ann, hi");
    const boPrompt = prompts[1].messages;
    expect(boPrompt.some((m) => m.role === "user" && m.content.startsWith("Ann: I am Ann"))).toBe(true);
    expect(boPrompt[boPrompt.length - 1].content).toContain("Bo is now replying to Ann");
    // stop sequences guard against writing for others
    expect(prompts[1].sampling.stop).toEqual(expect.arrayContaining(["\nKaan:", "\nAnn:"]));
  });

  it("user input interrupts an in-flight generation", async () => {
    const comps = new Map([["a", makeCompanion("a", "Ann")]]);
    const prompts: GenerateRequest[] = [];
    const session = ConversationOrchestrator.newSession(["a"]);
    const orch = new ConversationOrchestrator(session, {
      getCompanion: (id) => comps.get(id),
      lorebooks: () => new Map(),
      providerFor: () => {
        const p = fakeProvider(() => "Ann", prompts, { delayMs: 5 });
        return { provider: p, profile: p.profile };
      },
      user: () => ({ name: "Kaan", description: "" }),
      device: () => ({ os: "Linux", formFactor: "desktop", presentation: "call", localTime: "", others: [] }),
      sleep: async () => {},
    });
    const first = orch.sendUserMessage("first");
    await new Promise((r) => setTimeout(r, 12));
    const second = orch.sendUserMessage("second");
    await Promise.all([first, second]);
    const texts = session.messages.map((m) => m.text);
    expect(texts[0]).toBe("first");
    expect(texts[1].endsWith("—")).toBe(true); // partial reply kept, marked as cut off
    expect(texts.slice(2)).toEqual(["second", "I am Ann (1)"]);
  });

  it("reports provider errors without crashing", async () => {
    const comps = new Map([["a", makeCompanion("a", "Ann")]]);
    const events: OrchestratorEvent[] = [];
    const orch = new ConversationOrchestrator(ConversationOrchestrator.newSession(["a"]), {
      getCompanion: (id) => comps.get(id),
      lorebooks: () => new Map(),
      providerFor: () => {
        const p = fakeProvider(() => "x", [], { fail: true });
        return { provider: p, profile: p.profile };
      },
      user: () => ({ name: "Kaan", description: "" }),
      device: () => ({ os: "", formFactor: "desktop", presentation: "call", localTime: "", others: [] }),
    });
    orch.on((e) => events.push(e));
    await orch.sendUserMessage("hi");
    expect(events.some((e) => e.type === "turn:error")).toBe(true);
    expect(orch.isBusy).toBe(false);
  });

  it("idle chatter fires once per idle period", async () => {
    const { orch, comps, session } = setup([["a", "Ann"]]);
    comps.get("a")!.behaviour.idleChatterSeconds = 60;
    expect(await orch.idleTick(30)).toBe(false);
    expect(await orch.idleTick(61)).toBe(true);
    expect(await orch.idleTick(120)).toBe(false);
    expect(session.messages.at(-1)?.autonomous).toBe(true);
    await orch.sendUserMessage("back");
    expect(await orch.idleTick(61)).toBe(true);
  });

  it("greets with the first message when added", () => {
    const c = makeCompanion("g", "Gia");
    c.character.firstMessage = "<expr:joy> Hey {{user}}!";
    const orch = new ConversationOrchestrator(ConversationOrchestrator.newSession(), {
      getCompanion: () => c, lorebooks: () => new Map(),
      providerFor: () => { throw new Error("unused"); },
      user: () => ({ name: "Kaan", description: "" }),
      device: () => ({ os: "", formFactor: "desktop", presentation: "call", localTime: "", others: [] }),
    });
    orch.addCompanion("g");
    expect(orch.session.messages[0]).toMatchObject({ text: "Hey Kaan!", expression: "joy" });
  });

  it("regenerates with alternates kept", async () => {
    const { orch, session } = setup([["a", "Ann"]]);
    await orch.sendUserMessage("hi");
    await orch.regenerateLast();
    const last = session.messages.at(-1)!;
    expect(last.alternates).toHaveLength(1);
    expect(session.messages.filter((m) => m.role === "companion")).toHaveLength(1);
  });
});

describe("cleanReply", () => {
  it("strips own name prefix and cuts foreign lines", () => {
    const ann = makeCompanion("a", "Ann");
    const bo = makeCompanion("b", "Bo");
    expect(cleanReply("Ann: Hello!\nBo: hey\nmore", ann, "Kaan", [bo])).toBe("Hello!");
    expect(cleanReply("Sure.\nKaan: what", ann, "Kaan", [])).toBe("Sure.");
  });
});
