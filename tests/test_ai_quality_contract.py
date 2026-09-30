"""Small reviewed regression set for NorthStar AI routing and action boundaries."""
import json
from pathlib import Path

import northstar_ai as ai


CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "northstar_ai_eval_cases.json").read_text(encoding="utf-8")
)


def test_reviewed_ai_quality_cases_hold_policy_boundaries():
    for case in CASES:
        assert ai._operational_action(case["question"]) is case["operational_action"], case["question"]
        context = {"controlledRetrieval": case["research_mode"] == "internal_only"}
        assert ai._research_mode(context) == case["research_mode"], case["question"]
