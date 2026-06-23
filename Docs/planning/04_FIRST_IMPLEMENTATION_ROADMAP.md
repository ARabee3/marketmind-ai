# First Implementation Roadmap

This roadmap is intentionally high-level. It helps the team prepare before writing real code.

## Week 0 — Planning before coding

Goal:

Make sure all six team members understand the product and AI flow.

### Day 1 — Product alignment

Team answers:

- Who is the user?
- What problem are we solving?
- What is the MVP?
- What is outside scope?
- What does the final demo need to show?

Output:

- agreed MVP statement
- agreed deferred list
- simple demo story

### Day 2 — Walk through one fictional cafe

Use one example business:

“A small Egyptian cafe in Nasr City wants more weekday customers.”

Walk through:

- discovery answers
- research needs
- strategy draft
- content examples
- publishing approval
- fake/demo metrics
- optimization suggestion

Output:

- one full paper prototype of the journey

### Day 3 — Understand the AI system

Team discusses:

- agents
- tools
- memory
- RAG
- structured output
- approvals
- failure cases

Output:

- team can explain the system without code

### Day 4 — Define important data shapes

Define simple versions of:

- BusinessProfile
- ResearchPack
- StrategyPlan
- ContentPack
- ApprovalDecision
- MetricSnapshot
- OptimizationProposal

Output:

- simple agreed data dictionary

### Day 5 — GitHub Projects preparation

Create GitHub Issues for:

- UX planning
- AI planning
- backend planning
- frontend planning
- evaluation planning
- demo planning

Output:

- first sprint ready in GitHub Projects

## Sprint 1 implementation direction

Sprint 1 should not be planning-only.

Every owner should plan, build, test, and explain their own slice.

Start with two connected foundations:

- Real Discovery AI foundation.
- NestJS Auth/RBAC foundation.

The detailed Sprint 1 plan lives in:

`sprint-1/07_SPRINT_1_VERTICAL_SLICE.md`

Important Sprint 1 backend decision:

- Keep `HealthModule`.
- Do not create `AuditModule` yet.
- Treat audit as a future requirement for approval-sensitive actions.

## Later coding roadmap

This is not detailed implementation. It is the recommended build order.

### Step 1 — Mocked end-to-end flow

Build a very thin version where fake/sample data moves through the journey.

Purpose:

Prove the product flow before building hard AI pieces.

### Step 2 — Discovery

Build the interview and confirmed Business Profile.

Purpose:

The whole product depends on correct business understanding.

### Step 3 — Research/RAG

Add trusted document retrieval and citations.

Purpose:

Reduce invented strategy claims.

### Step 4 — Strategy

Generate an editable strategy from profile + research.

Purpose:

This is the main business value.

### Step 5 — Content

Generate Week 1 posts, captions, and scripts from the approved strategy.

Purpose:

Make the product feel useful and demo-ready.

### Step 6 — Publishing/export

Add safe export first, then n8n/Meta publishing if permissions work.

Purpose:

Never block the demo on external platform permissions.

### Step 7 — Monitoring and optimization

Add metrics and improvement suggestions.

Purpose:

Complete the closed-loop AI story.

## What not to do first

Avoid starting with:

- Terraform
- complex infrastructure
- full authentication systems
- perfect UI animations
- full video generation
- paid ads automation
- too many social platforms
- many businesses per account

These can consume time before the core journey is proven.

## Recommended first demo story

The best demo should show one clean story:

1. Owner signs in.
2. Owner answers discovery questions.
3. System creates Business Profile.
4. Owner confirms.
5. System creates cited strategy.
6. Owner approves.
7. System creates Week 1 content.
8. Owner approves.
9. System exports or simulates publishing.
10. System shows metrics.
11. System proposes improvement.
12. Owner approves future change.

This is enough to prove the product.
