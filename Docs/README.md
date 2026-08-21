# MarketMind AI documentation

This directory contains the maintained technical reference, product
architecture, operational runbooks, reviewed marketing knowledge, and dated
graduation-project evidence for MarketMind AI.

The implementation and shared contracts are authoritative. When a historical
planning document differs from current code, use the code and the documents in
`technical-and-ai-docs/`.

## Start here

| Need                                  | Document                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand the product journey        | [`planning/00_START_HERE.md`](planning/00_START_HERE.md)                                                                                       |
| See the system architecture           | [`technical-and-ai-docs/01_TECHNICAL_ARCHITECTURE_AND_SYSTEM_DESIGN.md`](technical-and-ai-docs/01_TECHNICAL_ARCHITECTURE_AND_SYSTEM_DESIGN.md) |
| Work with APIs, data, or deployment   | [`technical-and-ai-docs/02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md`](technical-and-ai-docs/02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md)               |
| Understand AI, RAG, and orchestration | [`technical-and-ai-docs/03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md`](technical-and-ai-docs/03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md)               |
| Inspect the database model            | [`technical-and-ai-docs/MARKETMIND_DATABASE_ERD.dbml`](technical-and-ai-docs/MARKETMIND_DATABASE_ERD.dbml)                                     |
| Import the API collection             | [`api/postman/marketmind-ai.postman_collection.json`](api/postman/marketmind-ai.postman_collection.json)                                       |

## Directory map

| Directory                | Purpose                                                                  | Status                                  |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| `technical-and-ai-docs/` | Current architecture, API/database/deployment, AI/RAG, and ERD reference | Maintained                              |
| `planning/`              | Product flow plus durable feature architectures and runbooks             | Maintained where linked from this index |
| `marketing-knowledge/`   | Reviewed, versioned Strategy RAG corpus and governance metadata          | Runtime data; path-stable               |
| `security-privacy/`      | Dated security, privacy, testing, and roadmap evidence                   | Point-in-time audit                     |
| `reports/`               | Required course-application evidence                                     | Submission artifact                     |
| `api/postman/`           | API exploration collection                                               | Maintained utility                      |
| `design/`                | Design-token previews and reference material                             | Maintained utility                      |

## Durable feature references

- [Discovery → Strategy → Content → Publish → Improve flow](planning/02_MARKETMIND_AI_FLOW.md)
- [AI roles and deterministic publishing boundary](planning/03_AGENTS_OVERVIEW.md)
- [Strategy and curated RAG architecture](planning/sprint-4/STRATEGY_AGENT_AND_CURATED_RAG_ARCHITECTURE.md)
- [Strategy completion runbook](planning/sprint-4/STRATEGY_COMPLETION_RUNBOOK.md)
- [Content lifecycle and publishing handoff](planning/sprint-5/CONTENT_AGENT_AND_AUTOMATION_HANDOFF_ARCHITECTURE.md)
- [Deterministic publishing architecture](planning/sprint-5/PUBLISHING_AUTOMATION_ARCHITECTURE.md)
- [Points-wallet billing model](planning/sprint-7/billing-points-model.md)
- [Facebook performance and owner-approved optimization](planning/sprint-8/FACEBOOK_PERFORMANCE_AND_OPTIMIZATION_ARCHITECTURE.md)
- [Feature-flagged agentic orchestration](planning/08_AGENTIC_ORCHESTRATION_IMPLEMENTATION_PLAN.md)

## Documentation rules

- Do not describe mock, fixture, or simulated behavior as live provider proof.
- Keep owner approval boundaries explicit for Strategy, Content, publishing,
  billing, and Optimization.
- Keep `marketing-knowledge/` at its current path; ingestion and validation
  tooling consumes it directly.
- Date point-in-time audits and state their evidence baseline.
- Remove completed one-off implementation plans once durable architecture or
  code has replaced them; Git history remains the archive.
