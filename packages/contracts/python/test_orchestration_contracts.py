import json
import re
import unittest
from pathlib import Path

from pydantic import ValidationError

from orchestration_contracts import (
    CampaignOrchestrationEventV1,
    CampaignOrchestrationResultV1,
    CampaignOrchestrationResumeV1,
    CampaignOrchestrationStartV1,
    CampaignOrchestrationStateV1,
    OrchestrationErrorV1,
)
from error_codes import ERROR_CODES


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"


class OrchestrationContractTests(unittest.TestCase):
    def load(self, filename: str) -> dict:
        return json.loads((EXAMPLES / filename).read_text())

    def test_start_fixture_matches_python_contract(self) -> None:
        value = self.load("orchestration-start.request.json")
        parsed = CampaignOrchestrationStartV1.model_validate(value)
        self.assertEqual(parsed.model_dump(), value)

    def test_state_fixture_matches_python_contract(self) -> None:
        value = self.load("orchestration-state.example.json")
        parsed = CampaignOrchestrationStateV1.model_validate(value)
        self.assertEqual(parsed.model_dump(), value)

    def test_resume_fixture_matches_python_contract(self) -> None:
        value = self.load("orchestration-resume.request.json")
        parsed = CampaignOrchestrationResumeV1.model_validate(value)
        self.assertEqual(parsed.model_dump(), value)

    def test_result_fixture_matches_python_contract(self) -> None:
        value = self.load("orchestration-result.example.json")
        parsed = CampaignOrchestrationResultV1.model_validate(value)
        self.assertEqual(parsed.model_dump(), value)

    def test_event_fixture_matches_python_contract(self) -> None:
        value = self.load("orchestration-event.example.json")
        parsed = CampaignOrchestrationEventV1.model_validate(value)
        self.assertEqual(parsed.model_dump(), value)

    def test_contract_rejects_unknown_fields(self) -> None:
        value = self.load("orchestration-start.request.json")
        value["secret"] = "must-not-be-persisted"
        with self.assertRaises(ValidationError):
            CampaignOrchestrationStartV1.model_validate(value)

    def test_contract_rejects_unknown_error_code(self) -> None:
        with self.assertRaises(ValidationError):
            OrchestrationErrorV1.model_validate(
                {
                    "code": "NOT_A_MARKETMIND_ERROR",
                    "message": "invalid",
                    "retryable": False,
                    "details": {},
                }
            )

    def test_contract_rejects_cross_scope_resume(self) -> None:
        value = self.load("orchestration-resume-cross-scope.invalid.json")
        with self.assertRaises(ValidationError):
            CampaignOrchestrationResumeV1.model_validate(value)

    def test_python_error_code_mirror_matches_typescript(self) -> None:
        source = (ROOT / "src" / "errors" / "error-codes.ts").read_text()
        typescript_codes = frozenset(
            re.findall(
                r'^[ \t]{2}\w+:[ \t]*(?:\n[ \t]*)?"([A-Z0-9_]+)",?$',
                source,
                re.MULTILINE,
            )
        )
        self.assertEqual(ERROR_CODES, typescript_codes)


if __name__ == "__main__":
    unittest.main()
