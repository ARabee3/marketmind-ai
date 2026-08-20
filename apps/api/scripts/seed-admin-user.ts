/**
 * Seed an admin user (idempotent — re-runnable).
 *
 * Run: npx ts-node scripts/seed-admin-user.ts (from apps/api)
 */
import * as path from "path"
import * as dotenv from "dotenv"
import * as bcrypt from "bcrypt"
import { PrismaClient } from "@prisma/client"

dotenv.config({ path: path.resolve(process.cwd(), ".env") })

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@marketmind.ai"
const ADMIN_NAME = process.env.ADMIN_NAME ?? "MarketMind Admin"

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim()
if (!ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_PASSWORD is required; refusing to seed an admin with a predictable default credential",
  )
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      password: passwordHash,
      fullName: ADMIN_NAME,
      roles: ["ADMIN"],
      isEmailVerified: true,
      status: "ACTIVE",
    },
    create: {
      email: ADMIN_EMAIL,
      password: passwordHash,
      fullName: ADMIN_NAME,
      isEmailVerified: true,
      status: "ACTIVE",
      roles: ["ADMIN"],
    },
  })

  console.log(
    JSON.stringify({
      userId: user.id,
      email: user.email,
      roles: user.roles,
      action: "upserted",
    }),
  )

  await prisma.$disconnect()
}

main()
  .catch((e) => {
    console.error("seed-admin-user failed:", e)
    process.exit(1)
  })
  .finally(() => process.exit(0))
