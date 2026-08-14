/**
 * Writing styles. Shared so the renderer's style pills, the persisted default
 * style and the server's cleanup prompt can never disagree about the wire value.
 */

export const WRITING_STYLES = ['auto', 'casual', 'formal', 'excited', 'precise'] as const;

export type WritingStyle = (typeof WRITING_STYLES)[number];

export const DEFAULT_WRITING_STYLE: WritingStyle = 'auto';

export function isWritingStyle(value: unknown): value is WritingStyle {
  return typeof value === 'string' && (WRITING_STYLES as readonly string[]).includes(value);
}

/** Falls back to 'auto' for anything unrecognised (old clients, hand-edited stores). */
export function coerceWritingStyle(value: unknown): WritingStyle {
  return isWritingStyle(value) ? value : DEFAULT_WRITING_STYLE;
}

export const WRITING_STYLE_LABELS: Record<WritingStyle, string> = {
  auto: 'Auto',
  casual: 'Casual',
  formal: 'Formal',
  excited: 'Excited',
  precise: 'Precise',
};

/** One-line examples shown in the onboarding style picker. */
export const WRITING_STYLE_EXAMPLES: Record<WritingStyle, string> = {
  auto: 'Matches however you happen to be talking.',
  casual: "hey — just wrapped the deck, want me to send it over?",
  formal: 'I have finished the deck. Please let me know if you would like me to send it.',
  excited: 'The deck is done — and it turned out great! Want me to send it?',
  precise: 'Deck complete. Send on request.',
};

/**
 * Instructions appended to the cleanup system prompt. Kept next to the labels so
 * adding a style is a single-file change.
 */
export const WRITING_STYLE_INSTRUCTIONS: Record<WritingStyle, string> = {
  auto: 'Keep the register the speaker already used. Do not push the text more formal or more casual than it arrived.',
  casual:
    'Write it the way a person messages a colleague they like: contractions, plain words, short sentences. No slang the speaker did not use.',
  formal:
    'Write it as professional written correspondence: complete sentences, no contractions, no slang, courteous but not stiff.',
  excited:
    'Keep the speaker\'s energy up: lively phrasing and at most one exclamation mark per short message. Never invent enthusiasm about facts the speaker did not state.',
  precise:
    'Strip every word that does not carry information. Prefer the shortest sentence that keeps the full meaning. No hedging, no pleasantries.',
};
