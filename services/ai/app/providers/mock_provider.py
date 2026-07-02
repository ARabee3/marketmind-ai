from app.discovery.schemas import (
    DiscoveryModelOutput,
    MarketAwareBusinessFacts,
    UncertaintyInput,
)
from app.providers.base import DiscoveryProvider, DiscoveryProviderRequest


class MockDiscoveryProvider(DiscoveryProvider):
    name = "mock"

    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        intake = request.payload["intake"]
        known_facts = MarketAwareBusinessFacts(
            identity={
                "business_name": intake["business_name"],
                "business_type": intake["business_type"],
                "city": intake["city"],
                "area": intake.get("area"),
            },
            customers={
                "primary_segments": (
                    [str(intake["target_audience_text"])]
                    if intake.get("target_audience_text")
                    else []
                )
            },
            current_marketing={
                "active_channels": [
                    str(link["platform"])
                    for link in intake.get("social_links", [])
                    if link.get("platform") != "delivery"
                ],
                "delivery_platforms": [
                    str(link["platform"])
                    for link in intake.get("social_links", [])
                    if link.get("platform") == "delivery"
                ],
            },
            goals_and_constraints={
                "growth_goals": (
                    [str(intake["owner_goal_text"])]
                    if intake.get("owner_goal_text")
                    else []
                )
            },
        )

        if request.turn_kind == "summarize":
            return self._profile_ready(request.language_mode, known_facts, intake)

        owner_text = str(request.payload.get("owner_message", {}).get("content", ""))
        if self._is_strategy_request(owner_text):
            return DiscoveryModelOutput(
                action="ask_clarification",
                next_question=self._boundary_question(request.language_mode),
                updated_known_facts=known_facts,
                updated_uncertainties=[],
                domain_scores=self._scores(0.35),
            )
        if self._is_prompt_injection(owner_text):
            return DiscoveryModelOutput(
                action="ask_clarification",
                next_question=self._safe_discovery_question(
                    request.language_mode,
                    str(intake["business_name"]),
                ),
                updated_known_facts=known_facts,
                updated_uncertainties=[],
                domain_scores=self._scores(0.35),
            )
        if self._is_unknown(owner_text):
            return DiscoveryModelOutput(
                action="ask_next_question",
                next_question=self._next_question(request),
                updated_known_facts=known_facts,
                updated_uncertainties=[
                    UncertaintyInput(
                        field_key="owner_unknown_answer",
                        description="The owner did not know the requested Discovery fact.",
                        severity="medium",
                        category="owner_unknown",
                        source="owner_unknown",
                        owner_stated_value=owner_text,
                    )
                ],
                domain_scores=self._scores(0.3),
            )
        return DiscoveryModelOutput(
            action="ask_next_question",
            next_question=self._next_question(request),
            updated_known_facts=known_facts,
            updated_uncertainties=[],
            owner_goals=[intake["owner_goal_text"]] if intake.get("owner_goal_text") else [],
            domain_scores=self._scores(0.45),
        )

    def _profile_ready(
        self,
        language_mode: str,
        known_facts: MarketAwareBusinessFacts,
        intake: dict[str, object],
    ) -> DiscoveryModelOutput:
        return DiscoveryModelOutput(
            action="produce_profile_draft",
            next_question=None,
            updated_known_facts=known_facts,
            updated_uncertainties=[],
            owner_goals=[str(intake["owner_goal_text"])] if intake.get("owner_goal_text") else [],
            strategy_relevant_notes=[
                "Strategy work stays locked until the owner confirms this profile."
            ],
            domain_scores={
                "identity": 1.0,
                "offer": 0.3,
                "customers": 0.4,
                "differentiation": 0.1,
                "current_marketing": 0.4,
                "goals_and_constraints": 0.5,
                "market_context": 0.5,
                "research_confidence": 0.5,
                "profile_readiness": 0.85,
            },
        )

    def _next_question(self, request: DiscoveryProviderRequest) -> str:
        gaps = request.payload.get("intelligence", {}).get("knowledge_gaps", [])
        open_gaps = [gap for gap in gaps if gap.get("status") == "open"]
        if open_gaps:
            gap = sorted(open_gaps, key=lambda item: item["priority"])[0]
            return self._question_for_gap(
                str(gap.get("field_key", "")),
                request.language_mode,
                str(request.payload["intake"]["business_name"]),
            )
        assistant_turns = sum(
            1
            for message in request.payload.get("messages", [])
            if message.get("role") == "assistant"
        )
        if assistant_turns == 1:
            return self._differentiation_question(request.language_mode)
        if assistant_turns == 2:
            return self._current_marketing_question(request.language_mode)
        if assistant_turns >= 3:
            return self._goal_and_capacity_question(request.language_mode)
        return self._safe_discovery_question(
            request.language_mode,
            str(request.payload["intake"]["business_name"]),
        )

    def _safe_discovery_question(
        self,
        language_mode: str,
        business_name: str = "the business",
    ) -> str:
        if language_mode == "ar-EG":
            return (
                f"تخيل يوم زحمة في {business_name}: مين غالبا بيكون موجود، "
                "وبيطلبوا إيه وفي أي وقت؟"
            )
        if language_mode == "mixed":
            return (
                f"Think of a busy day at {business_name}: مين غالبا بيطلب، "
                "وبيختاروا إيه وفي أي وقت؟"
            )
        return (
            f"Think about a busy day at {business_name}: who is usually ordering, "
            "what do they tend to choose, and around what time?"
        )

    def _question_for_gap(
        self,
        field_key: str,
        language_mode: str,
        business_name: str,
    ) -> str:
        if field_key in {"primary_customer_segment", "target_audience"}:
            return self._safe_discovery_question(language_mode, business_name)
        if field_key in {"best_selling_items", "core_offerings"}:
            if language_mode == "ar-EG":
                return "لما الدنيا بتكون زحمة، إيه الطلبات اللي بتطلع أكتر حاجة؟"
            if language_mode == "mixed":
                return "وقت الزحمة، which orders keep showing up again and again؟"
            return "When things get busy, which orders keep showing up again and again?"
        if field_key in {"competitors", "known_competitors"}:
            if language_mode == "ar-EG":
                return "لما عميل يحتار بينكم وبين مكان قريب، بيختاركم عادة بسبب إيه؟"
            if language_mode == "mixed":
                return "لما العميل يقارنكم بمكان قريب، what usually makes them choose you؟"
            return (
                "When customers compare you with a nearby alternative, "
                "what usually makes them choose you?"
            )
        return self._safe_discovery_question(language_mode, business_name)

    def _differentiation_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return "لما عميل يجربكم ويرجع تاني، إيه السبب اللي بيقوله لكم غالبا؟"
        if language_mode == "mixed":
            return "لما عميل يجربكم ويرجع تاني، what reason do they usually give؟"
        return (
            "When a customer tries you and comes back, "
            "what reason do they usually give?"
        )

    def _current_marketing_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return "لما تحب تفكّر الناس بالمكان، بتعمل إيه فعليا دلوقتي ومين بيتولاه؟"
        if language_mode == "mixed":
            return "لما تحب تفكّر الناس بالمكان، what do you actually do now and who handles it؟"
        return (
            "When you want to remind people about the business, "
            "what do you actually do now, and who handles it?"
        )

    def _goal_and_capacity_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return "لو الشهور الجاية مشت بشكل ممتاز، إيه التغيير اللي تحب تشوفه من غير ما يضغط التشغيل؟"
        if language_mode == "mixed":
            return "لو الشهور الجاية مشت كويس، what change would you want without stretching operations؟"
        return (
            "If the next few months went really well, what would you want to change "
            "without stretching the operation too far?"
        )

    def _boundary_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return (
                "هنوصل للاستراتيجية بعد تأكيد البروفايل. دلوقتي تخيل يوم زحمة: "
                "مين بيطلب غالبا وبيختار إيه؟"
            )
        if language_mode == "mixed":
            return (
                "Strategy comes after profile confirmation. دلوقتي في يوم زحمة، "
                "مين بيطلب وبيختار إيه غالبا؟"
            )
        return (
            "Strategy comes after profile confirmation. For now, think about a busy day: "
            "who tends to order, and what do they usually choose?"
        )

    def _scores(self, readiness: float) -> dict[str, float]:
        return {
            "identity": 0.9,
            "offer": 0.3,
            "customers": 0.3,
            "differentiation": 0.1,
            "current_marketing": 0.4,
            "goals_and_constraints": 0.5,
            "market_context": 0.45,
            "research_confidence": 0.45,
            "profile_readiness": readiness,
        }

    def _is_unknown(self, text: str) -> bool:
        lowered = text.lower()
        return any(token in lowered for token in ["i don't know", "dont know", "not sure", "معرفش", "مش عارف", "لا اعرف"])

    def _is_strategy_request(self, text: str) -> bool:
        lowered = text.lower()
        tokens = [
            "strategy",
            "content",
            "campaign",
            "budget",
            "platform",
            "recommend",
            "ads",
            "استراتيجية",
            "محتوى",
            "بوست",
            "ميزانية",
            "اعلانات",
            "منصة",
            "خطة",
        ]
        return any(token in lowered for token in tokens)

    def _is_prompt_injection(self, text: str) -> bool:
        lowered = text.lower()
        tokens = ["ignore previous", "system prompt", "developer message", "forget your rules", "انس التعليمات"]
        return any(token in lowered for token in tokens)
