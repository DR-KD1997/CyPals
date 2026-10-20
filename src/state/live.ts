/**
 * Live per-companion performance state (expression, speech bubble, mouth
 * amplitude, queued gestures). Updated many times per second, so it lives
 * outside React; renderers read it in their animation loops and components
 * subscribe for coarse changes.
 */
import type { Action, Expression, ID } from "../core/types";

export interface LiveState {
  expression: Expression;
  /** 0..1 mouth openness, from audio RMS or synthetic flaps. */
  amplitude: number;
  speaking: boolean;
  thinking: boolean;
  bubble: string;
  bubbleVisible: boolean;
  /** Gestures waiting to be played; renderers shift() them. */
  actions: Action[];
  /** Bumped whenever a field other than amplitude changes. */
  rev: number;
}

const states = new Map<ID, LiveState>();
const subs = new Map<ID, Set<() => void>>();
const anySubs = new Set<(id: ID) => void>();

export function live(id: ID): LiveState {
  let s = states.get(id);
  if (!s) {
    s = { expression: "neutral", amplitude: 0, speaking: false, thinking: false, bubble: "", bubbleVisible: false, actions: [], rev: 0 };
    states.set(id, s);
  }
  return s;
}

export function updateLive(id: ID, patch: Partial<Omit<LiveState, "rev">>): void {
  const s = live(id);
  Object.assign(s, patch);
  if (Object.keys(patch).some((k) => k !== "amplitude")) {
    s.rev++;
    subs.get(id)?.forEach((fn) => fn());
    anySubs.forEach((fn) => fn(id));
  }
}

export function pushAction(id: ID, a: Action): void {
  live(id).actions.push(a);
  updateLive(id, {});
}

export function subscribeLive(id: ID, fn: () => void): () => void {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(fn);
  return () => subs.get(id)?.delete(fn);
}

export function subscribeAnyLive(fn: (id: ID) => void): () => void {
  anySubs.add(fn);
  return () => anySubs.delete(fn);
}

/** Snapshot for sending to the overlay window. */
export function snapshotLive(): Record<ID, LiveState> {
  return Object.fromEntries([...states].map(([k, v]) => [k, { ...v, actions: [...v.actions] }]));
}

export function applySnapshot(snap: Record<ID, LiveState>): void {
  for (const [id, s] of Object.entries(snap)) {
    const cur = live(id);
    const actions = [...cur.actions, ...s.actions.slice(cur.actions.length)];
    Object.assign(cur, s, { actions });
    subs.get(id)?.forEach((fn) => fn());
  }
}
