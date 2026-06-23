# Team Operating System

This file explains how the six-person team should work together.

## Team roles

Team members:

- Ahmed Rabie
- Merzek
- Mokhtar
- Gerges
- Abdulazim
- Kordy

Leadership:

- Ahmed is delivery/product leader.
- Ahmed and Merzek are AI leads.
- Everyone remains cross-functional.

Meaning:

Ahmed keeps the product direction and delivery organized.

Ahmed and Merzek protect the AI architecture and review AI-critical work.

All team members can work across frontend, backend, AI, docs, testing, and demo tasks depending on capacity.

## GitHub Projects workflow

Use one GitHub Project connected to the repo:

```text
MarketMind AI
```

Use these statuses:

```text
Backlog → Sprint Ready → In Progress → Review → Done
```

Use a separate status for:

```text
Blocked
```

Only the current sprint should live in `Sprint Ready`, `In Progress`, `Review`, and `Done`.

Future ideas stay in `Backlog`.

## Every GitHub Issue must include

- task goal
- acceptance criteria
- owner
- reviewer
- estimate
- dependencies
- testing evidence
- documentation impact
- demo evidence if relevant

If an issue does not have acceptance criteria, it is not ready.

Every implementation pull request should mention or close its related issue.

Example:

```text
Closes #12
```

## Review rules

Normal changes:

- one owner
- one different reviewer

Sensitive changes:

- AI workflows
- prompts
- schemas
- authentication
- security
- database changes
- infrastructure

Need:

- owner
- two reviewers
- Ahmed or Merzek included when AI-critical

## Weekly cadence

### Monday — Planning

- choose weekly goals
- assign GitHub Issues
- confirm owners and reviewers
- identify blockers early

### Daily — Stand-up

15 minutes only:

- What did I finish?
- What will I do today?
- What is blocking me?

### Wednesday — Integration checkpoint

- check that pieces still fit together
- test the current journey
- fix mismatch between frontend, backend, AI, and docs

### Friday — Demo and retro

- show working progress
- review what went well
- review what was confusing
- refine next week backlog

## AI-generated work rule

AI tools are allowed.

But the human task owner must:

- understand the result
- remove invented dependencies
- check security issues
- test the work
- explain it in review
- explain it during graduation discussion if asked

Do not submit AI output that nobody understands.

## Conflict rule

If the team disagrees, use this order:

1. Protect the MVP journey.
2. Protect demo reliability.
3. Protect security and approvals.
4. Prefer simple over impressive.
5. Document the decision.

## Definition of Done

A task is Done only when:

- acceptance criteria are met
- reviewer approved
- testing evidence exists
- docs updated if needed
- demo impact is clear
- no known blocker is hidden

## Simple team motto

Build one clear journey before building many features.

ابنوا رحلة واحدة مفهومة وقوية قبل ما توسعوا السيستم.
