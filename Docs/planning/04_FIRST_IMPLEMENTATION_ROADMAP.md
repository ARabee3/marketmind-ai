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

### Day 2 — Walk through one fictional SME

Use one example business (a café is used as a concrete illustrative SME; the
product targets SMEs across industries, not only hospitality):

“A small Egyptian café in Nasr City wants more weekday customers.”

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

Generate content one week at a time from the approved 12-week strategy. Start
with Week 1, then prepare week N+1 by the end of week N.

Purpose:

Make the product feel useful and demo-ready.

### Step 6 — Publishing/export

Add safe export and clearly labeled simulation first, then deterministic
n8n/Meta static publishing if current account permissions and credentials work.
Keep NestJS/PostgreSQL as the source of truth, require a separate exact
publication approval, and use
`sprint-5/PUBLISHING_AUTOMATION_ARCHITECTURE.md` for the approved Sprint 5B
structure.

Purpose:

Never block the demo on external platform permissions.

### Step 7 — Commercial readiness: subscriptions and payments

After the publishing/export slice is stable, validate one paid SME plan, prove
real provider costs, and integrate one Egypt-friendly payment gateway. The
current public test hypothesis is EGP 299 monthly, conditional on an EGP 70
95th-percentile paid-month direct-cost ceiling and an EGP 20 trial ceiling.
Remove multiplied queue/provider retries and make image quality explicit before
billing gates depend on those numbers. Start with a hosted one-time EGP payment
and verified webhooks before adding eligible-card automatic renewal. Keep
manual wallet/kiosk renewal available when enabled by the selected merchant
account.

Use:

`sprint-6/PAYMENTS_AND_SUBSCRIPTIONS_ARCHITECTURE.md`

Purpose:

Turn the working MVP into a sellable product without inventing agency tiers,
trusting browser redirects, or depending on Stripe.

### Step 8 — Monitoring and optimization

First add automatic Facebook monitoring for real MarketMind-published posts.
Then add an evidence-bound hook/CTA suggestion with owner approval and one-time
future-draft use. The approved Strategy and weekly plan remain unchanged.

Purpose:

Complete the closed-loop AI story.

Implementation order and acceptance criteria:

- `sprint-8/FACEBOOK_PERFORMANCE_AND_OPTIMIZATION_ARCHITECTURE.md`
- `sprint-8/FACEBOOK_PERFORMANCE_IMPLEMENTATION_ISSUES.md`

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
7. System creates Week 1 content and starts the rolling weekly Content cycle.
8. Owner approves.
9. System exports or simulates publishing.
10. System shows metrics.
11. System proposes improvement.
12. Owner approves future change.
13. By the end of Week 1, the system creates the Week 2 draft for owner review.

This is enough to prove the product.
