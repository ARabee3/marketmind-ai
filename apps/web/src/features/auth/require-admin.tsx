"use client"

import { useEffect, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { useSession } from "@/features/auth/session-provider"

export function RequireAdmin({ children }: { children: ReactNode }) {
  const t = useTranslations("Common")
  const { isLoading, isAuthenticated, user } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace("/login")
      return
    }
    if (!user?.roles?.includes("ADMIN")) {
      router.replace("/dashboard")
    }
  }, [isLoading, isAuthenticated, user, router])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">{t("loading")}</p>
      </div>
    )
  }

  if (!isAuthenticated || !user?.roles?.includes("ADMIN")) {
    return null
  }

  return children
}
