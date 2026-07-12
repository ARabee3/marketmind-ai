import { readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * Renders MarketMind AI transactional email bodies from standalone HTML
 * templates stored under `templates/`.
 *
 * Templates are plain `.html` files with `{{placeholder}}` tokens. The
 * renderer resolves the templates directory from a list of candidate
 * paths (set up below) so it works regardless of which output layout the
 * TypeScript compiler picks:
 *
 *   - production build nests JS and assets at `dist/modules/mail/`
 *     (tsconfig.build.json strips the `src/` segment);
 *   - dev `nest start --watch` nests JS at `dist/src/modules/mail/`
 *     while the nest-cli asset glob still copies HTML to
 *     `dist/modules/mail/templates/`;
 *   - the source directory `apps/api/src/modules/mail/templates/` is a
 *     final fallback that also lets template edits hot-reload in dev
 *     without a server restart.
 *
 * Files are re-read when their mtime changes, so cached entries stay fresh
 * across dev edits while remaining free of disk I/O on hot production
 * paths.
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

const BRAND_NAME = "MarketMind AI";

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

function resolveTemplatePath(name: string): string {
  for (const dir of TEMPLATES_CANDIDATES) {
    const candidate = join(dir, `${name}.html`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Mail template not found: ${name}.html. Searched: ${TEMPLATES_CANDIDATES.join(", ")}`,
  );
}

function loadTemplate(name: string): string {
  const filePath = resolveTemplatePath(name);
  const mtimeMs = statSync(filePath).mtimeMs;
  const cached = templateCache.get(name);

  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.content;
  }

  const content = readFileSync(filePath, "utf8");
  templateCache.set(name, { content, mtimeMs });
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