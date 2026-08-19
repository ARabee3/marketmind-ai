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

export function publishingOutcomeLabel(outcome: string, t: Translator): string {
  switch (outcome) {
    case "UNKNOWN":
      return t("outcomeUnknown")
    case "PUBLISHED":
      return t("outcomePublished")
    case "FAILED":
      return t("outcomeFailed")
    case "EXPORTED":
      return t("outcomeExported")
    case "SIMULATED":
      return t("outcomeSimulated")
    case "CANCELLED":
      return t("outcomeCancelled")
    default:
      return outcome
  }
}

export function publishingIntentStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "DRAFT":
      return t("intentDraft")
    case "AWAITING_APPROVAL":
      return t("intentAwaitingApproval")
    case "SCHEDULED":
      return t("intentScheduled")
    case "DISPATCHING":
      return t("intentDispatching")
    case "SUCCEEDED":
      return t("intentSucceeded")
    case "FAILED":
      return t("intentFailed")
    case "ACTION_REQUIRED":
      return t("intentActionRequired")
    case "CANCELLED":
      return t("intentCancelled")
    default:
      return status
  }
}

export function publishingAttemptStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "QUEUED":
      return t("attemptQueued")
    case "RUNNING":
      return t("attemptRunning")
    case "DISPATCHING":
      return t("attemptDispatching")
    case "SUCCEEDED":
      return t("attemptSucceeded")
    case "FAILED":
      return t("attemptFailed")
    case "UNKNOWN":
      return t("attemptUnknown")
    case "CANCELLED":
      return t("attemptCancelled")
    default:
      return status
  }
}

export function publishingModeLabel(mode: string, t: Translator): string {
  switch (mode) {
    case "REAL":
      return t("modeReal")
    case "MANUAL_EXPORT":
      return t("modeManualExport")
    case "SIMULATION":
      return t("modeSimulation")
    default:
      return mode
  }
}

export function publishingChannelLabel(
  channel: string,
  t: Translator,
): string {
  switch (channel) {
    case "facebook":
      return t("channelFacebook")
    case "instagram":
      return t("channelInstagram")
    default:
      return channel
  }
}

export function knowledgeKindLabel(kind: string, t: Translator): string {
  switch (kind) {
    case "framework":
      return t("kindFramework")
    case "objective_playbook":
      return t("kindObjectivePlaybook")
    case "channel_playbook":
      return t("kindChannelPlaybook")
    case "benchmark_report":
      return t("kindBenchmarkReport")
    case "content_strategy_playbook":
      return t("kindContentStrategyPlaybook")
    case "budget_playbook":
      return t("kindBudgetPlaybook")
    case "measurement_playbook":
      return t("kindMeasurementPlaybook")
    case "regional_guidance":
      return t("kindRegionalGuidance")
    case "sector_note":
      return t("kindSectorNote")
    case "policy":
      return t("kindPolicy")
    default:
      return kind
  }
}

export function knowledgeReviewStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "draft":
      return t("draft")
    case "approved":
      return t("approved")
    case "retired":
      return t("retired")
    case "expired":
      return t("expired")
    default:
      return status
  }
}

export function knowledgeLocaleLabel(locale: string, t: Translator): string {
  switch (locale) {
    case "en":
      return t("localeEn")
    case "ar-EG":
      return t("localeArEg")
    case "mixed":
      return t("localeMixed")
    default:
      return locale
  }
}

export function knowledgeEvidenceTierLabel(
  tier: string,
  t: Translator,
): string {
  switch (tier) {
    case "verified_benchmark":
      return t("tierVerifiedBenchmark")
    case "reviewed_guidance":
      return t("tierReviewedGuidance")
    case "contextual_note":
      return t("tierContextualNote")
    default:
      return tier
  }
}

export function ingestionRunStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "pending":
      return t("runPending")
    case "running":
      return t("runRunning")
    case "succeeded":
      return t("runSucceeded")
    case "partial_failure":
      return t("runPartialFailure")
    case "failed":
      return t("runFailed")
    default:
      return status
  }
}

export function billingAccountStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "active":
      return t("billingAccountActive")
    case "paused":
      return t("billingAccountPaused")
    default:
      return status
  }
}

export function billingCostAlertReasonLabel(
  reason: string,
  t: Translator,
): string {
  const match = reason.match(/^artifact_used_(\d+)_attempts$/)
  if (match) {
    return t("costAlertHighRetry", { count: match[1] })
  }
  switch (reason) {
    case "monthly_cost_exceeded_egp_50":
      return t("costAlertOverEgp50")
    default:
      return reason
  }
}

export function billingMismatchTypeLabel(
  type: string,
  t: Translator,
): string {
  switch (type) {
    case "succeeded_attempt_no_transaction":
      return t("mismatchAttemptNoTransaction")
    case "processed_event_no_transaction":
      return t("mismatchEventNoTransaction")
    case "transaction_no_event":
      return t("mismatchTransactionNoEvent")
    default:
      return type
  }
}

export function walletLedgerDirectionLabel(
  direction: string,
  t: Translator,
): string {
  switch (direction) {
    case "credit":
      return t("ledgerCredit")
    case "debit":
      return t("ledgerDebit")
    default:
      return direction
  }
}

export function walletLedgerReasonLabel(reason: string, t: Translator): string {
  switch (reason) {
    case "topup":
      return t("ledgerReasonTopup")
    case "trial_grant":
      return t("ledgerReasonTrialGrant")
    case "spend":
      return t("ledgerReasonSpend")
    case "refund":
      return t("ledgerReasonRefund")
    default:
      return reason
  }
}

export function walletTransactionKindLabel(
  kind: string,
  t: Translator,
): string {
  switch (kind) {
    case "charge":
      return t("transactionKindTopup")
    default:
      return kind
  }
}

export function walletTransactionStatusLabel(
  status: string,
  t: Translator,
): string {
  switch (status) {
    case "succeeded":
      return t("transactionStatusSucceeded")
    case "failed":
      return t("transactionStatusFailed")
    case "pending":
      return t("transactionStatusPending")
    default:
      return status
  }
}
