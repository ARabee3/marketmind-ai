## Owner and reviewers

- **Owner:** @MostafaAhmed22
- **Required reviewers:** @ARabee3 and @mostafamerzk
- **Implementation reviewers:** @GergesYoussef-hub, @MOKHXXXXXX, and @abdulazimRabie

## Goal

Prove that curated RAG improves Strategy grounding and that invalid, expired, incompatible, or missing knowledge produces visible safe behavior.

## Dependencies

- #67 contracts;
- #68 reviewed knowledge pack;
- #71 ingestion;
- #72 retrieval;
- #73 deterministic validators;
- grounded generation implementation.

## In scope

At least 25 human-reviewed cases across retail, hospitality, services, education, and healthcare; Arabic, English, and mixed language; varied objective, budget mode, channel availability, team capacity, paid-media permission, missing knowledge, expired knowledge, and conflicting tags.

Evaluate:

- expected-source retrieval in top five;
- hard-filter correctness;
- citation resolution and evidence compatibility;
- numeric benchmark grounding;
- visible empty-result/knowledge-gap behavior;
- Business Profile privacy boundary;
- RAG generation versus the same controlled case without retrieved knowledge;
- retrieval latency, embedding cost where applicable, top-k hit rate, empty-result rate, gaps, citation failures, approval/revision signals.

## Out of scope

- claiming the internal test set is a universal marketing benchmark;
- changing production thresholds to hide failures;
- evaluating live platform performance or real business sales;
- using private customer data;
- requiring paid provider calls in normal CI.

## Deliverables

- versioned evaluation dataset and expected outcomes;
- deterministic runner and machine-readable report;
- retrieval and end-to-end grounding metrics;
- comparison report for RAG versus no-RAG controlled runs;
- failure-case report and documented follow-up threshold;
- CI smoke subset plus documented full-suite command.

## Minimum acceptance targets

- expected relevant source appears in top five for at least 80% of curated queries;
- no unapproved, retired, expired, future-effective, or incompatible hard-filter result passes;
- 100% of numeric benchmark claims cite a current compatible `verified_benchmark`;
- every citation resolves to the persisted retrieval pack and PostgreSQL source;
- retrieval failure and empty results never produce unsupported claims;
- no Business Profile is stored in shared Qdrant;
- human-reviewed comparison cases show the RAG plan is more grounded and traceable than the no-RAG generation.

## Suggested implementation steps

1. Freeze evaluation schema and case-review checklist.
2. Build coverage matrix before writing cases.
3. Add expected source IDs and forbidden result IDs.
4. Add retrieval-only runner with deterministic embeddings where possible.
5. Add structured generation/grounding checks using fake fixtures, with optional provider evaluation outside CI.
6. Add RAG/no-RAG comparison rubric.
7. Produce summary and per-case diagnostics.
8. Review failures; do not silently remove difficult cases.

## Acceptance criteria

- [x] At least 25 cases cover all required sectors and language modes.
- [ ] Acceptance metrics are calculated from versioned, reviewable data.
- [ ] Hard-filter violations fail the suite immediately.
- [ ] The top-five target is reported honestly with failed cases.
- [ ] Empty and failed retrieval behaviors are explicitly evaluated.
- [ ] Numeric claims and citations have deterministic validation.
- [ ] The suite can run without external provider cost in CI.
- [ ] The report identifies corpus, retrieval, rule, prompt, and contract failure categories separately.

## Test and verification plan

- test the evaluator itself with known pass/fail fixtures;
- repeat-run determinism checks;
- mutation cases that deliberately expire or unapprove expected sources;
- Arabic and mixed-language encoding checks;
- privacy scan of Qdrant payload fixtures;
- manual review sampling by Ahmed and Merzek.

## Review checklist

- [ ] Cases are representative of the Sprint 4 scope, not cherry-picked demos.
- [ ] Internal targets are not marketed as external facts.
- [ ] Failures remain visible and actionable.
- [ ] Evaluation never requires private production data.
- [ ] RAG value is measured as grounding/traceability, not merely longer output.

## AI assistance rules

AI coding tools may assist, but the named owner must understand the generated code and UX, remove invented dependencies or APIs, test failure paths, and explain the result in review. Generated claims, citations, or approval decisions must never be accepted without the required deterministic and human checks.

## Related docs

- Parent: #66
- `Docs/planning/sprint-4/STRATEGY_AGENT_TEAM_GUIDE.md`
- `Docs/planning/sprint-4/STRATEGY_AGENT_AND_CURATED_RAG_ARCHITECTURE.md`
- `Docs/planning/02_MARKETMIND_AI_FLOW.md`
- `Docs/planning/05_TEAM_OPERATING_SYSTEM.md`

## Marketingskills adaptation evaluation requirements

The evaluation suite must verify that any `marketingskills`-derived patterns improve structure and grounding without importing SaaS/US bias into MarketMind.

Add evaluation coverage for:

- prompts using the adapted pattern set versus prompts without it, judged on traceability, completeness, and owner usefulness;
- rejection or downgrade of unlocalized SaaS/B2B assumptions such as ARR, CAC, funding-stage budgets, LinkedIn-first channel logic, or large marketing teams;
- Arabic-first and mixed-language cases where the plan must use Egyptian SME wording rather than translated SaaS language;
- retrieval packs that include only MarketMind-reviewed playbooks, proving no raw external skill file is retrieved;
- citations that resolve only to approved MarketMind knowledge entries or verified benchmarks, never to the raw external repo;
- failure diagnostics that separate corpus gaps, localization gaps, prompt-pattern leakage, and deterministic-rule violations.

The report should explicitly answer: did the adapted patterns make the Strategy more usable for Egyptian SMEs, or did they add generic framework noise?

