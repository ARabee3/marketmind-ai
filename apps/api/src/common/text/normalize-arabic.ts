const DIACRITICS = /[\u064B-\u065F\u0670]/g;

export function normalizeArabic(value: string): string {
  return value
    .replace(DIACRITICS, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}
