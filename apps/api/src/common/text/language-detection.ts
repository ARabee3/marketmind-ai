const ARABIC_RE = /[\u0600-\u06FF]/;
const LATIN_RE = /[A-Za-z]/;

export type DetectedLanguage = "ar-EG" | "en" | "mixed";

export function detectLanguage(value: string): DetectedLanguage {
  const hasArabic = ARABIC_RE.test(value);
  const hasLatin = LATIN_RE.test(value);

  if (hasArabic && hasLatin) {
    return "mixed";
  }

  return hasArabic ? "ar-EG" : "en";
}
