import {
  normalizeLocale,
  renderBillingConfirmation,
  type BillingConfirmationTemplateVars,
} from "./mail-templates";

const englishVars: BillingConfirmationTemplateVars = {
  bundleName: "Starter",
  pointsGranted: "150",
  amountEgp: "100",
  currency: "EGP",
  transactionRef: "tx-1",
  confirmedAt: "Aug 20, 2026",
  billingUrl: "http://localhost:3000/billing",
  appUrl: "http://localhost:3000",
};

const arabicVars: BillingConfirmationTemplateVars = {
  ...englishVars,
  bundleName: "مبتدئ",
};

describe("renderBillingConfirmation", () => {
  it("renders the English subject and every required token", () => {
    const { subject, html } = renderBillingConfirmation(englishVars, "en");

    expect(subject).toBe("Your points have been added");
    expect(html).toContain("Starter");
    expect(html).toContain("150");
    expect(html).toContain("100");
    expect(html).toContain("EGP");
    expect(html).toContain("tx-1");
    expect(html).toContain("Aug 20, 2026");
    expect(html).toContain("http://localhost:3000/billing");
    expect(html).toContain('lang="en"');
  });

  it("renders the Arabic subject and RTL body with the Arabic bundle name", () => {
    const { subject, html } = renderBillingConfirmation(arabicVars, "ar");

    expect(subject).toBe("تمت إضافة نقاطك");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("مبتدئ");
    expect(html).toContain("150");
    expect(html).toContain("tx-1");
  });
});

describe("normalizeLocale", () => {
  it("maps English-prefixed locales to en", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
  });

  it("maps everything else (including ar-EG) to ar", () => {
    expect(normalizeLocale("ar-EG")).toBe("ar");
    expect(normalizeLocale("ar")).toBe("ar");
    expect(normalizeLocale(null)).toBe("ar");
  });
});
