import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { mockAuthMe, type MockUser } from '../fixtures/auth'

/**
 * H1 clean-demo-rehearsal (IMPLEMENTATION_PLAN_123.md §4.8): runs against the
 * REAL NestJS API on :3101 (seeded zero-credentials publishing demo) and
 * asserts both terminal local-action outcomes render truthfully in ar + en —
 * no Meta credentials, no fake-n8n, no BullMQ.
 *
 * Auth is the only mocked layer (the rehearsal cannot complete a real Google
 * OAuth handshake). The workspace prefilter (`/auth/session` → JwtRefreshGuard)
 * and the client both receive REAL tokens: the orchestrator provisions a
 * refresh token + its stored hash on the demo owner, and `/auth/refresh` hands
 * the client the real access JWT. Every publishing call flows to the real API.
 *
 * Requires `.rehearsal-state.json` next to this file's parent project (written
 * by scripts/demo-rehearse.mjs). Never run via the default Playwright config.
 */

type RehearsalState = {
  apiBase: string
  ownerJwt: string
  ownerRefreshJwt: string
  intentExportId: string
  intentSimulationId: string
  businessId: string
  ownerEmail: string
}

const statePath = path.resolve(import.meta.dirname, '../../.rehearsal-state.json')
const state: RehearsalState = JSON.parse(fs.readFileSync(statePath, 'utf8'))

const ownerUser = {
  id: 'rehearsal-owner',
  fullName: 'Demo Owner (rehearsal)',
  email: state.ownerEmail,
  roles: ['OWNER'],
} satisfies MockUser

async function authenticate(page: Page) {
  // Real refresh cookie so the Next.js proxy's server-side `/auth/session`
  // check (JwtRefreshGuard against the stored hash) authorizes workspace
  // navigation without any live OAuth handshake.
  await page.context().addCookies([
    {
      name: 'refreshToken',
      value: state.ownerRefreshJwt,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  // The client's in-memory token comes from `/auth/refresh`; hand it the real
  // access JWT without rotating the (real) refresh cookie.
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: state.ownerJwt }),
    }),
  )
  await mockAuthMe(page, ownerUser)
}

const OUTCOME: Record<
  string,
  { leg: 'export' | 'simulation'; locale: 'en' | 'ar'; terminal: string; button: string }
> = {
  'export-en': {
    leg: 'export',
    locale: 'en',
    terminal: 'Exported — not published',
    button: 'Create export',
  },
  'export-ar': {
    leg: 'export',
    locale: 'ar',
    terminal: 'تم التصدير — من غير نشر',
    button: 'إنشاء تصدير',
  },
  'simulation-en': {
    leg: 'simulation',
    locale: 'en',
    terminal: 'SIMULATION — nothing was published',
    button: 'Run simulation',
  },
  'simulation-ar': {
    leg: 'simulation',
    locale: 'ar',
    terminal: 'SIMULATION — مفيش حاجة اتنشرت',
    button: 'تشغيل محاكاة',
  },
}

test.describe('clean no-credentials rehearsal (real API, ar + en)', () => {
  for (const [name, cfg] of Object.entries(OUTCOME)) {
    test(`renders the ${cfg.leg} outcome truthfully in ${cfg.locale}`, async ({
      page,
    }, testInfo) => {
      await authenticate(page)

      const intentId =
        cfg.leg === 'export' ? state.intentExportId : state.intentSimulationId
      await page.goto(`/${cfg.locale}/publishing/${intentId}`)

      // The first leg per outcome drives the real local action; the second
      // locale leg observes the already-terminal seeded state.
      if (name.endsWith('-en')) {
        await page
          .getByRole('button', { name: cfg.button })
          .first()
          .click()
      }

      await expect(
        page.getByText(cfg.terminal),
      ).toBeVisible({ timeout: 30_000 })

      // The export leg must also surface the REAL archive affordances: a
      // download button and the checksum + manifest from the stored frozen
      // manifest — never a fabricated "pending" state (issue #123 gap fix).
      if (cfg.leg === 'export') {
        const strings =
          cfg.locale === 'ar'
            ? {
                download: 'تنزيل الأرشيف',
                pending: 'الأرشيف بيتجهز. لسه مش جاهز للتنزيل.',
                manifest: 'بيان الأرشيف',
              }
            : {
                download: 'Download archive',
                pending:
                  'Export is being assembled. It is not ready to download yet.',
                manifest: 'Archive manifest',
              }
        await expect(
          page.getByRole('button', { name: strings.download }),
        ).toBeVisible()
        await expect(page.getByText(strings.pending)).toHaveCount(0)
        await page
          .locator('summary')
          .filter({ hasText: strings.manifest })
          .click()
        await expect(
          page.getByText(/^[0-9a-f]{64}$/).first(),
        ).toBeVisible()
      }

      // Truthfulness: neither leg may claim real publishing happened.
      const forbidden = cfg.locale === 'en' ? 'PUBLISHED' : 'تم النشر'
      await expect(
        page.getByText(forbidden, { exact: true }),
        `${forbidden} must not appear on the ${cfg.leg} outcome`,
      ).toHaveCount(0)

      const screenshotDir = path.join('test-results', 'rehearsal')
      fs.mkdirSync(screenshotDir, { recursive: true })
      const screenshotPath = path.join(screenshotDir, `${cfg.leg}-${cfg.locale}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach(`${cfg.leg}-${cfg.locale}`, {
        path: screenshotPath,
        contentType: 'image/png',
      })
    })
  }
})
