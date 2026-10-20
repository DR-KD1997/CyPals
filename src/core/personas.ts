/**
 * Personas: the roles the user plays. One is the default; each companion can
 * have a preferred one; each chat records which one is in use.
 */
import type { ChatSession, Companion, ID, Persona, Relationship } from "./types";
import { nowIso, uid } from "./util";

export function newPersona(name = "New persona", description = ""): Persona {
  return { id: uid("ps"), name, description };
}

export interface PersonaSettings {
  personas: Persona[];
  defaultPersonaId: ID;
}

export function defaultPersona(s: PersonaSettings): Persona {
  return s.personas.find((p) => p.id === s.defaultPersonaId) ?? s.personas[0] ?? { id: "ps_default", name: "User", description: "" };
}

/** The persona a new chat starts with: the first on-screen companion's preference, else the default. */
export function personaForCompanions(s: PersonaSettings, companions: Companion[]): Persona {
  for (const c of companions) {
    const p = c.preferredPersonaId && s.personas.find((x) => x.id === c.preferredPersonaId);
    if (p) return p;
  }
  return defaultPersona(s);
}

/** The persona in use for a session (falls back if the chosen one was deleted). */
export function sessionPersona(s: PersonaSettings, session: ChatSession, companions: Companion[]): Persona {
  const chosen = session.personaId && s.personas.find((p) => p.id === session.personaId);
  return chosen || personaForCompanions(s, companions);
}

// ───────────── relationships / familiarity ─────────────

export function relationshipKey(companionId: ID, personaId: ID): string {
  return `${companionId}::${personaId}`;
}

export function newRelationship(companionId: ID, personaId: ID): Relationship {
  const t = nowIso();
  return { companionId, personaId, chats: 0, messages: 0, firstMet: t, lastSeen: t, recap: [] };
}

/** Count one more message exchanged between this companion and persona. */
export function touchRelationship(r: Relationship, at = nowIso()): Relationship {
  return { ...r, messages: r.messages + 1, lastSeen: at };
}

/** Close a conversation: remember its last lines for next time. */
export function closeConversation(r: Relationship, lastLines: { name: string; text: string }[]): Relationship {
  return { ...r, chats: r.chats + 1, recap: lastLines.slice(-6).map((l) => ({ name: l.name, text: l.text.slice(0, 280) })) };
}

function ago(fromIso: string, now: Date): string {
  const ms = now.getTime() - new Date(fromIso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 2) return "moments ago";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w} weeks ago`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo} months ago` : "over a year ago";
}

/**
 * A short, plain description of how well the companion knows this persona,
 * used to make spontaneous greetings feel earned rather than generic.
 */
export function familiarityText(r: Relationship | undefined, personaName: string, now = new Date()): string {
  if (!r || (r.messages === 0 && r.chats === 0)) {
    return `This is the first time you and ${personaName} have ever talked; you don't know each other yet.`;
  }
  const level =
    r.messages < 15 ? "You've only just met" : r.messages < 80 ? "You're getting to know each other" : r.messages < 300 ? "You know each other well" : "You're close and have talked a great deal";
  const lines = [
    `${level}: ${r.chats} earlier conversation${r.chats === 1 ? "" : "s"} and about ${r.messages} messages since you first met ${ago(r.firstMet, now)}.`,
    `You last spoke ${ago(r.lastSeen, now)}.`,
  ];
  if (r.recap.length) {
    lines.push(`How your last conversation ended:\n${r.recap.map((l) => `${l.name}: ${l.text}`).join("\n")}`);
  }
  return lines.join(" ");
}
