/**
 * Text helpers for Chat and Call modes, which drop anything written between
 * asterisks (roleplay narration such as *smiles* or **leans in**) from card
 * fields, history and replies.
 */

/** Remove *…* and **…** spans, then tidy the whitespace and punctuation left behind. */
export function stripAsterisks(text: string): string {
  if (!text.includes("*")) return text;
  let s = text
    .replace(/\*\*[^*]*\*\*/g, " ") // **bold narration**
    .replace(/\*[^*\n]*\*/g, " ") // *narration* (single line)
    .replace(/\*[^*]*\*/g, " "); // *narration spanning lines*
  s = s.replace(/\*/g, ""); // any stray unmatched asterisk
  return tidy(s);
}

/** During streaming: also hide an unclosed `*…` at the end until it closes. */
export function stripAsterisksPartial(text: string): string {
  const stripped = text.replace(/\*\*[^*]*\*\*/g, " ").replace(/\*[^*]*\*/g, " ");
  const open = stripped.indexOf("*");
  return tidy(open >= 0 ? stripped.slice(0, open) : stripped);
}

function tidy(s: string): string {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.!?;:…])/g, "$1")
        .replace(/^[ \t]*[,;:]\s*/, "")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Chat mode: a reply separated by blank lines is shown as several message bubbles. */
export function splitChatBubbles(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
