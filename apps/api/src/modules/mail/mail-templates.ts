import { readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * Renders MarketMind AI transactional email bodies from standalone HTML
 * templates stored under `templates/`.
 *
 * Templates are plain `.html` files with `{{placeholder}}` tokens, named
 * `<template>.<locale>.html` (e.g. `verify-email.en.html`). The renderer
 * resolves the locale-specific file first and falls back to `en` if it is
 * missing, then resolves the templates directory from a list of candidate
 * paths so it works regardless of which output layout the TypeScript
 * compiler picks.
 */

export type MailLocale = "en" | "ar";

export interface RenderedMail {
  subject: string;
  html: string;
}

export interface VerifyEmailTemplateVars {
  link: string;
  appUrl: string;
}

export interface ResetPasswordTemplateVars {
  link: string;
  appUrl: string;
}

const BRAND_NAME = "MarketMind AI";

const SUBJECTS: Record<string, Record<MailLocale, string>> = {
  "verify-email": {
    en: "Verify your email address",
    ar: "تأكيد بريدك الإلكتروني",
  },
  "reset-password": {
    en: "Reset your MarketMind AI password",
    ar: "إعادة تعيين كلمة مرور MarketMind AI",
  },
};

/**
 * Candidate templates directories, searched in order. The first that
 * contains the requested file wins.
 */
const TEMPLATES_CANDIDATES: string[] = [
  // Production layout: JS lives at dist/modules/mail/ with templates/
  // copied next to it by the nest-cli asset glob.
  join(__dirname, "templates"),
  // Dev `nest start --watch`: JS is at dist/src/modules/mail/, but the
  // nest-cli asset glob copies HTML to dist/modules/mail/templates/.
  join(__dirname, "..", "..", "..", "modules", "mail", "templates"),
  // Source fallback (also enables hot-reload of template edits in dev).
  join(__dirname, "..", "..", "..", "..", "src", "modules", "mail", "templates"),
];

interface CachedTemplate {
  content: string;
  mtimeMs: number;
}

const templateCache = new Map<string, CachedTemplate>();

/**
 * Normalises a stored locale string into the two supported mail locales.
 * Any value beginning with "en" maps to "en"; everything else (including
 * the legacy default "ar-EG") maps to "ar", the product's primary language.
 */
export function normalizeLocale(value: string | null | undefined): MailLocale {
  if (value && value.toLowerCase().startsWith("en")) {
    return "en";
  }
  return "ar";
}

function resolveTemplatePath(name: string, locale: MailLocale): string {
  const candidates = [`${name}.${locale}.html`, `${name}.en.html`];

  for (const dir of TEMPLATES_CANDIDATES) {
    for (const fileName of candidates) {
      const candidate = join(dir, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Mail template not found: ${name}.${locale}.html (or en fallback). Searched: ${TEMPLATES_CANDIDATES.join(", ")}`,
  );
}

function loadTemplate(name: string, locale: MailLocale): string {
  const cacheKey = `${name}.${locale}`;
  const filePath = resolveTemplatePath(name, locale);
  const mtimeMs = statSync(filePath).mtimeMs;
  const cached = templateCache.get(cacheKey);

  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.content;
  }

  const content = readFileSync(filePath, "utf8");
  templateCache.set(cacheKey, { content, mtimeMs });
  return content;
}

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) =>
    vars[key] ?? "",
  );
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function subjectFor(name: string, locale: MailLocale): string {
  return SUBJECTS[name]?.[locale] ?? SUBJECTS[name]?.en ?? name;
}

export function renderVerifyEmail(
  vars: VerifyEmailTemplateVars,
  locale: MailLocale = "en",
): RenderedMail {
  const html = render(loadTemplate("verify-email", locale), {
    link: vars.link,
    appUrl: vars.appUrl,
    year: currentYear(),
    brandName: BRAND_NAME,
  });

  return { subject: subjectFor("verify-email", locale), html };
}

export function renderResetPassword(
  vars: ResetPasswordTemplateVars,
  locale: MailLocale = "en",
): RenderedMail {
  const html = render(loadTemplate("reset-password", locale), {
    link: vars.link,
    appUrl: vars.appUrl,
    year: currentYear(),
    brandName: BRAND_NAME,
  });

  return { subject: subjectFor("reset-password", locale), html };
}