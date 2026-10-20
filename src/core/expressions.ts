/**
 * Performance tags: how the model tells the avatar what to do.
 *
 * The system prompt asks the model to prefix lines with tags such as
 *   <expr:happy> Oh, you're back! <act:wave> I missed you. <expr:sad> ...kind of.
 * The parser splits the reply into segments, each with the expression active
 * for that stretch of speech, so the face changes in step with TTS playback.
 *
 * Models frequently forget tags, so a fallback reads roleplay narration
 * (*smiles*, *waves*) and simple sentiment cues to pick an expression anyway.
 */
import { ACTIONS, EXPRESSIONS, type Action, type Expression } from "./types";

export interface Segment {
  text: string;
  expression: Expression;
  actions: Action[];
}

export interface ParsedPerformance {
  segments: Segment[];
  /** Full text without tags (narration asterisks kept unless stripNarration). */
  text: string;
  /** Expression the avatar should hold after speaking. */
  finalExpression: Expression;
  actions: Action[];
  usedTags: boolean;
}

const EXPR_SET = new Set<string>(EXPRESSIONS);
const ALIASES: Record<string, Expression> = {
  smile: "happy", smiling: "happy", glad: "happy", cheerful: "happy", excited: "joy", laugh: "joy", laughing: "joy",
  delighted: "joy", ecstatic: "joy", upset: "sad", crying: "sad", tearful: "sad", unhappy: "sad", melancholy: "sad",
  mad: "angry", annoyed: "angry", irritated: "angry", furious: "angry", shocked: "surprised", surprise: "surprised",
  astonished: "surprised", scared: "fear", afraid: "fear", nervous: "fear", anxious: "fear", disgusted: "disgust",
  blush: "embarrassed", blushing: "embarrassed", flustered: "embarrassed", shy: "embarrassed", ponder: "thinking",
  pondering: "thinking", curious: "thinking", thoughtful: "thinking", smirk: "smug", smirking: "smug", proud: "smug",
  affectionate: "love", loving: "love", adoring: "love", tired: "sleepy", yawn: "sleepy", puzzled: "confused",
  calm: "neutral", relaxed: "neutral", default: "neutral",
};

export function normalizeExpression(name: string): Expression | null {
  const k = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (EXPR_SET.has(k)) return k as Expression;
  return ALIASES[k] ?? null;
}

/** Matches <expr:x>, <expression:x>, <act:x>, <action:x>, and the bracket forms [expr:x] / [act:x]. */
const TAG_RE = /[<[]\s*(expr|expression|emotion|act|action)\s*[:=]\s*([\w\s-]{1,32}?)\s*[>\]]/gi;

const NARRATION_ACTIONS: [RegExp, Action, Expression | null][] = [
  [/\bwav(e|es|ing)\b/i, "wave", "happy"],
  [/\bnod(s|ding)?\b/i, "nod", null],
  [/\bshak(e|es|ing) (her|his|their|my) head\b/i, "shake_head", null],
  [/\blaugh(s|ing)?\b|\bgiggl(e|es|ing)\b|\bchuckl(e|es|ing)\b/i, "laugh", "joy"],
  [/\bshrug(s|ging)?\b/i, "shrug", null],
  [/\bbow(s|ing)\b/i, "bow", null],
  [/\bclap(s|ping)?\b/i, "clap", "joy"],
  [/\bpoint(s|ing)\b/i, "point", null],
];

const NARRATION_EXPR: [RegExp, Expression][] = [
  [/\bblush(es|ing)?\b|\bflustered\b/i, "embarrassed"],
  [/\bsmirk(s|ing)?\b/i, "smug"],
  [/\bsmil(e|es|ing)\b|\bgrin(s|ning)?\b|\bbeam(s|ing)\b/i, "happy"],
  [/\bfrown(s|ing)?\b|\bscowl(s|ing)?\b|\bglare(s)?\b/i, "angry"],
  [/\bcr(y|ies|ying)\b|\bsob(s|bing)?\b|\btears\b|\bsigh(s|ing)?\b/i, "sad"],
  [/\bgasp(s|ing)?\b|\bwide[- ]eyed\b|\bstartled\b/i, "surprised"],
  [/\btrembl(e|es|ing)\b|\bflinch(es|ing)?\b/i, "fear"],
  [/\btilts? (her|his|their) head\b|\bponders?\b|\bhmm+\b/i, "thinking"],
  [/\byawn(s|ing)?\b/i, "sleepy"],
];

