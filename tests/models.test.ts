import { describe, expect, it } from "vitest";
import { createProvider, parseOpenAIModel, profileFromPreset } from "../src/core/llm/providers";
import { filterModels, formatContext } from "../src/ui/ModelPicker";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("model lists", () => {
  it("reads OpenRouter's full list with names, context, image support and price", async () => {
    const data = [
      { id: "openrouter/auto", name: "Auto Router", context_length: 2000000, architecture: { input_modalities: ["text", "image"] }, pricing: { prompt: "-1", completion: "-1" } },
      { id: "deepseek/deepseek-chat-v3:free", name: "DeepSeek V3 (free)", context_length: 163840, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } },
      { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", context_length: 1000000, architecture: { input_modalities: ["image", "text", "file"] }, pricing: { prompt: "0.000003", completion: "0.000015" } },
      ...Array.from({ length: 400 }, (_, i) => ({ id: `vendor/model-${i}`, name: `Model ${i}`, context_length: 8192 })),
    ];
    let url = "";
    const provider = createProvider({ ...profileFromPreset("openrouter"), apiKey: "k" }, async (u) => {
      url = u;
      return json({ data });
    });
    const list = await provider.listModels();
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(list).toHaveLength(403);
    const free = list.find((m) => m.id.endsWith(":free"))!;
    expect(free).toMatchObject({ name: "DeepSeek V3 (free)", contextLength: 163840, vision: false, free: true });
    expect(list.find((m) => m.id === "anthropic/claude-sonnet-4.5")).toMatchObject({ vision: true, free: undefined });
    expect(list.find((m) => m.id === "openrouter/auto")?.free).toBeUndefined();
  });

  it("handles bare local-server lists", () => {
    expect(parseOpenAIModel({ id: "llama3.1:8b", object: "model" })).toEqual({ id: "llama3.1:8b", name: undefined, contextLength: undefined, vision: undefined, free: undefined });
    expect(parseOpenAIModel("qwen")).toEqual({ id: "qwen" });
    expect(parseOpenAIModel({ id: "x", context_window: 131072 })?.contextLength).toBe(131072);
    expect(parseOpenAIModel({})).toBeNull();
  });

  it("pages through Gemini's list", async () => {
    const calls: string[] = [];
    const provider = createProvider({ ...profileFromPreset("gemini"), apiKey: "k" }, async (u) => {
      calls.push(u);
      return u.includes("pageToken")
        ? json({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] }] })
        : json({ nextPageToken: "p2", models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] });
    });
    const list = await provider.listModels();
    expect(calls).toHaveLength(2);
    expect(list.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(list[1]).toMatchObject({ name: "Gemini 2.5 Pro", contextLength: 1048576 });
  });

  it("searches by every word in id or name, not by what the field already holds", () => {
    const list = [
      { id: "openrouter/auto", name: "Auto Router" },
      { id: "openrouter/auto-beta" },
      { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", vision: true },
      { id: "x/y:free", free: true, vision: false },
    ];
    expect(filterModels(list, "")).toHaveLength(4);
    expect(filterModels(list, "claude sonnet").map((m) => m.id)).toEqual(["anthropic/claude-sonnet-4.5"]);
    expect(filterModels(list, "", { free: true }).map((m) => m.id)).toEqual(["x/y:free"]);
    expect(filterModels(list, "", { vision: true })).toHaveLength(1);
    expect(formatContext(163840)).toBe("164k");
    expect(formatContext(2000000)).toBe("2M");
  });
});
