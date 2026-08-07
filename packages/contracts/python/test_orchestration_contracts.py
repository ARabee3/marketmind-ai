import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from orchestration_contracts import (
    CampaignOrchestrationStartV1,
    CampaignOrchestrationStateV1,
)


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

    def test_contract_rejects_unknown_fields(self) -> None:
        value = self.load("orchestration-start.request.json")
        value["secret"] = "must-not-be-persisted"
        with self.assertRaises(ValidationError):
            CampaignOrchestrationStartV1.model_validate(value)


if __name__ == "__main__":
    unittest.main()
