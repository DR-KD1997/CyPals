import type { CharacterDefinition, Companion, LoreEntry, Lorebook } from "./types";
import { nowIso, uid } from "./util";

export function emptyCharacter(name = "New Companion"): CharacterDefinition {
  return {
    name,
    tagline: "",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    alternateGreetings: [],
    exampleDialogue: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    creatorNotes: "",
    creator: "",
    characterVersion: "1.0",
    tags: [],
    nickname: "",
    extensions: {},
  };
}

export function defaultCompanion(name = "New Companion"): Companion {
  const t = nowIso();
  return {
    schema: 1,
    id: uid("cp"),
    createdAt: t,
    updatedAt: t,
    character: emptyCharacter(name),
    avatars: [],
    activeAvatarId: null,
    voice: { ttsEndpointId: "", voiceId: "", speed: 1, pitch: 1, hideTextWhenSpeaking: false },
    presentation: {
      mode: "call",
      frame: "circle",
      background: { type: "color", color: "#1d2433" },
      textStyle: "bubble",
      overlayScale: 0.45,
    },
    lorebookIds: [],
    embeddedLorebook: null,
    llmProfileId: null,
    preferredPersonaId: null,
    behaviour: {
      fourthWallAware: false,
      fourthWallFrequency: 0.15,
      autonomousChat: true,
      idleChatterSeconds: 0,
      spontaneousGreeting: true,
    },
    source: { kind: "created" },
  };
}

export function emptyLorebook(name = "New Lorebook"): Lorebook {
  return {
    schema: 1,
    id: uid("lb"),
    name,
    description: "",
    scanDepth: 4,
    tokenBudget: 1024,
    recursive: false,
    maxRecursionSteps: 3,
    entries: [],
    extensions: {},
  };
}

export function emptyLoreEntry(partial: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: uid("le"),
    name: "",
    keys: [],
    secondaryKeys: [],
    selective: false,
    selectiveLogic: "and_any",
    content: "",
    enabled: true,
    constant: false,
    caseSensitive: false,
    matchWholeWords: true,
    useRegex: false,
    insertionOrder: 100,
    priority: 10,
    position: "before_char",
    depth: 4,
    scanDepth: null,
    probability: 100,
    characterFilter: [],
    sticky: 0,
    cooldown: 0,
    extensions: {},
    ...partial,
  };
}
