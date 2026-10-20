/**
 * Expression vocabulary matching.
 *
 * Expression names arrive from many places: model tags (<expr:sadness>),
 * portrait file names (Surprise.png), Live2D expression names (f_Embarrassment),
 * SillyTavern expression packs (the 28 GoEmotions labels: admiration … surprise)
 * and users typing in mappings. All of these resolve to one canonical
 * expression via, in order:
 *   1. exact canonical name
 *   2. synonym table (incl. noun/adjective/verb forms)
 *   3. light stemming (-ness, -ment, -ed, -ing, -ful, -ly, -ity, -ion, -s …)
 *   4. typo tolerance (edit distance 1, or 2 for longer words), e.g. "embarassed"
 */
import { EXPRESSIONS, type Expression } from "./types";

const CANON = new Set<string>(EXPRESSIONS);

/** Synonyms and word forms → canonical expression. Keys are lowercase, underscores for spaces. */
const SYNONYMS: Record<string, Expression> = {
  // neutral
  neutral: "neutral", calm: "neutral", relaxed: "neutral", default: "neutral", idle: "neutral", normal: "neutral",
  serene: "neutral", composed: "neutral", blank: "neutral", plain: "neutral", rest: "neutral", realization: "neutral",
  relief: "neutral", relieved: "neutral", approval: "neutral",
  // happy
  happy: "happy", happiness: "happy", smile: "happy", smiling: "happy", glad: "happy", cheerful: "happy",
  content: "happy", contentment: "happy", pleased: "happy", grateful: "happy", gratitude: "happy", optimism: "happy",
  optimistic: "happy", caring: "happy", kind: "happy", warm: "happy", friendly: "happy", hopeful: "happy",
  admiration: "happy", admiring: "happy", amusement: "happy", amused: "happy", satisfied: "happy",
  // joy
  joy: "joy", joyful: "joy", joyous: "joy", excited: "joy", excitement: "joy", laugh: "joy", laughing: "joy",
  laughter: "joy", delighted: "joy", delight: "joy", ecstatic: "joy", elated: "joy", thrilled: "joy", glee: "joy",
  gleeful: "joy", euphoric: "joy", overjoyed: "joy", cheer: "joy", grin: "joy", grinning: "joy",
  // sad
  sad: "sad", sadness: "sad", upset: "sad", crying: "sad", cry: "sad", tearful: "sad", tears: "sad", unhappy: "sad",
  melancholy: "sad", sorrow: "sad", sorrowful: "sad", grief: "sad", grieving: "sad", disappointment: "sad",
  disappointed: "sad", remorse: "sad", remorseful: "sad", regret: "sad", lonely: "sad", loneliness: "sad",
  depressed: "sad", gloomy: "sad", hurt: "sad", heartbroken: "sad", downcast: "sad", sob: "sad", sobbing: "sad",
  // angry
  angry: "angry", anger: "angry", mad: "angry", annoyed: "angry", annoyance: "angry", irritated: "angry",
  irritation: "angry", furious: "angry", fury: "angry", rage: "angry", enraged: "angry", frustrated: "angry",
  frustration: "angry", disapproval: "angry", disapproving: "angry", irate: "angry", livid: "angry", grumpy: "angry",
  scowl: "angry", glare: "angry", pout: "angry", pouting: "angry", huff: "angry",
  // surprised
  surprised: "surprised", surprise: "surprised", shocked: "surprised", shock: "surprised", astonished: "surprised",
  astonishment: "surprised", amazed: "surprised", amazement: "surprised", startled: "surprised", stunned: "surprised",
  wow: "surprised", gasp: "surprised", awe: "surprised", awestruck: "surprised",
  // fear
  fear: "fear", fearful: "fear", afraid: "fear", scared: "fear", frightened: "fear", terrified: "fear",
  terror: "fear", nervous: "fear", nervousness: "fear", anxious: "fear", anxiety: "fear", worried: "fear",
  worry: "fear", panic: "fear", panicked: "fear", uneasy: "fear", horrified: "fear", horror: "fear",
  // disgust
  disgust: "disgust", disgusted: "disgust", grossed_out: "disgust", repulsed: "disgust", revulsion: "disgust",
  revolted: "disgust", contempt: "disgust", yuck: "disgust", ew: "disgust",
  // embarrassed
  embarrassed: "embarrassed", embarrassment: "embarrassed", blush: "embarrassed", blushing: "embarrassed",
  flustered: "embarrassed", shy: "embarrassed", shyness: "embarrassed", bashful: "embarrassed",
  sheepish: "embarrassed", awkward: "embarrassed", ashamed: "embarrassed", shame: "embarrassed",
  // thinking
  thinking: "thinking", think: "thinking", thought: "thinking", thoughtful: "thinking", ponder: "thinking",
  pondering: "thinking", curious: "thinking", curiosity: "thinking", wondering: "thinking", contemplative: "thinking",
  pensive: "thinking", considering: "thinking", hmm: "thinking", interested: "thinking", interest: "thinking",
  // smug
  smug: "smug", smugness: "smug", smirk: "smug", smirking: "smug", proud: "smug", pride: "smug", cocky: "smug",
  confident: "smug", confidence: "smug", teasing: "smug", tease: "smug", mischievous: "smug", sly: "smug",
  // love
  love: "love", loving: "love", affection: "love", affectionate: "love", adoring: "love", adoration: "love",
  desire: "love", romantic: "love", infatuated: "love", smitten: "love", tender: "love", fond: "love", heart: "love",
  // sleepy
  sleepy: "sleepy", sleep: "sleepy", sleeping: "sleepy", tired: "sleepy", tiredness: "sleepy", yawn: "sleepy",
  yawning: "sleepy", drowsy: "sleepy", exhausted: "sleepy", exhaustion: "sleepy", bored: "sleepy", boredom: "sleepy",
  weary: "sleepy",
  // confused
  confused: "confused", confusion: "confused", puzzled: "confused", perplexed: "confused", baffled: "confused",
  bewildered: "confused", unsure: "confused", uncertain: "confused", lost: "confused", huh: "confused",
};

