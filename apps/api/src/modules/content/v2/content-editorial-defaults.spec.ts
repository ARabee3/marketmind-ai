import {
  defaultAudienceNuance,
  defaultEditorialVoice,
  fallbackAudienceNuance,
  fallbackEditorialVoice,
} from "./content-editorial-defaults";

describe("content editorial defaults", () => {
  it("keeps Arabic defaults in Arabic", () => {
    expect(defaultAudienceNuance("ar-EG")).toBe(
      "استخدم حقائق الجمهور المؤكدة من ملف النشاط فقط.",
    );
    expect(defaultEditorialVoice(undefined, "ar-EG")).toContain("نبرة مصرية");
    expect(defaultEditorialVoice("friendly_local", "ar-EG")).toContain(
      "نبرة ودودة",
    );
    expect(fallbackEditorialVoice("ar-EG")).toContain("خطة الاستراتيجية");
    expect(fallbackAudienceNuance("ar-EG", [])).toBe(
      "لم يتم تأكيد تفاصيل إضافية عن الجمهور في ملف النشاط.",
    );
  });

  it("preserves the English defaults for English content", () => {
    expect(defaultAudienceNuance("en")).toBe(
      "Use the confirmed audience facts from the business profile.",
    );
    expect(defaultEditorialVoice("clear_professional", "en")).toBe(
      "Clear and professional, with concise grounded language.",
    );
    expect(fallbackEditorialVoice("en")).toContain("English voice");
    expect(fallbackAudienceNuance("en", ["young customers"])).toBe(
      "Confirmed customer facts: young customers.",
    );
  });
});
