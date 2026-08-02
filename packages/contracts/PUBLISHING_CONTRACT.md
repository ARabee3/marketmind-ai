# Publishing v1 Frozen Contract

**Issue:** [#118](https://github.com/ARabee3/marketmind-ai/issues/118)

**Parent:** [#117](https://github.com/ARabee3/marketmind-ai/issues/117)

**Content dependency:** [#107](https://github.com/ARabee3/marketmind-ai/issues/107)
**Canonical implementation:** `packages/contracts/src/publishing/`

## Freeze rule

The TypeScript exports, runtime policies, fixtures, and schema snapshot in this
package are the normative `publishing-v1` boundary. API, Web, BullMQ, n8n, and
provider adapters may add internal fields, but they must not weaken, reinterpret,
or mutate these shapes.

After issue #118 closes, removing a field, changing its meaning, widening an
authority boundary, changing canonical serialization, or changing a lifecycle
rule requires a new contract version. Additive optional fields also require the
normal cross-team contract review because workflow consumers reject unknown
frozen-envelope fields.

## Frozen surfaces

| Surface         | Contract version                                                  | Purpose                                                                  |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Content handoff | `publication-candidate-v1` plus `publication-candidate-status-v1` | Immutable approved content and separately versioned active/revoked state |
| Target          | `publishing-target-v1`                                            | Server-side provider target and capability snapshot                      |
| Intent          | `publication-intent-v1`                                           | Owner's versioned plan for one candidate                                 |
| Real approval   | `publication-approval-v1`                                         | Exact immutable approval of one external action                          |
| Attempt         | `publication-attempt-v1`                                          | One idempotent execution attempt under an intent version                 |
| Result          | `publication-result-v1`                                           | One normalized truthful outcome                                          |
| Dispatch body   | `publication-dispatch-v1`                                         | Exact operation sent to the workflow                                     |
| Signed dispatch | `publishing-dispatch-envelope-v1`                                 | Authenticated API-to-n8n boundary                                        |
| Callback body   | `publication-callback-v1`                                         | Result bound to an accepted attempt/request                              |
| Signed callback | `publishing-callback-envelope-v1`                                 | Authenticated n8n-to-API boundary                                        |

`PublishingTargetPublicV1` is the browser-safe target projection. It deliberately
excludes `credential_ref`. No access token, provider secret, signed asset URL, or
webhook secret belongs in a public response or committed fixture.

## Authority boundary

- Content alone creates the immutable candidate and its checksum.
- The owner alone chooses mode, target, schedule, and real-publication approval.
- NestJS/PostgreSQL alone owns product state, idempotency records, and results.
- BullMQ owns due-time delivery; delivery is at least once.
- n8n validates and executes the exact signed body. It cannot rewrite content,
  choose a target/time/mode, approve an action, or write product state.
- Provider adapters normalize evidence. They cannot convert uncertainty into
  success.
- No LLM or AI node exists in the publishing decision or execution path.

## Content checkpoint

The valid handoff is the exact checked-in
`publication-candidate-approved.example.json` payload with checksum:

```text
b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443
```

Publishing accepts it only with the matching active
`publication-candidate-status-v1` snapshot. The same boundary rejects the
checked-in unapproved, tampered, and revoked fixtures. Candidate status changes
advance by `state_version` and never mutate checksum-covered candidate bytes.

`reducePublicationCandidateEventV1` is the executable intake rule. It stores
the immutable candidate payload together with the complete latest status and
event fingerprint. A newer status is applied, an exact same-version replay is a
no-op, a lower version is rejected as stale, and different bytes at the same
version are rejected as a state conflict. `validatePublicationDispatchContext`
requires that authoritative record, so an active v1 snapshot cannot execute
after a stored revoked or replaced v2 status.

Every candidate and dispatch asset checksum is a 64-character lowercase
SHA-256 digest. Matching metadata is not sufficient: after retrieval and before
any adapter call, the workflow must run
`validateRetrievedPublicationAssetsV1` against the actual bytes. The canonical
fixture bytes are the UTF-8 bytes declared by `canonical_asset_bytes_utf8` in
the workflow manifest.

## Intent lifecycle

```text
real:
  draft -> awaiting_approval -> scheduled -> dispatching
       -> succeeded | failed | action_required

manual_export / simulation:
  draft -> dispatching -> succeeded | failed

draft | awaiting_approval | scheduled -> cancelled
failed | action_required -> dispatching (explicit eligible retry/reconcile)
```

`succeeded` and `cancelled` are terminal. A retry creates a new attempt under
the same logical intent; it does not create another active intent for the
candidate.

Real intents outside an initial empty draft carry one complete tuple:

- connected `target_id`;
- local time with seconds but no offset;
- `time_zone = Africa/Cairo`; and
- normalized ISO `scheduled_utc`.

Export and simulation carry no provider target, provider schedule, or
real-publication approval.

## Exact real-publication approval

Content approval is not publication approval. `PublicationApprovalSnapshotV1`
binds all of these exact values:

- decision, intent, and intent version;
- candidate ID and candidate checksum;
- `mode = real`;
- target ID;
- Cairo-local time;
- `Africa/Cairo`;
- normalized UTC instant;
- deciding owner and decision time; and
- `approval_fingerprint` over the complete snapshot except the fingerprint.

Changing candidate identity/checksum, mode, target, local time, time zone, or
UTC instant is material. The API increments the intent version, clears the old
approval, cancels/replaces the old delayed-job identity, and returns a real
intent to `awaiting_approval`. Stale approval or client intent versions return
`PUBLISHING_STATE_CONFLICT`.

Manual export and simulation are explicit owner actions without a real external
side effect, so they do not use `publication-approval-v1`.

## Attempts, results, and truthful labels

The six outcomes are mutually exclusive:

| Outcome     | Meaning                                                    | Required proof                                                                  |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `published` | Meta confirmed one real publication                        | Provider is `meta` and a real remote publication ID exists                      |
| `exported`  | A checksum-addressed archive was generated                 | Export artifact ID exists; no provider/remote ID exists                         |
| `simulated` | Deterministic no-network simulation completed              | `SIMULATION` label and simulation reference exist; no provider/remote ID exists |
| `failed`    | A proven sanitized failure occurred                        | Stable non-unknown error code; no success artifact exists                       |
| `cancelled` | Execution was cancelled without success                    | No provider, remote ID, export artifact, or success claim exists                |
| `unknown`   | A real request may have been accepted but cannot be proven | Meta mode, unknown error, `retryable = false`, reconciliation required          |

An ambiguous timeout after a possible provider send is always `unknown`. It is
never changed to `failed`, automatically retried, or displayed as published.

## Canonical JSON, fingerprints, and signatures

Publishing canonical JSON uses these frozen rules:

1. UTF-8 JSON with no extra whitespace.
2. Object keys sorted lexicographically at every depth.
3. Array order preserved.
4. `undefined` object fields omitted; all remaining values must be finite JSON
   values.
5. SHA-256 and HMAC values encoded as lowercase hexadecimal.

An envelope stores `body_sha256 = SHA256(canonical(body))`. Its signature input
is exactly these five newline-separated lines:

```text
hmac-sha256
<envelope contract_version>
<sent_at>
<nonce>
<body_sha256>
```

`signature = HMAC-SHA256(secret, signature_input)`. The receiver verifies the
canonical body hash and signature with constant-time comparison, requires a
known `key_id`, accepts a timestamp within 300 seconds, and atomically consumes
the nonce before any adapter or state mutation. TLS is required outside local
development.

The public fixture secret proves deterministic signatures only. It is not a
deployable credential.

## Idempotency and version matrix

| Boundary                      | Identity/version rule                                               | Identical replay                | Conflicting replay                                  |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| Candidate created event       | `event_id`, candidate ID, checksum, canonical event fingerprint     | Return existing inbox record    | `PUBLISHING_CANDIDATE_TAMPERED`                     |
| Candidate status event        | candidate ID plus strictly increasing `state_version`               | No-op                           | Reject stale or same-version conflict               |
| Connect target                | client `idempotency_key` plus canonical request fingerprint         | Return existing connection flow | `PUBLISHING_IDEMPOTENCY_CONFLICT`                   |
| Verify/disconnect target      | `expected_target_version` plus `idempotency_key`                    | Return existing mutation result | `PUBLISHING_STATE_CONFLICT`                         |
| Create intent                 | client `idempotency_key` plus canonical request fingerprint         | Return existing intent          | `PUBLISHING_IDEMPOTENCY_CONFLICT`                   |
| Schedule/approve/cancel/retry | `expected_intent_version` plus `idempotency_key`                    | Return existing mutation result | `PUBLISHING_STATE_CONFLICT` or idempotency conflict |
| Delayed queue job             | `publishing:intent:<intent_id>:v<intent_version>`                   | Reuse/no-op                     | Reject stale job                                    |
| Attempt                       | `publishing:<intent_id>:v<version>:attempt:<number>`                | Reuse attempt                   | `PUBLISHING_IDEMPOTENCY_CONFLICT`                   |
| Dispatch                      | message ID, attempt ID, idempotency key, canonical body fingerprint | Reuse accepted attempt/no-op    | Reject before adapter execution                     |
| Nonce                         | `(key_id, nonce)` within the replay window                          | Reject replay                   | Reject replay                                       |
| Callback                      | callback ID plus canonical callback fingerprint                     | Return stored immutable result  | `PUBLISHING_CALLBACK_CONFLICT`                      |
| Confirmed real publication    | one successful real result per intent/candidate                     | Return existing result          | `PUBLISHING_DUPLICATE_DISPATCH`                     |

There is no exactly-once claim. At-least-once transport plus these identities
prevents duplicate confirmed publication.

## Stable errors

The authoritative set is `PUBLISHING_ERROR_CODES` in
`publishing-types.ts`. It covers unsupported contracts; candidate, target,
format, asset, schedule, approval, state and idempotency failures; webhook
signature/timestamp/nonce failures; provider rate limit/failure/unknown; and
callback invalid/conflict behavior. Errors expose sanitized details only.

## Frozen public and internal route intent

```text
GET  /api/v1/publication-candidates
GET  /api/v1/publication-candidates/:candidateId
GET  /api/v1/publishing-targets
POST /api/v1/publishing-targets/meta/connect
POST /api/v1/publishing-targets/meta/callback
POST /api/v1/publishing-targets/:targetId/verify
DELETE /api/v1/publishing-targets/:targetId
POST /api/v1/publication-intents
GET  /api/v1/publication-intents
GET  /api/v1/publication-intents/:intentId
PUT  /api/v1/publication-intents/:intentId/schedule
POST /api/v1/publication-intents/:intentId/decisions
POST /api/v1/publication-intents/:intentId/cancel
POST /api/v1/publication-intents/:intentId/retry
GET  /api/v1/publication-intents/:intentId/attempts
GET  /api/v1/publication-intents/:intentId/export

POST /internal/v1/publishing/dispatch/:attemptId/callback
GET  /internal/v1/publishing/assets/:assetId
```

Internal routes require service authentication and are not authorized by an
owner browser session alone.

## Fixtures and verification

- Core fixtures live in `packages/contracts/examples/`.
- Actual signed workflow fixtures and their manifest live in
  `infra/n8n/fixtures/`.
- The workflow manifest references the original Content fixtures instead of
  copying them.
- The publishing check proves that a separately re-signed n8n candidate copy
  still fails when it drifts from those canonical Content fixtures.
- The publishing check hashes canonical retrieved bytes and rejects mismatched
  bytes before execution.
- `publishing-v1.snapshot.json` freezes required fields.
- API-style and Web-style compiler probes live in `type-tests/`.

Run:

```bash
npm --workspace @marketmind/contracts run check:publishing
npm --workspace @marketmind/contracts run check:consumers
npm --workspace @marketmind/contracts run check:snapshot
npm --workspace @marketmind/contracts run check
```

The human checkpoint is recorded separately in
`PUBLISHING_CONTRACT_REVIEW.md`. Automated evidence never substitutes for the
required Content and Automation owner approvals.
