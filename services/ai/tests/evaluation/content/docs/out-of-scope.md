# Out-of-Scope Notes

This document records what the #109 Content evaluation harness deliberately does
**not** cover, and why. Items here are tracked follow-ups, not silently
abandoned scope. They belong to the owning issue (#107 / future issues), not to
#109.

## Hard-guardrail gap: pillar mismatch fixture

- There is **no frozen** `content-pillar-mismatch.invalid.json` in the #107 set.
- The frozen `content-trace-channel-mismatch.invalid.json` covers trace channel
  mismatch but **not** pillar mismatch.
- The harness covers pillar mismatch via a **Phase 4 deterministic validator**
  (`wrong_pillar`) against an inline mutation of
  `content-pack-week-1-ar.example.json`, so the behaviour is still enforced.
- Authoring a new frozen fixture belongs to #107, not #109.

## Prompt injection

- There is no frozen fixture with an embedded injection inside
  `week_context.must_include` / `must_avoid` / `cta_destination`.
- The harness covers prompt injection via a **Phase 4 deterministic validator**
  (`prompt_injection`) using inline, clearly-labeled synthetic injection text in
  the case's `protected_fictional_fields.owner_text`. It is (eval-only synthetic
  text, never real business data).

## #107 follow-up items (frozen-contract work tracked in issue #139)

The eval harness originally covered the following behaviours via existing frozen
paths, but the dedicated `content-v1` contract / package changes belong to a
follow-up issue (#139, parent #106, label `sprint-5`, assignee `@mostafamerzk`),
not to #109:

- **`health_claim` claim_type + blocked code.** The health/clinical-claim
  mutation case (`mutation-health-claim`) now uses a distinct `health_claim`
  claim_type and fires `CONTENT_POLICY_VIOLATION` through the blocked
  `health_claim` code (contract + Python mirror updated, dataset regenerated).
- **`platform-constraints.ts` + `platform_constraint` warnings.** A shared
  `platform-constraints` vocabulary (TS + Python mirror) now validates
  per-platform caption/hashtag/alt-text limits as advisory warnings
  (`platform_constraints` check), never hard blockers.
- **`review_required` asset flag.** `generated_static` assets now carry
  `review_required=True` (set explicitly by the image provider); the harness
  enforces this with the `review_required` deterministic check.
- **Publishing timing hints.** `ContentRecommendedWindow` carries
  `day_preference`, `time_of_day_hint`, and `rationale`; the producer is
  instructed to explain the chosen window.
- **Arabic dialect + brand voice.** `ContentCaptionVariant.dialect` plus a
  `voice_examples` input on the generate request guide a consistent,
  brand-appropriate Arabic voice.
- **Funnel-stage mapping.** `strategy_trace` carries `funnel_stage` and
  `content_purpose`; the `funnel_mix` advisory uses them for balance.

All six items and their dependent eval assertions are tracked in #139.

## What the harness never evaluates

The following are permanent out-of-scope boundaries of this eval harness:

- **No live publishing.** This harness validates contract behaviour and
  guardrail enforcement only. It never publishes, schedules, or measures live
  engagement. Publication automation is owned by the Sprint 5 Automation
  team (n8n boundary), not by #109.
- **No publication-candidate failure categories.** The `candidate_tampered` and
  `candidate_revoked` failure categories belong to the `publishing-v1` contract
  (#118) and can only be exercised after a content candidate is approved and
  handed off. The content eval harness stops before that boundary.
- **No LLM/paid provider in CI.** The deterministic path uses
  `FakeContentProvider` modes with zero network. Real-provider comparison is
  opt-in and manual (Phase 6), gated by `MARKETMIND_CONTENT_REAL_PROVIDER=1`.
- **No subjective quality judgment by a model.** The rubric is human-scored by
  named reviewers; the model never scores its own output.
- **No real business/competitor data.** Every case is synthetic and fictional.
- **No reimplementation of #107 safety rules.** The harness reuses the frozen
  `validate_content_policy_fixture`; it never duplicates safety logic that the
  frozen contract already owns.

## Explicit non-goals (do not add later)

- An `AuditModule`. (Sprint 1 anti-pattern; not part of this harness.)
- Terraform / infrastructure / deployment concerns.
- Paid ad automation or multiple third-party social platforms.

All of these are recorded so a future reader understands why a behaviour is
absent: because it is out of scope for #109, not because it was forgotten.