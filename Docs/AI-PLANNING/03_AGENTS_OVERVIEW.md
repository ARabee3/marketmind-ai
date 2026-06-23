# Agents Overview

MarketMind AI uses five AI roles and one non-AI publishing service.

The main rule:

Each agent has a focused responsibility. No agent should do everything.

## Quick view

| Role | Main job | Main output | Approval needed? |
|---|---|---|---|
| Discovery Agent | Understand the business | BusinessProfile | Yes |
| Research Agent | Find useful evidence | ResearchPack | No direct owner approval, but sources must be visible |
| Strategy Agent | Build strategy | StrategyPlan | Yes |
| Content Agent | Create content | ContentPack | Yes |
| Optimization Agent | Suggest improvements | OptimizationProposal | Yes |
| Publishing Service | Publish/export approved content | Publication result | Yes before publishing |

## 1. Discovery Agent

Goal:

Understand the owner’s business through a short bilingual interview.

Input:

- owner answers
- optional menu/logo/photos/brand guide

Output:

- confirmed `BusinessProfile`

Allowed:

- ask one clear question at a time
- accept Arabic, English, or mixed language
- summarize what it understood
- record unknowns honestly
- suggest observations from uploaded files

Forbidden:

- invent missing business facts
- research competitors
- create strategy
- generate content
- start the next phase without owner confirmation

Approval point:

Owner confirms the Business Profile.

## 2. Research Agent

Goal:

Collect trusted evidence that can support strategy decisions.

Input:

- confirmed Business Profile
- trusted source policy
- internal knowledge documents

Output:

- `ResearchPack`

Allowed:

- search approved documents
- use limited trusted web research when needed
- return citations
- separate facts from assumptions

Forbidden:

- use random unsupported claims
- browse endlessly
- create the final strategy alone
- hide source quality problems

Approval point:

No separate owner approval, but the Strategy Agent and reviewers must see the sources.

## 3. Strategy Agent

Goal:

Turn the confirmed profile and research into a practical marketing plan.

Input:

- Business Profile
- Research Pack
- owner goals and limits

Output:

- `StrategyPlan`

Allowed:

- recommend platforms
- define target audience
- suggest themes and campaign direction
- create four-week plan and twelve-week overview
- connect recommendations to sources

Forbidden:

- claim certainty without evidence
- ignore budget or operational limits
- recommend paid execution as if it will happen automatically
- generate final content before strategy approval

Approval point:

Owner approves or requests edits to the strategy.

## 4. Content Agent

Goal:

Create practical content from the approved strategy.

Input:

- approved Strategy Plan
- Business Profile
- brand rules
- approved assets

Output:

- `ContentPack`

Allowed:

- create captions
- create image prompts or assets
- create short-video scripts
- create calendar items
- write Egyptian Arabic and English versions when useful
- regenerate weak content

Forbidden:

- publish content
- ignore brand restrictions
- invent offers that the business did not approve
- use unsafe or misleading claims

Approval point:

Owner approves content before publishing/export.

## 5. Optimization Agent

Goal:

Suggest better future content based on performance.

Input:

- approved strategy
- published/exported content history
- metric snapshots

Output:

- `OptimizationProposal`

Allowed:

- compare expected vs actual performance
- suggest changes to future drafts
- explain evidence behind each recommendation
- mark weak data as uncertain

Forbidden:

- rewrite approved past content
- change future strategy without approval
- pretend simulation data is real
- overreact to one weak metric

Approval point:

Owner approves any pivot before future drafts change.

## Publishing Service, not Publishing Agent

Publishing is intentionally not an AI agent.

Reason:

Publishing is an external action. It should be predictable, logged, and approved.

Allowed publishing paths:

- approved n8n workflow
- manual export
- clearly labeled simulation

Forbidden:

- LLM deciding to publish alone
- publishing without explicit approval
- hiding failed integrations

## Simple rule for the team

If an action can affect the real business account, real content, real publishing, or real strategy direction, human approval is required.

أي حاجة ممكن تأثر على البيزنس الحقيقي لازم موافقة إنسان واضحة.

