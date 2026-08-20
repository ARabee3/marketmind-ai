# Admin Account Provisioning and Testing Runbook

This runbook covers provisioning a MarketMind ADMIN account, verifying the
admin console end-to-end (English and Arabic), and confirming server-side
role enforcement. It is the closedown checklist for issue #209 after
PR #207 merged the admin console.

## Prerequisites

- PostgreSQL and Redis running (`npm run docker:up`).
- API built and migrated (`npm run dev:full` from the repo root at least
  once, or `npm run prisma:migrate:deploy -w @marketmind/api` for migrations).
- A strong `ADMIN_PASSWORD` ready — the seed script refuses to run without
  one and never seeds a predictable default credential.

## 1. Provision the admin user

From `apps/api`:

```bash
ADMIN_EMAIL="admin@marketmind.ai" \
ADMIN_NAME="MarketMind Admin" \
ADMIN_PASSWORD="<strong-password>" \
npx ts-node scripts/seed-admin-user.ts
```

The script is idempotent. Re-running it updates the password, name, roles
(to `["ADMIN"]`), marks the email verified, and sets `status: "active"` via
`prisma.user.upsert`. It prints a JSON line with the resulting `userId`.

Notes:

- The script does **not** grant `ADMIN` to an existing non-admin user
  silently; it sets `roles: ["ADMIN"]`. To preserve other roles, do that
  through Prisma Studio or a SQL migration, not this script.
- Never commit `ADMIN_PASSWORD` into shell history, `.env`, or the repo.
  Pass it as an inline env var and rotate it after first login.

## 2. Start the stack

```bash
npm run dev
```

Then open `http://localhost:3000`.

## 3. Admin login verification

1. Sign out of any existing session first.
2. Sign in with `admin@marketmind.ai` and the password you seeded.
3. The post-login router must land you on `/admin` (the admin console),
   not the OWNER dashboard. This is the behaviour added by commit `b2fb0f5`.
4. Confirm the sidebar shows the admin sections: Overview, Users, Revenue.
5. On mobile width, confirm the bottom nav renders and the active state
   marks the admin section you are on (commit `6e42203`).

## 4. English locale sweep

On `/en/admin`:

- **Overview**: stat tiles (active businesses, active subscriptions,
  trialing count, MRR-EGP) render as integers; MRR is finite (no `null`,
  no `Infinity` after the `computeMrrEgp` hardening).
- **Users**: pagination controls work; page-size selector and search filter
  narrow the list; clicking a row opens the user detail panel with
  federated identities, active sessions, and businesses; Tab focus is
  trapped inside the panel (commit `2bb9208`).
- **Revenue**: revenue summary numbers match the overview; the
  subscriptions table shows plan, interval label (`monthly`/`yearly`/
  `trial`/`founding_pilot`), amount-EGP, and owner.
- **Server-side enforcement**: with the admin's JWT in DevTools, hit
  `GET /api/v1/admin/revenue/summary` directly — 200. The same call with
  an `OWNER` or `DEVELOPER_DEMO` token returns 403; anonymous returns 401.

## 5. Arabic locale sweep

On `/ar/admin`:

- Repeat the Overview, Users, and Revenue checks. Plan names, status
  labels, interval labels, role labels, and login-method labels must all
  render in Arabic via `admin-labels.ts` (commit `663012f`).
- Numbers remain Western Arabic digits in both locales (they are not
  translated). The layout must be RTL; confirm the sidebar/bottom nav
  mirror and the user-detail panel opens from the correct edge.

## 6. Needs-attention deep links and filters

The Overview's needs-attention rows deep-link into filtered lists instead of
opening unfiltered pages (issue #209 hardening):

1. From `/en/admin`, click the **past-due** needs-attention row. You must land
   on `/en/admin/revenue?state=past_due`. A filter notice appears above the
   subscriptions table with a "Show all" link that clears `state`.
2. Repeat for **expired**: `/en/admin/revenue?state=expired`. Only `expired`
   subscriptions must be listed; row pagination resets when the filter changes.
3. Click **unverified users**: `/en/admin/users?verified=false`. Only
   users with `isEmailVerified: false` and `status: "active"` must be listed;
   the notice labels the view and offers "Show all".
4. Direct API equivalents: `GET /api/v1/admin/subscriptions?state=past_due`
   and `GET /api/v1/admin/users?verified=false` return only matching rows.
5. In Arabic, repeat on `/ar/admin` — notices, badges, and the clear link must
   render in Arabic and respect RTL.

## 7. Non-admin regression sweep

1. Sign in as a seeded `OWNER` account.
2. Manually navigate to `/admin`, `/admin/users`, `/admin/revenue`.
   Each must redirect away (the admin route guard is server-side,
   commit `0e6913c`) — never render the admin UI for a non-admin.
3. With the OWNER JWT, call all four admin endpoints directly; each must
   return 403. This is also covered by `apps/api/test/admin.e2e-spec.ts`.
4. Repeat with a `DEVELOPER_DEMO` account — same 403s.

## 8. Refresh-session lifecycle

1. As the admin, sign in and capture the refresh cookie.
2. Confirm the session survives a browser restart within the 7-day window
   (commit `5af03ab`).
3. Sign out; the refresh session must be revoked (`revokedAt` set); a
   reuse of that refresh token after logout must be rejected.

## 9. Seeding safety re-check

```bash
# Should fail with a non-zero exit and an error mentioning ADMIN_PASSWORD:
ADMIN_PASSWORD=" " npx ts-node scripts/seed-admin-user.ts
```

The script must never seed an empty/whitespace credential. This is the
hardening shipped in commit `2b5270e`.

## 10. Closedown

- [ ] Admin lands on `/admin` after login (EN).
- [ ] Admin lands on `/ar/admin` after login (AR).
- [ ] Overview/Users/Revenue render with finite numbers in both locales.
- [ ] OWNER and DEVELOPER_DEMO are blocked server-side (403) and client-side (redirect).
- [ ] Anonymous calls to all four admin endpoints return 401.
- [ ] Refresh session persists within the 7-day window and revokes on logout.
- [ ] Seed script fails without a real `ADMIN_PASSWORD`.
- [ ] `mrrEgp` is `Number.isFinite` over the e2e summary endpoint.
- [ ] Needs-attention rows deep-link to filtered lists
      (`/admin/revenue?state=past_due|expired`,
      `/admin/users?verified=false`) with a clearable filter notice.
- [ ] Suspended unverified users are excluded from the unverified count and
      the `?verified=false` list.
- [ ] Admin who requested a workspace route lands on `/admin` (not the
      workspace), and a non-admin who requested `/admin` lands on `/dashboard`.

If any item above does not hold, file a follow-up against issue #209 with
the failing step, not a new issue.