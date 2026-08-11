import type { useTranslations } from "next-intl"

export type AdminTranslator = ReturnType<typeof useTranslations>

type Translator = AdminTranslator

export function adminRoleLabel(role: string, t: Translator): string {
  switch (role) {
    case "ADMIN":
      return t("roleAdmin")
    case "OWNER":
      return t("roleOwner")
    case "DEVELOPER_DEMO":
      return t("roleDeveloperDemo")
    default:
      return role
  }
}

export function adminStatusLabel(status: string, t: Translator): string {
  switch (status) {
    case "active":
      return t("active")
    case "draft":
      return t("draft")
    case "inactive":
      return t("inactive")
    case "suspended":
      return t("suspended")
    case "trialing":
      return t("trialing")
    case "past_due":
      return t("pastDue")
    case "expired":
      return t("expired")
    default:
      return status
  }
}

export function adminLoginMethodLabel(method: string, t: Translator): string {
  return method
    .split(",")
    .map((value) => {
      switch (value.trim()) {
        case "password":
          return t("loginPassword")
        case "google":
          return t("loginGoogle")
        default:
          return value.trim()
      }
    })
    .join(", ")
}

export function adminIntervalLabel(interval: string, t: Translator): string {
  switch (interval) {
    case "monthly":
      return t("intervalMonthly")
    case "yearly":
      return t("intervalYearly")
    case "trial":
      return t("intervalTrial")
    case "founding_pilot":
      return t("intervalFoundingPilot")
    default:
      return interval
  }
}
