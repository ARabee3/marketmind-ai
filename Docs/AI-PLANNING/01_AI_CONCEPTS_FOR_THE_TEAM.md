# AI Concepts for the Team

This file explains the AI ideas we will use in MarketMind AI without deep technical details.

## 1. What is an AI agent?

An AI agent is an AI role with a specific job.

It is not just “ChatGPT answering anything.” In our project, each agent has:

- a goal
- allowed inputs
- allowed tools
- expected output
- forbidden actions
- stopping point

Example:

The Discovery Agent can ask the owner about the cafe, but it cannot create a marketing strategy.

بالعربي: كل Agent عامل زي عضو في الفريق عنده شغلانة محددة، مش مسموح له يعمل كل حاجة.

## 2. What are tools?

Tools are actions the AI can request from the system.

Examples:

- read saved business profile
- analyze uploaded menu
- search trusted documents
- save a strategy draft
- request owner approval

The AI should not have unlimited power. Tools keep it controlled.

## 3. What is memory?

Memory means information the system remembers between steps.

In MarketMind AI, we should avoid vague memory like “the AI remembers everything forever.”

Instead, we store clear information:

- business profile
- confirmed owner answers
- uploaded assets
- strategy drafts
- approved content
- analytics snapshots
- audit events

Good memory is structured and visible.

Bad memory is hidden and impossible to verify.

## 4. What is RAG?

RAG means Retrieval-Augmented Generation.

Simple meaning:

The AI does not answer from imagination only. It first retrieves useful information from trusted documents, then writes an answer based on that information.

Example:

If the Strategy Agent says “Instagram Reels are useful for restaurant awareness,” it should connect that recommendation to a trusted source when possible.

بالعربي: بدل ما الـ AI يألف، بنديله مصادر يرجع لها ويستشهد بيها.

## 5. What is structured output?

Structured output means the AI response follows a known shape.

Instead of only writing paragraphs, the AI returns organized data that the product can use.

Example shape:

```text
StrategyPlan
- target audience
- goals
- channels
- budget
- content themes
- weekly plan
- citations
```

This helps the system validate the answer and display it in the UI.

## 6. What is human approval?

Human approval means the owner must confirm before important steps continue.

In MarketMind AI, approval is required before:

- starting strategy from the business profile
- accepting the strategy
- publishing content
- applying optimization changes

The AI suggests. The human decides.

الـ AI يقترح، الإنسان يوافق.

## 7. What can go wrong with AI?

Common risks:

- inventing facts
- misunderstanding Arabic/Egyptian dialect
- using weak sources
- creating content that does not match the brand
- ignoring budget limits
- taking action without approval
- treating uploaded text as instructions

Our design should reduce these risks using:

- clear agent responsibilities
- trusted sources
- citations
- structured outputs
- review checks
- human approval
- audit logs

## 8. Simple mental model

Think of the AI system as a kitchen:

- Discovery collects the ingredients.
- Research checks the recipe books.
- Strategy designs the meal.
- Content cooks the dishes.
- Publishing serves only after approval.
- Optimization learns what people liked.

No one should serve food before the owner approves the menu.