const SENTIMENT: [RegExp, Expression][] = [
  [/\b(love you|adore|my dear|sweetheart)\b|❤|♥|😍|🥰/i, "love"],
  [/\b(haha+|hehe+|lol|yay|hooray|awesome|amazing)\b|😂|😄|😆/i, "joy"],
  [/\b(sorry|unfortunately|miss(ed)? you|sad|lonely)\b|😢|😭|☹/i, "sad"],
  [/\b(what\?!|no way|wow|whoa|really\?!)\b|😮|😲/i, "surprised"],
  [/\b(ugh|seriously|how dare|stop it)\b|😠|😡/i, "angry"],
  [/\b(um+|uh+|well\.\.\.)\b|😳/i, "embarrassed"],
  [/\?\s*$/, "thinking"],
];

/** Fallback when the model emitted no tags. Narration wins over sentiment. */
export function inferFromText(text: string): { expression: Expression | null; actions: Action[] } {
  const actions: Action[] = [];
  let expression: Expression | null = null;
  const narration = [...text.matchAll(/\*([^*\n]{1,200})\*/g)].map((m) => m[1]).join(" ");
  if (narration) {
    for (const [re, act, ex] of NARRATION_ACTIONS) {
      if (re.test(narration)) {
        actions.push(act);
        expression ??= ex;
      }
    }
    for (const [re, ex] of NARRATION_EXPR) {
      if (re.test(narration)) {
        expression = ex;
        break;
      }
    }
  }
  if (!expression) {
    const speech = text.replace(/\*[^*\n]*\*/g, " ");
    for (const [re, ex] of SENTIMENT) {
      if (re.test(speech)) {
        expression = ex;
        break;
      }
    }
  }
  return { expression, actions };
}

export function parsePerformance(raw: string, current: Expression = "neutral"): ParsedPerformance {
  const segments: Segment[] = [];
  let expr: Expression = current;
  let pendingActions: Action[] = [];
  let usedTags = false;
  let last = 0;

  const flush = (chunk: string) => {
    const text = chunk.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ");
    if (!text.trim()) return;
    segments.push({ text: text.trim(), expression: expr, actions: pendingActions });
    pendingActions = [];
  };

  for (const m of raw.matchAll(TAG_RE)) {
    usedTags = true;
    flush(raw.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const kind = m[1].toLowerCase();
    const value = m[2].trim();
    if (kind.startsWith("act")) {
      pendingActions.push(normalizeAction(value));
    } else {
      expr = normalizeExpression(value) ?? expr;
    }
  }
  flush(raw.slice(last));
  if (pendingActions.length) {
    // Trailing action tag(s) with no text after them belong to the last segment.
    if (segments.length) segments[segments.length - 1].actions.push(...pendingActions);
    else segments.push({ text: "", expression: expr, actions: pendingActions });
  }

  if (!usedTags) {
    // Infer per segment (here: the whole reply) from narration / sentiment.
    const inferred = inferFromText(raw);
    if (segments[0]) {
      segments[0].expression = inferred.expression ?? current;
      segments[0].actions = inferred.actions;
    }
  }

  // Re-join segments; close gaps left before punctuation by removed tags, but keep "… ...ellipsis".
  const text = segments.map((s) => s.text).filter(Boolean).join(" ").replace(/\s+([,;:!?]|\.(?!\.))/g, "$1");
  return {
    segments,
    text,
    finalExpression: segments.length ? segments[segments.length - 1].expression : current,
    actions: segments.flatMap((s) => s.actions),
    usedTags,
  };
}

function normalizeAction(v: string): Action {
  const k = v.toLowerCase().replace(/[\s-]+/g, "_");
  return (ACTIONS as readonly string[]).includes(k) ? (k as Action) : k;
}

/** Remove tags from a partial streaming buffer (incomplete trailing tag is hidden too). */
export function stripTagsForDisplay(partial: string): string {
  return partial.replace(TAG_RE, "").replace(/[<[]\s*(e|ex|exp|expr|expre\w*|emo\w*|a|ac|act|acti\w*)?(\s*[:=][^>\]]*)?$/i, "").replace(/[ \t]{2,}/g, " ");
}

/** Prompt text explaining the tag protocol to the model. */
export function performanceInstructions(availableActions: string[]): string {
  return [
    "You are also performing as an animated avatar. Control your face and body with tags placed BEFORE the words they apply to:",
    `- <expr:NAME> sets your facial expression. NAME is one of: ${EXPRESSIONS.join(", ")}.`,
    `- <act:NAME> performs a gesture. Available: ${availableActions.join(", ")}.`,
    "Start every reply with an <expr:...> tag and change it whenever your mood shifts mid-reply. Tags are invisible to the user; never mention them.",
  ].join("\n");
}