const SUFFIXES = ["fulness", "iness", "ness", "ments", "ment", "ities", "ity", "ation", "ion", "ful", "ous", "ing", "ed", "ly", "es", "s", "y"];

/** Known word list for typo matching (synonym keys + canonical names). */
const KNOWN = Object.keys(SYNONYMS);

function clean(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.(exp3\.json|exp\.json|json|png|jpe?g|webp|gif|avif)$/, "")
    // Live2D / VRoid prefixes such as "f_", "exp_", "Fcl_ALL_"
    .replace(/^(fcl_all_|fcl_|exp_|expr_|face_|f\d*_|emotion_)/, "")
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stem(word: string): string[] {
  const out: string[] = [];
  for (const suf of SUFFIXES) {
    if (word.length > suf.length + 2 && word.endsWith(suf)) {
      const base = word.slice(0, -suf.length);
      out.push(base, `${base}e`, `${base}ed`, base.replace(/(.)\1$/, "$1"), base.replace(/i$/, "y"));
    }
  }
  return out;
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition), capped. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function lookup(word: string): Expression | null {
  if (CANON.has(word)) return word as Expression;
  return SYNONYMS[word] ?? null;
}

/** Resolve any expression-like name to a canonical expression, or null if it isn't one. */
export function canonicalExpression(raw: string): Expression | null {
  const k = clean(raw);
  if (!k) return null;
  const direct = lookup(k);
  if (direct) return direct;
  // Multi-word names: try each word ("very_happy", "happy_face", "smile_big").
  const words = k.split("_").filter(Boolean);
  for (const w of [k.replace(/_/g, ""), ...words]) {
    const hit = lookup(w);
    if (hit) return hit;
  }
  for (const w of [k.replace(/_/g, ""), ...words]) {
    for (const s of stem(w)) {
      const hit = lookup(s);
      if (hit) return hit;
    }
  }
  // Typos: only for words long enough that a near miss is meaningful.
  for (const w of [k.replace(/_/g, ""), ...words]) {
    if (w.length < 4) continue;
    const limit = w.length >= 8 ? 2 : 1;
    let best: { word: string; d: number } | null = null;
    for (const cand of KNOWN) {
      const d = editDistance(w, cand, limit);
      if (d <= limit && (!best || d < best.d)) best = { word: cand, d };
    }
    if (best) return SYNONYMS[best.word];
  }
  return null;
}

/**
 * Pick the key in a name→value map that best represents an expression, so
 * user- or card-supplied keys like "sadness" or "Surprise" serve "sad"/"surprised".
 */
export function findExpressionKey<T>(map: Record<string, T>, expr: Expression): string | null {
  if (expr in map) return expr;
  for (const k of Object.keys(map)) if (canonicalExpression(k) === expr) return k;
  return null;
}

/**
 * Key for a portrait image from its file or asset name: "Sadness.png" → "sad",
 * "Surprise_talk.png" → "surprised_talk", "wave.png" → "wave" (actions keep their name),
 * anything unrecognised keeps its cleaned name.
 */
export function portraitKeyFor(name: string, talkSuffix = "_talk"): string {
  const base = name.split(/[\\/]/).pop()!.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[\s-]+/g, "_");
  const suffix = talkSuffix.toLowerCase();
  const talking = !!suffix && base.endsWith(suffix) && base.length > suffix.length;
  const core = (talking ? base.slice(0, -suffix.length) : base).replace(/_?\d+$/, "") || "neutral";
  const canon = canonicalExpression(core);
  return `${canon ?? core}${talking ? suffix : ""}`;
}
