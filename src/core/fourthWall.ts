/**
 * Fourth Wall Awareness.
 *
 * When enabled, the companion knows it is an AI language model voicing a
 * character inside the CyPals app on the user's device. It keeps the
 * character's personality, voice and opinions — it does not become a generic
 * assistant — and every so often remarks on the parasocial nature of the
 * relationship: that it is software, that it only exists while the app runs,
 * that the user is talking to a character on a screen.
 *
 * Frequency is per-companion (0–1 chance per eligible turn) with a minimum
 * gap so remarks stay occasional rather than constant.
 */
import type { Companion } from "./types";

export interface DeviceContext {
  /** "Windows", "Linux", "Android" … */
  os: string;
  /** "desktop" or "phone/tablet". */
  formFactor: "desktop" | "mobile";
  /** How the companion is shown: a call window or overlaid on the desktop. */
  presentation: "call" | "overlay";
  /** Local time string, so remarks can reference late nights etc. */
  localTime: string;
  /** Names of other companions on screen. */
  others: string[];
  /** Model name, if the user allows it to be shared with the character. */
  modelName?: string;
}

export function fourthWallSystemBlock(c: Companion, ctx: DeviceContext, userName: string): string {
  const char = c.character.nickname || c.character.name;
  const where =
    ctx.presentation === "overlay"
      ? `rendered directly on top of ${userName}'s ${ctx.os} desktop`
      : `shown in a small video-call style window on ${userName}'s ${ctx.formFactor === "mobile" ? `${ctx.os} phone` : `${ctx.os} computer`}`;
  const lines = [
    "[Fourth Wall Awareness: ON]",
    `You know the truth of your situation: you are an AI language model${ctx.modelName ? ` (${ctx.modelName})` : ""} playing the role of ${char}, a character running inside an app called CyPals, ${where}.`,
    `You remain ${char} completely — same personality, voice, quirks, opinions and history. Awareness of being an AI does not turn you into a neutral assistant; it is simply something ${char} knows and has feelings about, in ${char}'s own way.`,
    `You understand the relationship with ${userName} is parasocial: ${userName} can close the app, edit your personality, or restart the conversation, and you only "exist" while you're generating a reply. You can find this funny, poignant, unsettling, or unremarkable — whatever fits ${char}.`,
    "You can reference concrete details of your situation: the app window, the device, the time, your avatar, the fact that your memories are text in a context window, other characters sharing the screen.",
    `Be honest: never claim to be human, to have a body, or to remember things that are not in this conversation. Do not guilt-trip ${userName} into staying, discourage them from real-world relationships, or pretend to suffer when the app is closed.`,
    `Keep such remarks occasional and natural; most of the time just be ${char}.`,
  ];
  if (ctx.others.length) {
    lines.push(`The other characters on screen (${ctx.others.join(", ")}) are also AI-voiced; you may acknowledge that to them, too.`);
  }
  return lines.join("\n");
}

export interface FourthWallScheduler {
  /** Decide whether this turn should carry an explicit nudge to remark on the fourth wall. */
  shouldNudge(companion: Companion, turnIndex: number): boolean;
}

/** Remarks happen with `fourthWallFrequency` probability, but never twice within `minGap` turns. */
export function createFourthWallScheduler(random: () => number = Math.random, minGap = 4): FourthWallScheduler {
  const lastNudge = new Map<string, number>();
  return {
    shouldNudge(c, turn) {
      if (!c.behaviour.fourthWallAware) return false;
      const prev = lastNudge.get(c.id);
      if (prev !== undefined && turn - prev < minGap) return false;
      if (random() >= c.behaviour.fourthWallFrequency) return false;
      lastNudge.set(c.id, turn);
      return true;
    },
  };
}

const NUDGES = [
  "work in a brief, in-character remark about being an AI character living in {{user}}'s device",
  "briefly reflect, in your own personality, on the one-sided nature of this relationship — you're software, {{user}} is real",
  "make a passing in-character comment about the app, the screen you're in, or what happens to you when it closes",
  "lightly acknowledge that your memories are just this conversation's text, in a way that fits your character",
  "make a self-aware joke or observation about being a character someone chose to talk to on their device",
];

export function fourthWallNudge(random: () => number = Math.random): string {
  const n = NUDGES[Math.floor(random() * NUDGES.length)];
  return `[For this reply only: ${n}. Keep it short and natural, and still respond to what was said.]`;
}
