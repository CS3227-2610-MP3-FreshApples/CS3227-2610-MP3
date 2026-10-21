import "server-only";

// Checks shared by the AI-01 and AI-02 output schemas (D-87, D-96, D-100). Provider content is untrusted (AI-04).

const LINE_FEED = 0x0a;
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;
const URL_TEXT = /https?:\/\/|www\./i;
// D-96: "a letter" is an ASCII letter, the set that starts a tag in HTML tokenization.
const MARKUP = /<[A-Za-z/!?]/;
const FENCE = "```";
const FENCE_TAG = "json";

export function codePointCount(value: string): number {
  return Array.from(value).length;
}

/**
 * D-87 safe text: no C0 control other than LF, no DEL, no unpaired surrogate (D-96: `jsonb` cannot store one), no
 * URL and no markup. String iteration yields a valid pair as one code point, so a surrogate here is unpaired.
 */
export function isSafeText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number;
    if (
      (code < FIRST_PRINTABLE && code !== LINE_FEED) ||
      code === DELETE ||
      (code >= FIRST_SURROGATE && code <= LAST_SURROGATE)
    ) {
      return false;
    }
  }
  return !URL_TEXT.test(value) && !MARKUP.test(value);
}

/** Strips one outer triple-backtick fence, optionally tagged `json` (D-87). */
function stripOuterFence(text: string): string {
  if (text.length < 2 * FENCE.length || !text.startsWith(FENCE) || !text.endsWith(FENCE)) {
    return text;
  }
  const inner = text.slice(FENCE.length, -FENCE.length);
  return inner.startsWith(FENCE_TAG) ? inner.slice(FENCE_TAG.length) : inner;
}

/**
 * The D-87 parse step: trim, strip one outer fence, then `JSON.parse`. No JSON response mode is relied on (O-27).
 * Returns `undefined` for content that is not JSON, because `JSON.parse` never yields it. Never throws.
 */
export function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(stripOuterFence(content.trim())) as unknown;
  } catch {
    return undefined;
  }
}
