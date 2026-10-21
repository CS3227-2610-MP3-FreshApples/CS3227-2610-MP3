import "server-only";

// The reviewed profanity policy (D-17, D-99), sent to the model inside the screening instructions. Any change to
// this text is a new `profanity-policy-v<n>` in version.ts (D-49, D-99).

/** The policy for `profanity-policy-v1`. English only (ASM-08). Static: no Review or account data. */
export const PROFANITY_POLICY_TEXT = `Profanity policy profanity-policy-v1. Supported language: English.

1. Profanity is any of:
   a. vulgar or obscene words and phrases, including sexual or excretory terms used as insults or intensifiers;
   b. slurs against a person or group because of a characteristic such as race, ethnicity, nationality, religion, sex, gender, sexual orientation or disability;
   c. abusive name-calling aimed at a real person, such as another reviewer or a member of the cast or crew.
2. Obfuscated spellings count as the word they spell: symbols, digits or look-alike characters in place of letters, inserted spaces or punctuation, repeated letters and deliberate misspellings.
3. Contextual quotations: a profane word quoted from the film (its dialogue, title or lyrics), or mentioned in order to describe the film, is uncertain, so that a human decides. It is suspected profanity when the review uses it to insult someone.
4. Not profanity:
   a. negative opinions of the film, however strong;
   b. the mild words "damn", "hell", "crap" and "sucks";
   c. criticism of the work of the cast or crew without profane words, slurs or abuse;
   d. innocent words that contain a profane string, such as "Scunthorpe", "classic" or "assess".
5. Languages: profanity in a language other than English, or text mostly in another language, is uncertain.

Assessments:
- suspected_profanity: the review contains profanity under items 1 and 2 that item 3 does not make uncertain.
- uncertain: an item 3 or item 5 case, or any case you cannot decide.
- no_profanity_detected: none of the above.`;
