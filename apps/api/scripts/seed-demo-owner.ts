/**
 * Demo-rehearsal onboarding — creates the truthful owner + business the
 * zero-credentials publishing demo seeds against (runbook §5 step 3 stand-in).
 *
 * Run: `npm run seed:demo-owner` (from apps/api), or automatically from
 * `npm run demo:rehearse` at the repo root.
 *
 * Prints the created ids as JSON on the last line.
 */
import * as path from "path";
import * as dotenv from "dotenv";
import * as bcrypt from "bcrypt";

import { PrismaClient } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jwt = require("jsonwebtoken") as { sign: (p: object, s: string, o?: object) => string };

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const DEMO_OWNER_EMAIL = process.env.DEMO_OWNER_EMAIL ?? "demo-owner@marketmind.test";

/** Issues a REAL refresh token + persists its bcrypt hash and session row,
 * exactly like the AuthService session lifecycle, so the Next.js workspace prefilter
 *  (`GET /api/v1/auth/session` → JwtRefreshGuard) authorizes the rehearsal
 *  browser without any live OAuth handshake. */
async function provisionRefreshToken(
  prisma: PrismaClient,
  userId: string,
  email: string,
): Promise<string> {
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!refreshSecret) {
    throw new Error("JWT_REFRESH_SECRET missing from .env — cannot provision the demo refresh token");
  }
  const rawRefreshToken = jwt.sign(
    { sub: userId, email, roles: ["OWNER"] },
    refreshSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d" },
  );
  const hashed = await bcrypt.hash(rawRefreshToken, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    }),
    prisma.refreshSession.deleteMany({ where: { userId } }),
    prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: hashed,
        userAgent: "demo-rehearsal",
        ipAddress: null,
        expiresAt: new Date(
          Date.now() + parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d"),
        ),
      },
    }),
  ]);
  return rawRefreshToken;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const existing = await prisma.user.findUnique({
    where: { email: DEMO_OWNER_EMAIL },
    include: { businesses: { take: 1 } },
  });
  if (existing && existing.businesses.length > 0) {
    const ownerRefreshJwt = await provisionRefreshToken(
      prisma,
      existing.id,
      DEMO_OWNER_EMAIL,
    );
    console.log(
      JSON.stringify({
        ownerId: existing.id,
        businessId: existing.businesses[0].id,
        ownerRefreshJwt,
        recreated: false,
      }),
    );
    return;
  }

  const passwordHash = await bcrypt.hash("rehearsal-only-password", 12);
  const user = await prisma.user.upsert({
    where: { email: DEMO_OWNER_EMAIL },
    update: { isEmailVerified: true, status: "ACTIVE" },
    create: {
      email: DEMO_OWNER_EMAIL,
      password: passwordHash,
      fullName: "Demo Owner (rehearsal)",
      isEmailVerified: true,
      status: "ACTIVE",
      roles: ["OWNER"],
    },
  });

  const business = await prisma.business.create({
    data: {
      ownerUserId: user.id,
      displayName: "حلويات حلوانى العبد",
      businessType: "food",
      city: "قنا",
      primaryLocale: "ar-EG",
      status: "active",
    },
  });

  const ownerRefreshJwt = await provisionRefreshToken(
    prisma,
    user.id,
    DEMO_OWNER_EMAIL,
  );

  console.log(
    JSON.stringify({
      ownerId: user.id,
      businessId: business.id,
      ownerRefreshJwt,
      recreated: true,
    }),
  );
}

main()
  .catch((e) => {
    console.error("seed-demo-owner failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await new Promise((r) => setImmediate(r));
    process.exit(0);
  });

function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = Number.parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[(match[2] ?? "ms").toLowerCase()] ?? 1);
}
