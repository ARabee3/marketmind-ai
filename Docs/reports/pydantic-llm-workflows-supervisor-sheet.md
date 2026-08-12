# Course Application Sheet

**Group:** G2  
**Selected course:** [Pydantic for LLM Workflows](https://www.deeplearning.ai/courses/pydantic-for-llm-workflows)  
**Domain:** 1 — Data Integrity & Output Validation

## 1. Course concept applied

We applied Pydantic-based structured output validation to the AI workflows in
MarketMind. The AI service does not pass raw LLM responses directly to the next
stage. Responses are parsed into typed models, checked against business rules,
and rejected or repaired when invalid.

## 2. Architectural challenge and practical solution

| Before | After |
| --- | --- |
| LLM responses could be incomplete, malformed, or contain unexpected fields. | Structured Pydantic models define the exact required output. |
| AI output could drift from the approved Strategy, language, channel, or owner inputs. | Deterministic validators check IDs, versions, language, grounding, claims, and policy rules. |
| Invalid responses had no consistent recovery path. | The system uses a bounded repair loop with stable error codes. |
| Repeated invalid output could be treated as successful output. | After the retry limit, the result fails closed and cannot move to approval or publishing. |

## 3. Main implementation evidence

- [Strict shared Pydantic model](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/packages/contracts/python/content_base.py#L23-L24)
- [Content output models and Pydantic parsing](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/services/ai/app/providers/content_provider.py#L47-L138)
- [OpenAI/Gemini structured output adapters](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/services/ai/app/providers/content_provider.py#L213-L278)
- [Content business validation](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/services/ai/app/content/validators.py#L1511-L1569)
- [Strategy validation pipeline](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/services/ai/app/strategy/validators.py#L27-L69)
- [Bounded repair and fail-closed behavior](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/services/ai/app/content/service.py#L274-L385)

## 4. What the course teaches and how we used it

Pydantic is a Python library used to define and validate structured data. The
course explains how to create models, validate LLM responses, use models in API
calls, and combine structured outputs with tool-calling workflows. We applied
these ideas by defining strict contracts for Strategy and Content responses,
requesting structured output from providers, validating the result after
generation, and using bounded repair when a correctable response fails.

## 5. Team certificates

Each team member will submit their own course certificate/accomplishment proof
with the final team sheet. The code evidence above demonstrates practical
application; it does not replace individual course completion.

| Team member | Certificate/accomplishment link |
| --- | --- |
| ____________________ | ______________________________ |
| ____________________ | ______________________________ |
| ____________________ | ______________________________ |
| ____________________ | ______________________________ |
