# Glossary and Checklist

Use this file before coding, before reviews, and before the final demo.

## Glossary

| Term | Simple meaning | Arabic aid |
|---|---|---|
| Agent | AI role with a specific job | وكيل/دور ذكي |
| Tool | Action the system lets AI request | أداة مسموحة |
| Memory | Saved project information | ذاكرة محفوظة |
| RAG | AI answers using retrieved sources | إجابة مبنية على مصادر |
| Citation | Reference proving a claim | مصدر أو استشهاد |
| Structured output | Organized AI result | ناتج منظم |
| Human approval | User must confirm before continuing | موافقة الإنسان |
| BusinessProfile | Confirmed business information | ملف البيزنس |
| StrategyPlan | Marketing plan | خطة التسويق |
| ContentPack | Generated posts/scripts/assets | حزمة المحتوى |
| MetricSnapshot | Saved performance numbers | لقطة أداء |
| OptimizationProposal | Suggested future improvement | اقتراح تحسين |
| Simulation | Demo fallback, not real data/action | محاكاة للديمو |

## Before coding checklist

- [ ] We can explain the MVP in one minute.
- [ ] We know what is included and deferred.
- [ ] We have one fictional cafe example.
- [ ] We know the five AI roles.
- [ ] We know publishing is not an AI agent.
- [ ] We know where owner approval is required.
- [ ] We know what data moves between phases.
- [ ] We know which claims need citations.
- [ ] We know direct cafe-owner interviews were not conducted, if still true.
- [ ] We have Trello cards with owners and reviewers.

## Before building any agent

- [ ] Agent goal is clear.
- [ ] Agent input is clear.
- [ ] Agent output is clear.
- [ ] Allowed tools are clear.
- [ ] Forbidden actions are clear.
- [ ] Human approval point is clear.
- [ ] Failure behavior is clear.
- [ ] Test scenarios are clear.

## Before demo checklist

- [ ] Demo journey works from discovery to optimization.
- [ ] Arabic and English examples are ready.
- [ ] Citations are visible where market claims appear.
- [ ] Simulation data is clearly labeled.
- [ ] Manual export works if publishing integration fails.
- [ ] No AI action publishes without approval.
- [ ] The team can explain what each agent does.
- [ ] The team can explain what each agent is forbidden to do.
- [ ] The team can explain limitations honestly.

## Common mistakes to avoid

### Mistake 1 — Building too much

Do not try to build every feature from the old SRS.

Focus on one strong MVP journey.

### Mistake 2 — Letting agents do everything

Each agent should have boundaries.

If Discovery starts creating strategy, the design is wrong.

### Mistake 3 — Forgetting approval

Publishing, strategy changes, and future pivots need explicit human approval.

### Mistake 4 — Hiding simulation

If analytics or publishing is simulated, label it clearly.

### Mistake 5 — Inventing research

Market claims need trusted sources or should be written as assumptions.

### Mistake 6 — Overengineering before the demo works

The graduation demo needs a reliable story more than perfect infrastructure.

## Final confidence question

Before starting implementation, each team member should be able to answer:

“If I follow one cafe from discovery to optimization, what does each AI role receive, produce, and wait for?”

If the answer is unclear, stay in planning for one more session.

