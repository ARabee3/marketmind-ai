# Technology stack

| Layer             | Technology                                               | Responsibility                                                                       |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Web               | Next.js 16, React, TypeScript, Tailwind CSS, next-intl   | Arabic/English owner experience, RTL, review and approval workflows                  |
| API               | NestJS 11, TypeScript, Prisma                            | Auth, RBAC, billing, queues, lifecycle state, approvals, publishing, and performance |
| AI service        | FastAPI, Python 3.12, Pydantic, LangGraph                | Discovery, Strategy, Content, Optimization, validation, and gated orchestration      |
| Primary data      | PostgreSQL 16                                            | Durable product and governance source of truth                                       |
| Jobs/cache        | Redis 7, BullMQ                                          | Recoverable asynchronous work and scheduling                                         |
| Retrieval         | Qdrant                                                   | Rebuildable vector index of approved marketing knowledge                             |
| Automation        | n8n                                                      | Deterministic publishing workflow boundary                                           |
| Edge              | Caddy, Docker Compose                                    | Single-origin TLS routing and hosted deployment                                      |
| External adapters | Meta Graph API, Paymob, configurable LLM/image providers | Provider-dependent publishing, billing, and generation                               |

The shared contract package under `packages/contracts` provides TypeScript and
Python data boundaries across the services. See the maintained
[technical architecture](technical-and-ai-docs/01_TECHNICAL_ARCHITECTURE_AND_SYSTEM_DESIGN.md)
for the complete system view.
