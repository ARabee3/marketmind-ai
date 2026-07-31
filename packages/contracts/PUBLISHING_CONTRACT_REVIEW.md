# Publishing v1 Contract Freeze Review Checklist

Issue #118 closes only after the required people confirm the frozen boundary in
GitHub. This file records what must be reviewed and the automated evidence; it
must not claim a person's approval before their actual review or issue comment.

## Artifacts

- `PUBLISHING_CONTRACT.md` — normative freeze, authority, lifecycle, security,
  idempotency, and compatibility rules.
- `src/publishing/*` — TypeScript surfaces and deterministic runtime policy.
- `examples/publication-*` and `examples/publishing-*` — entity, approval,
  result, stale, tampered, and outcome-confusion fixtures.
- `infra/n8n/fixtures/*` — actual signed dispatch/callback shapes and invalid
  authentication/replay cases.
- `scripts/validate-publishing-contracts.ts` — shared workflow and cross-object
  validation.
- `schema-snapshots/publishing-v1.snapshot.json` — backward compatibility.
- `type-tests/*` — API/CommonJS and Web/bundler consumer probes.

## Required reviewers

| Reviewer                     | Required checkpoint                                                           | Representative fixture                                     | Evidence command                                                        | Status  | Date / GitHub evidence |
| ---------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------- | ---------------------- |
| Ahmed (`ARabee3`)            | Publishing owner: lifecycle, exact approval, outcomes, canonical security     | `publication-approval-real.example.json`                   | `npm --workspace @marketmind/contracts run check:publishing`            | pending |                        |
| Abdulazim (`abdulazimRabie`) | n8n owner: signed dispatch/callback, routing authority, nonce/replay behavior | `infra/n8n/fixtures/publishing-dispatch-real.example.json` | `npm --workspace @marketmind/contracts run check:publishing`            | pending |                        |
| Gerges (`GergesYoussef-hub`) | API owner: persistence identities, versions, attempts, callback conflicts     | `publication-attempt-running.example.json`                 | `npm --workspace @marketmind/contracts run check:consumers`             | pending |                        |
| Merzek (`mostafamerzk`)      | Content owner: candidate bytes/checksum/status and no-mutation handoff        | `publication-candidate-approved.example.json`              | `npm --workspace @marketmind/contracts run check:publication-candidate` | pending |                        |

## Automated gates

```bash
npm --workspace @marketmind/contracts run check
npm --workspace @marketmind/api run typecheck
npm --workspace @marketmind/web run typecheck
npm run check
```

The publishing check must reject unapproved, tampered, and revoked candidates;
stale or mismatched approval; missing/invalid signature; expired timestamp;
replayed nonce; conflicting callback; unlabeled simulation; mode/outcome
confusion; and blind retry of an unknown provider outcome.

## Approval rule

Keep a row `pending` until that person leaves an actual GitHub approval or
checkpoint comment. Before merge, link the PR review/comment in the final
column. Do not self-approve on behalf of another owner. Once all rows are backed
by GitHub evidence and all automated gates pass, issue #118 may close and issues
#119–#122 may implement against the frozen V1 boundary.
