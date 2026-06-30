# IntelligenceGatherer Integration Fix Plan

This plan documents the hardening work needed around the current Prepared
Discovery and `IntelligenceGatherer` integration. It is intended for the team to
continue implementation and review without depending on private planning notes.

## Scope

This plan covers the Discovery-side integration issues found after moving the
smart-searcher learning into MarketMind. It does not cover smart-searcher
retirement, frontend screens, or future Research Agent extraction.

Keep the implementation inside the current Sprint 1 boundaries:

- NestJS remains the public API boundary.
- FastAPI remains the internal AI service boundary.
- PostgreSQL remains the source of truth.
- Qdrant remains reserved for later retrieval work.
- `IntelligenceGatherer` remains an internal helper inside `DiscoveryModule`.

## Required Fixes

### 1. Owner Link Metadata Safety

Owner-submitted links must be treated as untrusted input.

Implementation requirements:

- Fetch only `http` and `https` URLs.
- Reject localhost, loopback, link-local, private IPv4 ranges, and private IPv6
  ranges before calling `fetch`.
- Validate redirect targets with the same rule.
- Cap metadata response size to a small bounded value.
- Preserve the submitted link as a failed metadata source when extraction fails.

Verification:

- A private URL such as `http://127.0.0.1/admin` must not call `fetch`.
- Oversized metadata responses must fail with a clear error.
- Valid owner links must still extract title and description.

### 2. AI Safe Failure Handling

The Discovery chat must not treat an AI `safe_failure` response as a normal
`in_progress` turn.

Implementation requirements:

- If the AI service returns `safe_error`, throw a provider error from the NestJS
  conversation service.
- Do not append an assistant message for that failed turn.
- Do not update the conversation state as successful.
- Keep the owner message if it was already stored, so the owner input is not
  lost.

Verification:

- Successful chat responses still append the assistant question and keep the
  session `in_progress`.
- Safe failures reject with the provider error code and do not update the
  conversation state.

### 3. Search Provider Warning Visibility

Search fallback must be visible to the caller and progress stream.

Implementation requirements:

- `SearchClientService.search()` should return both `results` and
  `provider_warnings`.
- Provider warnings must include code, message, and retryability.
- Successful fallback results remain usable.
- If all providers fail or return empty results after a provider error, the final
  intelligence result should include a safe provider error instead of only a
  generic knowledge gap.
- Search progress payloads should include warnings for visibility.

Verification:

- SerpApi and Apify failures are visible when DuckDuckGo fallback succeeds.
- Empty fallback after provider errors produces a safe error in the intelligence
  result.

### 4. Request Validation and Throttling

Discovery endpoints receive owner-controlled text and links, so the public DTOs
must have explicit limits.

Implementation requirements:

- Cap business names, business types, city/area/address, owner goals, notes,
  competitors, target audience, social links, and chat messages.
- Limit the number of social links accepted in one intake.
- Require social links to use explicit `http` or `https` URLs.
- Keep global validation strict with whitelisting and rejection of unknown
  fields.
- Add a simple per-owner POST rate guard for Sprint 1.

Production note:

- The current rate guard may be process-local for Sprint 1. Before running
  multiple API instances, replace it with Redis-backed or gateway-level
  throttling so limits are shared across instances.

Verification:

- Overlong text and too many social links are rejected by DTO validation.
- Non-HTTP social links are rejected.
- Excessive Discovery POST requests return HTTP 429 behavior.

### 5. AI Contract Array Preservation

The NestJS AI client must not drop valid research data returned by FastAPI.

Implementation requirements:

- Preserve valid `source_refs` returned by AI discovery endpoints.
- Preserve valid `research_observations` returned by AI discovery endpoints.
- Keep missing arrays as empty arrays for backward compatibility.
- Filter invalid entries or reject unusable top-level AI output.

Verification:

- A FastAPI response containing one source and one linked observation survives
  the NestJS parser.
- Existing start/respond/summarize request payloads remain unchanged.

### 6. External Timeout Safety

Invalid environment timeout values must not break provider calls.

Implementation requirements:

- Parse `DISCOVERY_SEARCH_TIMEOUT_MS` as a positive integer.
- Fall back to `8000` for missing, non-numeric, zero, or negative values.
- Defensively apply the same fallback before calling `AbortSignal.timeout`.

Verification:

- Valid timeout env values are honored.
- `abc`, `0`, and `-1` fall back safely and do not throw range errors.

### 7. Source URL Deduplication

Duplicate source URLs inside one intelligence run should not create duplicate
database rows.

Implementation requirements:

- Deduplicate source refs by normalized URL within one run.
- Map duplicate contract source IDs to the first saved database source ID.
- Keep observations linked to the saved source.
- Do not add a database uniqueness migration yet; cross-run uniqueness is a
  product decision.

Verification:

- Duplicate URLs create one `SourceRef` row in one run.
- Observations linked to duplicate contract source IDs point to the first saved
  row.

## Suggested Implementation Order

1. Add failing Jest tests for the seven areas above.
2. Fix shared HTTP timeout and external text-fetch behavior.
3. Fix provider warning propagation and intelligence mapping.
4. Fix chat safe-failure handling.
5. Fix AI parser preservation.
6. Fix repository-level source dedupe.
7. Tighten DTO validation and the Sprint 1 rate guard.
8. Run focused API tests.
9. Run full API tests and build.
10. Push the branch for team review.

## Done Criteria

The work is ready for review when:

- Focused tests for every required fix pass.
- Full `@marketmind/api` tests pass.
- `@marketmind/api` build passes.
- No secrets are added to source control.
- The branch is pushed and review notes call out any remaining production
  caveats, especially process-local throttling.
