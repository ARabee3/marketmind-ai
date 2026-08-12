# MarketMind AI — Course Application Report

## Selected course

**Pydantic for LLM Workflows**  
Domain 1: Data Integrity & Output Validation

Course link: [DeepLearning.AI — Pydantic for LLM Workflows](https://www.deeplearning.ai/courses/pydantic-for-llm-workflows)

## Why this course fits our project

MarketMind uses AI to generate Discovery, Strategy, and Content results. An LLM
can return incomplete, incorrectly formatted, or unsafe data. We use Pydantic
models and deterministic validators to make sure that AI output is structured,
validated, and safe before another part of the system uses it.

This is a real implementation in the AI service, not only a documentation idea.

## The concept in simple words

Pydantic acts like a strict contract between the LLM and our application:

1. We define the fields and types that the AI must return.
2. The provider is asked for structured output using that schema.
3. Pydantic parses and validates the response.
4. Business validators check deeper rules such as Strategy version, language,
   channel, grounding sources, claims, and asset requirements.
5. If the result can be repaired safely, the system retries with a bounded
   repair prompt.
6. If it is still invalid, the system fails closed and does not treat it as a
   valid Strategy or Content result.

## Before and after

| Before: architectural gap | After: implemented solution |
| --- | --- |
| LLM output is probabilistic and may be free-form or malformed. | Responses are requested and parsed against typed Pydantic models. |
| A missing field or unexpected field could break the next workflow stage. | Strict contracts reject missing, invalid, or unexpected data. |
| The output could drift from the approved Strategy or owner inputs. | Validators check IDs, versions, language, channels, grounding, and policy rules. |
| Every invalid response would need a different recovery decision. | Invalid output gets a safe, bounded repair attempt with stable error codes. |
| Repeated failures could be hidden as successful AI output. | After the retry limit, the result is rejected and remains non-approvable. |

This describes the architectural reliability gap we addressed; it does not claim
that a specific production incident happened before the validation layer.

## Main implementation files

The links below point to the project commit used for this report.

### 1. Shared Pydantic base model

- [FrozenModel — strict and immutable contract base](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bddcd775e19974741942598b5/packages/contracts/python/content_base.py#L23-L24)

`extra="forbid"` prevents the model from silently accepting unexpected fields.

### 2. Contract models and validation results

- [Content validation result and issue models](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/packages/contracts/python/content_contracts.py#L34-L44)
- [Cross-field Pydantic validation example](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/packages/contracts/python/content_contracts.py#L78-L88)
- [Strategy Pydantic models](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/packages/contracts/python/strategy_contracts.py#L1-L20)

These models define the data shape shared by the AI service and the rest of the
application.

### 3. Structured LLM provider output

- [Content provider output models and strict parsing](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/providers/content_provider.py#L47-L138)
- [OpenAI structured response parsing](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/providers/content_provider.py#L213-L278)
- [Gemini JSON schema response](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/providers/content_provider.py#L368-L384)
- [Strategy provider schema validation](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/providers/strategy_provider.py#L79-L108)

The provider adapters do not pass raw LLM text directly to the application.

### 4. Post-generation business validation

- [Content generation validation entry point](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/content/validators.py#L1511-L1569)
- [Strategy validation pipeline](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/strategy/validators.py#L27-L69)
- [Strategy request validation entry point](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/strategy/validators.py#L376-L381)

Pydantic confirms the shape. These validators confirm that the result is also
correct for the business workflow.

### 5. Bounded repair and fail-closed behavior

- [Retry limit and repairable error categories](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/content/service.py#L31-L45)
- [Content repair loop](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/app/content/service.py#L274-L385)

The Content flow allows at most three attempts. It never treats an invalid final
response as a valid result.

## Tests and evidence

- [Provider repair tests](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/tests/content/test_provider_repair.py#L217-L310)
- [Post-generation validation tests](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/tests/content/test_post_generation_validation.py#L92-L208)
- [Strategy validation tests](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/services/ai/tests/strategy/test_validation_pipeline.py#L49-L178)
- [AI CI workflow](https://github.com/ARabee3/marketmind-ai/blob/2bb920870420608bdd775e19974741942598b5/.github/workflows/ai-ci.yml#L30-L77)

Local focused verification on 11 August 2026 produced:

- 121 focused structured-output, validation, repair, and metric tests passed.
- 208 Content evaluation tests passed and 1 was skipped.
- The hard-guardrail threshold reported 100% and passed.
- The human-quality rubric remains a separate reviewer sign-off and must not be
  reported as complete until reviewers sign it off.

## What every team member should understand

- Pydantic is not being used only as a dependency; it is enforcing the AI
  response contract at the provider boundary.
- Schema validation checks whether the data has the right shape.
- Business validation checks whether the data is acceptable for MarketMind.
- Repair is bounded, so the system does not loop forever or hide provider
  failures.
- A certificate is still required from every team member. The existing code is
  evidence of practical application, but it does not replace course completion.

## Team submission checklist

- [ ] Every team member completes the selected course.
- [ ] Every team member downloads the certificate/accomplishment proof.
- [ ] The team leader adds the member names and certificate links to the final
      sheet.
- [ ] The final sheet includes this report's Before/After explanation and code
      evidence links.
- [ ] The team does not claim that the human evaluation rubric is complete
      unless the required reviewers have signed it off.
