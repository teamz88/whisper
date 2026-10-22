/**
 * Whisper invents text when it is handed silence or room tone. The inventions
 * are not random — they are the most common phrases in its training data, which
 * was largely subtitled video. A user who taps the hotkey and says nothing must
 * not get "Thanks for watching!" pasted into their email.
 *
 * Everything here runs on the RAW transcript, before cleanup, so we never pay
 * for an LLM call on a phantom.
 */

/**
 * Exact matches, after normalisation (lowercased, punctuation and bracket
 * decorations stripped). Includes the Russian set because the team dictates in
 * ru/uz/tg and Whisper's Russian silence-artifacts are just as fixed.
 */
const HALLUCINATION_PHRASES = new Set<string>([
  // English — subtitle boilerplate
  'you',
  'thank you',
  'thank you very much',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching the video',
  'please subscribe',
  'subscribe',
  'subscribe to my channel',
  'like and subscribe',
  "don't forget to subscribe",
  'see you next time',
  'see you in the next video',
  // NOT 'okay' / 'ok' / 'yeah' / 'bye' / 'да' / 'нет': those are the most
  // common deliberate one-word replies in chat, and eating them silently costs
  // more than the occasional pasted phantom. The cleanup pass still returns
  // NO_SPEECH for anything that reads as an artifact in context.
  'so',
  'hmm',
  'mm',
  'uh',
  'um',
  'oh',
  'the end',
  'end of video',
  // Sound-effect tags Whisper emits for non-speech audio
  'music',
  'music playing',
  'applause',
  'silence',
  'blank audio',
  'inaudible',
  'noise',
  'laughter',
  'coughing',
  'beep',
  'sound',
  'foreign',
  // Transcription-service watermarks that leak in from the training data
  'subtitles by the amara org community',
  'amara org',
  'transcription by castingwords',
  'subs by www zeoranger co uk',
  // Russian
  'спасибо',
  'спасибо за просмотр',
  'спасибо за внимание',
  'подписывайтесь на канал',
  'продолжение следует',
  'редактор субтитров а семкин корректор а кулакова',
  'субтитры сделал диматорзок',
  'субтитры делал диматорзок',
  'музыка',
  'аплодисменты',
  'ну',
  'это',
  // Uzbek / Tajik
  'rahmat',
  'raxmat',
  'ташаккур',
  'хуш',
]);

/**
 * Patterns tested against the RAW trimmed transcript (lowercased) — normalise()
 * strips brackets and colons, so anything keyed on those characters would be
 * dead code against the normalised string.
 */
const RAW_PATTERNS: readonly RegExp[] = [
  // Nothing but a bracketed/decorated tag: [Music], (applause), ♪♪, *sighs*
  /^[[(<{♪*].*[\])>}♪*]$/su,
  // "Subtitles by ...", "Transcribed by ...", "Translation: ..."
  /^(sub(titl|)e?s?|transcri(pt|bed)|translat(ed|ion))\s*(by\b|:)/iu,
];

/** Patterns tested against the normalised string. */
const NORMALISED_PATTERNS: readonly RegExp[] = [
  // Repeated single token: "you you you you", "спасибо спасибо спасибо"
  /^(\S+)(\s+\1){2,}$/u,
  // Nothing but boilerplate tokens in any order or count: "you thank you thank you"
  // (85 s of room tone, 2026-10-22), "thanks bye", "you you thank you". The exact
  // set above misses these because the tokens repeat unevenly.
  /^(?:(?:you|thank|thanks|thankyou|bye|goodbye|please|subscribe|watching)\s*)+$/u,
];

/** Punctuation-only strings such as "...", "?!", "—". */
function countAlphanumeric(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

/**
 * Lowercase, drop bracket decorations and punctuation, collapse whitespace.
 * "[ Music ]" and "Music." both become "music".
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[[\]()<>{}♪*_"'`]/gu, ' ')
    .replace(/[.,!?;:—–\-…/\\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export type HallucinationVerdict =
  | { hallucination: false }
  | { hallucination: true; reason: 'empty' | 'hallucination' };

/**
 * Decide whether a raw transcript is real speech.
 *
 * `empty` means there was effectively nothing there; `hallucination` means
 * Whisper produced a known phantom. Both are discarded silently — an error
 * toast for "you said nothing" is worse than saying nothing back.
 */
export function classifyTranscript(raw: string): HallucinationVerdict {
  const text = raw.trim();

  if (countAlphanumeric(text) < 2) {
    return { hallucination: true, reason: 'empty' };
  }

  for (const pattern of RAW_PATTERNS) {
    if (pattern.test(text.toLowerCase())) {
      return { hallucination: true, reason: 'hallucination' };
    }
  }

  const normalised = normalise(text);

  if (normalised === '') {
    return { hallucination: true, reason: 'empty' };
  }

  if (HALLUCINATION_PHRASES.has(normalised)) {
    return { hallucination: true, reason: 'hallucination' };
  }

  for (const pattern of NORMALISED_PATTERNS) {
    if (pattern.test(normalised)) {
      return { hallucination: true, reason: 'hallucination' };
    }
  }

  return { hallucination: false };
}

export function isHallucination(raw: string): boolean {
  return classifyTranscript(raw).hallucination;
}
