import { readFileSync } from "fs";
import { join } from "path";

/**
 * Renders MarketMind AI transactional email bodies from standalone HTML
 * templates stored under `templates/`.
 *
 * Templates are plain `.html` files with `{{placeholder}}` tokens. Files are
 * read once and cached for the process lifetime. Nest CLI ships the
 * `templates/*.html` assets into the compiled output so production builds
 * resolve the same `__dirname/templates` path.
 */

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

const TEMPLATES_DIR = join(__dirname, "templates");
const BRAND_NAME = "MarketMind AI";

const templateCache = new Map<string, string>();

function loadTemplate(name: string): string {
  const cached = templateCache.get(name);
  if (cached) {
    return cached;
  }

  const filePath = join(TEMPLATES_DIR, `${name}.html`);
  const content = readFileSync(filePath, "utf8");
  templateCache.set(name, content);
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

export function renderVerifyEmail(
  vars: VerifyEmailTemplateVars,
): RenderedMail {
  const html = render(loadTemplate("verify-email"), {
    link: vars.link,
    appUrl: vars.appUrl,
    year: currentYear(),
    brandName: BRAND_NAME,
  });

  return { subject: "Verify your email address", html };
}

export function renderResetPassword(
  vars: ResetPasswordTemplateVars,
): RenderedMail {
  const html = render(loadTemplate("reset-password"), {
    link: vars.link,
    appUrl: vars.appUrl,
    year: currentYear(),
    brandName: BRAND_NAME,
  });

  return { subject: "Reset your MarketMind AI password", html };
}