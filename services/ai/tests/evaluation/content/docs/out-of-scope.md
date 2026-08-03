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

## #107 follow-up items (frozen-contract work deferred to a new issue)

The eval harness covers the following behaviours today via existing frozen
paths, but a dedicated frozen-contract change belongs to a new follow-up issue
(parent #106, label `sprint-5`, assignee `@mostafamerzk`), not to #109:

- **`health_claim` claim_type + blocked code.** The health/clinical-claim
  mutation case (`mutation-health-claim`) fires `CONTENT_POLICY_VIOLATION`
  through the frozen `regulated` path. A distinct `health_claim` claim_type and
  its own blocked error code would need a `content-v1` contract change, which is
  deferred because the contract is frozen (#107 closed).
- **`platform-constraints.ts` + `platform_constraint` warnings.** The harness
  validates channels against the approved Strategy (`CONTENT_CHANNEL_MISMATCH`)
  but has no per-platform constraint vocabulary (e.g. Instagram link-in-bio
  limitations). That belongs to a contract/package change in the follow-up.
- **`review_required` asset flag.** Asset readiness is checked via
  `CONTENT_ASSET_REQUIRED` and the Phase 5 asset-state checks; a first-class
  `review_required` flag on assets/items is a follow-up contract item.

These items and their dependent eval assertions are tracked in the new issue
and will be added when the frozen contract surface is updated.

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