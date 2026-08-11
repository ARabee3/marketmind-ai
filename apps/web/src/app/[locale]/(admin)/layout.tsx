import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { AdminShell } from "@/components/layout/admin-shell"
import { RequireAdmin } from "@/features/auth/require-admin"

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const t = await getTranslations("Common")

  return (
    <RequireAdmin>
      <AdminShell brandName={t("appName")}>{children}</AdminShell>
    </RequireAdmin>
  )
}
