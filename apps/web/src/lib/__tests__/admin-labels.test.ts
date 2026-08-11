import { describe, expect, it } from "vitest"

import {
  adminIntervalLabel,
  adminLoginMethodLabel,
  adminRoleLabel,
  adminStatusLabel,
  type AdminTranslator,
} from "../admin-labels"

const t = ((key: string) => key) as unknown as AdminTranslator

describe("admin labels", () => {
  it("localizes roles and statuses through translation keys", () => {
    expect(adminRoleLabel("ADMIN", t)).toBe("roleAdmin")
    expect(adminRoleLabel("OWNER", t)).toBe("roleOwner")
    expect(adminStatusLabel("past_due", t)).toBe("pastDue")
  })

  it("localizes login methods and billing intervals", () => {
    expect(adminLoginMethodLabel("google, password", t)).toBe(
      "loginGoogle, loginPassword",
    )
    expect(adminIntervalLabel("yearly", t)).toBe("intervalYearly")
  })
})
