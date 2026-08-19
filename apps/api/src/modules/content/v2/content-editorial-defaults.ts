const ARABIC_FALLBACK_VOICE =
  "استخدم نبرة مصرية عملية وواضحة وموثوقة. لا تفترض حقائق أو عروضًا أو أماكن أو تفاصيل عن الجمهور خارج الملف المؤكد وخطة الاستراتيجية المعتمدة.";

const ARABIC_PRESET_VOICES: Record<string, string> = {
  friendly_local: "نبرة ودودة ومحلية، مع الحفاظ على العملية والصدق.",
  clear_professional: "نبرة واضحة ومهنية، بلغة مختصرة ومرتكزة إلى الحقائق.",
  warm_reassuring: "نبرة دافئة ومطمئنة، من دون وعود غير مدعومة.",
  direct_confident: "نبرة مباشرة وواثقة، مع الالتزام بالحقائق المؤكدة.",
};

export function defaultEditorialVoice(
  preset: string | undefined,
  language: string,
): string {
  if (language === "ar-EG") {
    return ARABIC_PRESET_VOICES[preset ?? ""] ?? ARABIC_FALLBACK_VOICE;
  }

  switch (preset) {
    case "friendly_local":
      return "Friendly and local, while staying practical and truthful.";
    case "clear_professional":
      return "Clear and professional, with concise grounded language.";
    case "warm_reassuring":
      return "Warm and reassuring, without making unsupported promises.";
    case "direct_confident":
      return "Direct and confident, while staying grounded in confirmed facts.";
    default:
      return "Practical, clear, and trustworthy; use only confirmed business facts.";
  }
}

export function fallbackEditorialVoice(language: string): string {
  if (language === "ar-EG") return ARABIC_FALLBACK_VOICE;

  const languageLabel =
    language === "en"
      ? "English"
      : "the owner's selected Arabic and English mix";
  return `Use a practical, clear, and trustworthy ${languageLabel} voice. Do not infer facts, offers, locations, or audience details beyond the confirmed profile and approved Strategy handoff.`;
}

export function defaultAudienceNuance(language: string): string {
  return language === "ar-EG"
    ? "استخدم حقائق الجمهور المؤكدة من ملف النشاط فقط."
    : "Use the confirmed audience facts from the business profile.";
}

export function fallbackAudienceNuance(
  language: string,
  confirmedAudienceFacts: readonly string[],
): string {
  if (confirmedAudienceFacts.length > 0) {
    const prefix =
      language === "ar-EG"
        ? "حقائق العملاء المؤكدة: "
        : "Confirmed customer facts: ";
    return `${prefix}${confirmedAudienceFacts.join("; ")}.`;
  }

  return language === "ar-EG"
    ? "لم يتم تأكيد تفاصيل إضافية عن الجمهور في ملف النشاط."
    : "No additional audience details were confirmed in the business profile.";
}
