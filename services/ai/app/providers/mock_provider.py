from app.discovery.schemas import DiscoveryModelOutput, UncertaintyInput
from app.providers.base import DiscoveryProvider, DiscoveryProviderRequest


class MockDiscoveryProvider(DiscoveryProvider):
    name = "mock"

    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        intake = request.payload["intake"]
        known_facts = {
            "business_name": intake["business_name"],
            "business_type": intake["business_type"],
            "city": intake["city"],
        }
        if intake.get("area"):
            known_facts["area"] = intake["area"]

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
                next_question=self._safe_discovery_question(request.language_mode),
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
        if request.turn_kind == "respond" and owner_text:
            known_facts["latest_owner_answer"] = owner_text

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
        known_facts: dict[str, str],
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
                "intake_completeness": 0.8,
                "research_confidence": 0.5,
                "profile_readiness": 0.85,
            },
        )

    def _next_question(self, request: DiscoveryProviderRequest) -> str:
        gaps = request.payload.get("intelligence", {}).get("knowledge_gaps", [])
        open_gaps = [gap for gap in gaps if gap.get("status") == "open"]
        if open_gaps:
            return str(sorted(open_gaps, key=lambda gap: gap["priority"])[0]["question_hint"])
        return self._safe_discovery_question(request.language_mode)

    def _safe_discovery_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return "مين أهم العملاء عندك حاليا، وبيجوا في أي وقت من اليوم؟"
        if language_mode == "mixed":
            return "Who are your best customers حاليا، وبيزوروا المكان امتى غالبا؟"
        return "Who are your best current customers, and when do they usually visit?"

    def _boundary_question(self, language_mode: str) -> str:
        if language_mode == "ar-EG":
            return "الاستراتيجية بعد تأكيد البروفايل. حاليا محتاج أعرف: مين أهم عملائك الحاليين؟"
        if language_mode == "mixed":
            return "Strategy comes after profile confirmation. حاليا، who are your main customers?"
        return "Strategy comes after profile confirmation. For now, who are your main customers?"

    def _scores(self, readiness: float) -> dict[str, float]:
        return {
            "intake_completeness": 0.55,
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
