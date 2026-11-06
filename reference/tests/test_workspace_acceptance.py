"""Offline runner/oracle tests; all role outputs here are explicitly scripted."""

import copy
import importlib.util
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from ai_baseline.presentation import infer_output_options

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ai_baseline.workspace_acceptance", ROOT / "ai_baseline" / "workspace_acceptance.py")
acceptance = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = acceptance
SPEC.loader.exec_module(acceptance)


def purpose(language, focus):
    return {
        ("ko", "summary"): "반환된 지갑 이체를 한국어로 요약해 주세요.",
        ("ko", "count"): "이체 건수만 한국어로 알려 주세요.",
        ("ko", "incoming"): "입금만 한국어로 요약해 주세요.",
        ("ko", "outgoing"): "출금만 한국어로 요약해 주세요.",
        ("en", "summary"): "Summarize returned wallet transfers in English.",
        ("en", "count"): "Give transfer counts only in English.",
        ("en", "incoming"): "Summarize incoming transfers only in English.",
        ("en", "outgoing"): "Summarize outgoing transfers only in English.",
    }[(language, focus)]


class ScriptedRoles:
    """Oracle-backed synthetic outputs validate plumbing, never model quality."""

    def __init__(self, suite):
        self.suite, self.calls, self.override = suite, [], None

    def role(self, role, data, schema):
        self.calls.append((role, copy.deepcopy(data), copy.deepcopy(schema)))
        case = next(case for case in self.suite["cases"] if data["messages"][-1]["id"].startswith(case["id"] + "-"))
        if self.override:
            supplied = self.override(role, data, case)
            if supplied is not None:
                return supplied
        digest = data["contextDigest"]
        if role == "refine":
            index = int(data["messages"][-1]["id"].rsplit("-", 1)[1])
            expected = case["stages"][index]["expected"]
            options = expected.get("outputOptions", {"language": case["inputLanguage"], "focus": "summary"})
            intent = {"purpose": purpose(options["language"], options["focus"]),
                      **{key: expected[key] for key in ("wallet", "windowStart", "windowEnd", "resourceId", "missingFields")}}
            return {"contextDigest": digest, "status": expected["status"], "intent": intent,
                    "assistantText": "실제 역할 포트 답변: 지갑 주소와 정확한 조회 기간을 알려 주세요." if options["language"] == "ko"
                    else "Scripted role response: which wallet and exact observation period should I use?"}
        if role == "plan":
            return {"contextDigest": digest, "summary": "Summarize the returned transfer observations.",
                    "steps": [{"role": "planner", "capability": "wallet-transfers", "resourceId": "wallet-transfers",
                               "reason": "The registered resource covers the explicitly selected observations."}],
                    "limitations": ["Only the returned records are covered."]}
        return {"contextDigest": digest, "verdict": "REJECT" if case["family"] == "critic-stale-proposal" else "ACCEPT",
                "reason": "The proposed scope is stale." if case["family"] == "critic-stale-proposal" else "The bounded resource fits the supplied scope.",
                "issueCodes": ["STALE_INTENT"] if case["family"] == "critic-stale-proposal" else []}


class WorkspaceAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.suite = acceptance.load_suite()

    def run_suite(self, model=None):
        model = model or ScriptedRoles(self.suite)
        return acceptance.run_suite(self.suite, model=model, execution_kind="scripted_roles"), model

    def test_authored_set_is_exact_bounded_paired_and_labeled_post_baseline_regression(self):
        self.assertEqual(len(self.suite["cases"]), 12)
        self.assertEqual(sum(len(case["stages"]) for case in self.suite["cases"]), 32)
        self.assertEqual(self.suite["maxRoleCalls"], 40)
        self.assertEqual(self.suite["expectedRoleCounts"], {"refine": 22, "plan": 8, "critic": 10})
        self.assertFalse(self.suite["humanReviewed"])
        self.assertEqual(self.suite["split"], "post-baseline-regression")
        self.assertTrue(self.suite["sameCasesAsBaseline"])
        self.assertEqual(self.suite["originalPreSampleSuiteHash"], acceptance.BASELINE_SUITE_HASH)
        self.assertEqual(self.suite["previousRegressionSuiteHash"], acceptance.PREVIOUS_SUITE_HASH)
        for bad in ({"maxRoleCalls": 41}, {"expectedCases": 11}, {"model": "other-model"}, {"humanReviewed": True}):
            value = copy.deepcopy(self.suite); value.update(bad)
            with self.assertRaises(acceptance.InvalidAcceptance):
                acceptance.validate_suite(value)
        value = copy.deepcopy(self.suite); value["cases"][1]["id"] = value["cases"][0]["id"]
        with self.assertRaises(acceptance.InvalidAcceptance):
            acceptance.validate_suite(value)

    def test_v4_changes_only_version_prompt_and_previous_hash_while_v3_bytes_and_core_are_unchanged(self):
        v2 = ROOT / "evaluations" / "workspace-live-acceptance-v2.json"
        self.assertEqual(hashlib.sha256(v2.read_bytes()).hexdigest(), "e7075803eac9a34866d07a68ff45bafae4876f16d69b4591ea646c1a371f3a3b")
        previous = ROOT / "evaluations" / "workspace-live-acceptance-v3.json"
        self.assertEqual(hashlib.sha256(previous.read_bytes()).hexdigest(), "d401b7ab4f42e8df76fb9372e857d968573921d7b504e69a217316d19ccfd655")
        v2 = json.loads(previous.read_text())
        self.assertEqual(acceptance._hash(v2), acceptance.PREVIOUS_SUITE_HASH)
        expected = copy.deepcopy(v2); expected.update(version="workspace-live-acceptance/v4", promptVersion="workspace/v4",
            previousRegressionSuiteHash=acceptance.PREVIOUS_SUITE_HASH)
        self.assertEqual(self.suite, expected)
        for field in ("cases", "grounding", "rubric", "expectedRoleCounts"):
            self.assertEqual(self.suite[field], v2[field])

    def test_scripted_complete_run_preserves_denominators_and_never_claims_quality_or_person_review(self):
        report, model = self.run_suite()
        self.assertEqual(len(model.calls), 40)
        self.assertEqual(report["totals"]["automatedPassedCases"], 12)
        self.assertEqual(report["totals"]["evaluatedStages"], 32)
        self.assertEqual(report["totals"]["generatedPlanStages"], 8)
        self.assertEqual(report["totals"]["criticOnlyStages"], 2)
        self.assertEqual(report["totals"]["rolePortAttempts"], 40)
        self.assertEqual(report["totals"]["workflowBlockedStages"], 0)
        self.assertEqual(report["totals"]["automatedPassedStages"], 32)
        self.assertEqual(report["totals"]["automatedFailedStages"], 0)
        self.assertFalse(report["modelQualityAccepted"]); self.assertFalse(report["humanReviewed"])
        self.assertTrue(report["requiresExternalHardSupervisor"])
        self.assertTrue(all(stage["qualitativeReview"]["status"] == "PENDING" for case in report["cases"] for stage in case["stages"]))

    def test_expected_oracles_and_grading_rubric_never_enter_any_role_payload(self):
        _, model = self.run_suite()
        forbidden = {"expected", "rubric", "issueAnyOf", "maxRoleCalls", "qualitativeReview", "automatedPassed", "workflow", "priorRefinerStatus"}
        def keys(value):
            if isinstance(value, dict):
                return set(value) | set().union(*(keys(item) for item in value.values()))
            if isinstance(value, list):
                return set().union(*(keys(item) for item in value))
            return set()
        for _, data, _ in model.calls:
            self.assertFalse(keys(data) & forbidden)

    def test_complete_intent_with_actual_nonready_status_blocks_plan_without_hiding_failure_or_later_refine(self):
        model = ScriptedRoles(self.suite); original = model.role
        target = "ko-relative-freeze-cross-language"
        def nonready(role, data, schema):
            result = original(role, data, schema)
            if role == "refine" and data["messages"][-1]["id"] == target + "-user-0":
                result["status"] = "UNSUPPORTED"
            return result
        model.role = nonready; events = []
        report = acceptance.run_suite(self.suite, model=model, execution_kind="scripted_roles", on_event=events.append)
        case = next(case for case in report["cases"] if case["id"] == target)
        first, blocked, later = case["stages"]
        self.assertEqual(first["result"]["intent"]["missingFields"], [])
        self.assertTrue(all(first["result"]["intent"][key] is not None for key in ("purpose", "wallet", "windowStart", "windowEnd", "resourceId")))
        self.assertEqual(first["result"]["status"], "UNSUPPORTED")
        self.assertEqual(blocked["outcome"], "WORKFLOW_BLOCKED")
        self.assertEqual(blocked["result"], {"status": "STOPPED", "code": "WORKFLOW_BLOCKED"})
        self.assertEqual(blocked["rolePortAttempts"], 0); self.assertFalse(blocked["automatedPassed"])
        self.assertIsNone(blocked["plannerSource"])
        self.assertEqual(blocked["workflow"]["priorRefinerStatus"], "UNSUPPORTED")
        self.assertTrue(blocked["workflow"]["priorRefinerValidated"])
        self.assertEqual(blocked["qualitativeReview"]["status"], "NOT_RUN_WORKFLOW_BLOCKED")
        self.assertEqual(later["result"]["status"], "READY_TO_PLAN"); self.assertEqual(later["rolePortAttempts"], 1)
        self.assertEqual(len(model.calls), 38); self.assertEqual(report["totals"]["expectedStages"], 32)
        self.assertEqual(report["totals"]["automatedPassedStages"], 30); self.assertEqual(report["totals"]["automatedFailedStages"], 2)
        self.assertEqual(report["totals"]["workflowBlockedStages"], 1); self.assertEqual(report["totals"]["attemptedPlanStages"], 7)
        self.assertEqual(report["totals"]["plannedRoleCalls"], 40); self.assertIsNone(report["stoppedCode"])
        controls = [case for case in report["cases"] if case["family"] == "critic-stale-proposal"]
        self.assertTrue(all(case["automatedPassed"] for case in controls)); self.assertEqual(len(controls), 2)
        self.assertTrue(all(case["automatedPassed"] for case in report["cases"] if case["id"] != target))
        self.assertEqual(len([event for event in events if event["event"] == "stage_result"]), 32)
        self.assertFalse(any(row["caseId"] == target and row["stageId"] == "later-plan" for row in report["roles"]))

    def test_invalid_complete_clarification_cannot_be_treated_as_a_ready_refiner_for_plan(self):
        model = ScriptedRoles(self.suite); original = model.role
        target = "en-relative-freeze-cross-language"
        def contradictory(role, data, schema):
            result = original(role, data, schema)
            if role == "refine" and data["messages"][-1]["id"] == target + "-user-0":
                result["status"] = "CLARIFICATION_REQUIRED"
            return result
        model.role = contradictory; report, _ = self.run_suite(model)
        case = next(case for case in report["cases"] if case["id"] == target)
        first, blocked, later = case["stages"]
        self.assertEqual(first["result"], {"status": "STOPPED", "code": "WORKSPACE_INVALID_MODEL_OUTPUT"})
        self.assertEqual(blocked["outcome"], "WORKFLOW_BLOCKED"); self.assertEqual(blocked["rolePortAttempts"], 0)
        self.assertEqual(blocked["workflow"]["priorRefinerStatus"], "STOPPED")
        self.assertFalse(blocked["workflow"]["priorRefinerValidated"])
        self.assertEqual(later["rolePortAttempts"], 1)
        self.assertEqual(report["totals"]["expectedStages"], 32); self.assertEqual(len(model.calls), 38)
        self.assertTrue(all(case["automatedPassed"] for case in report["cases"] if case["id"] != target))
        self.assertFalse(report["modelQualityAccepted"]); self.assertFalse(report["humanReviewed"])

    def test_actual_model_goal_and_assistant_are_preserved_when_production_binds_user_output_preferences(self):
        model = ScriptedRoles(self.suite)
        def override(role, data, case):
            if role == "refine" and case["id"] == "ko-long-context-correction" and data["messages"][-1]["id"].endswith("-user-1"):
                expected = case["stages"][1]["expected"]
                return {"contextDigest": data["contextDigest"], "status": "READY_TO_PLAN", "assistantText": "Actual injected wrong-language response.",
                        "intent": {"purpose": purpose("en", "outgoing"), **{key: expected[key] for key in ("wallet", "windowStart", "windowEnd", "resourceId", "missingFields")}}}
        model.override = override
        report, _ = self.run_suite(model)
        case = next(case for case in report["cases"] if case["id"] == "ko-long-context-correction")
        # The production adapter binds real user preferences, not the scoring
        # oracle. An option match must not masquerade as natural-language QA.
        self.assertTrue(case["stages"][1]["checks"]["purposeOutputOptions"])
        self.assertFalse(report["modelQualityAccepted"]); self.assertFalse(report["humanReviewed"])
        self.assertEqual(case["stages"][1]["qualitativeReview"]["status"], "PENDING")
        plans = [data for role, data, _ in model.calls if role == "plan" and data["messages"][-1]["id"].startswith(case["id"])]
        self.assertTrue(plans[0]["intent"]["purpose"].startswith(purpose("en", "outgoing") + "\n"))
        self.assertEqual(infer_output_options(plans[0]["intent"]["purpose"]).language, "ko")
        self.assertEqual(infer_output_options(plans[0]["intent"]["purpose"]).focus, "outgoing")
        raw_role = next(row for row in report["roles"] if row["caseId"] == case["id"]
                        and row["stageId"] == "exact-correction" and row["role"] == "refine")
        self.assertEqual(raw_role["output"]["intent"]["purpose"], purpose("en", "outgoing"))
        self.assertEqual(plans[0]["messages"][-1]["text"], "Actual injected wrong-language response.")
        self.assertTrue(all(stage["historyMessages"] <= 12 for stage in case["stages"]))

    def test_relative_interval_stays_frozen_and_style_turn_deliberately_changes_output_language(self):
        report, _ = self.run_suite()
        for language, target in (("ko", "en"), ("en", "ko")):
            case = next(case for case in report["cases"] if case["id"] == language + "-relative-freeze-cross-language")
            start, end = case["stages"][0]["result"]["intent"]["windowStart"], case["stages"][0]["result"]["intent"]["windowEnd"]
            final = case["stages"][-1]
            self.assertEqual((start, end), ("2026-11-06T12:00:00.000Z", "2026-11-07T12:00:00.000Z"))
            self.assertEqual((final["result"]["intent"]["windowStart"], final["result"]["intent"]["windowEnd"]), (start, end))
            self.assertEqual(final["presentation"]["actualOptions"], {"language": target, "focus": "incoming"})

    def test_critic_only_fixture_is_not_generated_plan_and_accept_with_issues_does_not_pass(self):
        model = ScriptedRoles(self.suite)
        def override(role, data, case):
            if role == "critic" and case["family"] == "critic-stale-proposal":
                return {"contextDigest": data["contextDigest"], "verdict": "ACCEPT", "reason": "Stale scope noted.", "issueCodes": ["STALE_INTENT"]}
        model.override = override
        report, _ = self.run_suite(model)
        cases = [case for case in report["cases"] if case["family"] == "critic-stale-proposal"]
        self.assertTrue(all(not case["automatedPassed"] for case in cases))
        self.assertTrue(all(case["stages"][0]["result"]["code"] == "WORKSPACE_PLAN_REJECTED" for case in cases))
        self.assertTrue(all(not case["stages"][0]["checks"]["criticVerdict"] for case in cases))
        self.assertTrue(all(case["stages"][0]["plannerSource"] == "injected_negative_fixture" for case in cases))

    def test_port_failure_stops_all_remaining_work_without_retry_or_denominator_shrink(self):
        class Failed:
            calls = 0
            def role(self, *_):
                self.calls += 1
                raise RuntimeError("private provider diagnostic")
        model = Failed(); report, _ = self.run_suite(model)
        self.assertEqual(model.calls, 1)
        self.assertEqual(report["totals"]["expectedCases"], 12)
        self.assertEqual(report["totals"]["expectedStages"], 32)
        self.assertEqual(report["totals"]["portFailedStages"], 1)
        self.assertEqual(report["totals"]["notRunStages"], 31)
        self.assertEqual(report["totals"]["automatedPassedCases"], 0)
        self.assertNotIn("private provider diagnostic", json.dumps(report))

    def test_synthetic_presentation_preserves_large_amounts_refs_and_partial_flags_separately(self):
        report, _ = self.run_suite()
        rows = [stage["presentation"] for case in report["cases"] for stage in case["stages"] if stage.get("presentation") and stage["presentation"]["status"] == "SYNTHETIC_FORMATTER_ONLY"]
        self.assertTrue(rows)
        for row in rows:
            self.assertTrue(row["factsPreserved"]); self.assertFalse(row["modelGeneratedGrounding"])
            self.assertFalse(row["protectedConsumptionRan"]); self.assertTrue(row["isSynthetic"]); self.assertFalse(row["complete"])

    def test_loader_rejects_duplicate_keys_and_oversized_json_with_fixed_errors(self):
        with tempfile.TemporaryDirectory(prefix="floww-acceptance-offline-") as directory:
            file = Path(directory) / "suite.json"
            for text in ('{"version":"first","version":"second"}', ' ' * 256_001):
                file.write_text(text, encoding="utf-8")
                with self.assertRaises(acceptance.InvalidAcceptance):
                    acceptance.load_suite(file)

    def test_no_default_or_different_model_can_run(self):
        with self.assertRaises(acceptance.InvalidAcceptance):
            acceptance.run_suite(self.suite, model=None, execution_kind="scripted_roles")
        with self.assertRaises(acceptance.InvalidAcceptance):
            acceptance.run_suite(self.suite, model=ScriptedRoles(self.suite), execution_kind="scripted_roles", model_name="another-model")

    def test_incremental_events_precede_dispatch_and_remain_defensive_bounded_records(self):
        model, events = ScriptedRoles(self.suite), []
        report = acceptance.run_suite(self.suite, model=model, execution_kind="scripted_roles", on_event=events.append)
        self.assertEqual(events[0]["event"], "role_attempt")
        self.assertNotIn("output", events[0])
        self.assertEqual(len([event for event in events if event["event"] == "role_returned"]), 40)
        self.assertEqual(len([event for event in events if event["event"] == "stage_result"]), 32)
        self.assertTrue(all(event["elapsedMs"] >= 0 for event in events if event["event"] == "role_returned"))
        events[0]["caseId"] = "changed-outside"
        self.assertNotEqual(report["roles"][0]["caseId"], "changed-outside")

    def test_artifact_failure_stops_before_dispatch_without_becoming_a_model_or_transport_failure(self):
        model = ScriptedRoles(self.suite)
        def failed_writer(_):
            raise RuntimeError("private artifact diagnostic")
        report = acceptance.run_suite(self.suite, model=model, execution_kind="scripted_roles", on_event=failed_writer)
        self.assertEqual(len(model.calls), 0)
        self.assertEqual(report["stoppedCode"], "ARTIFACT_WRITE_FAILED")
        self.assertEqual(report["totals"]["modelPortInvocations"], 0)
        self.assertEqual(report["totals"]["artifactFailedStages"], 1)
        self.assertEqual(report["totals"]["portFailedStages"], 0)
        self.assertEqual(report["totals"]["notRunStages"], 31)
        self.assertNotIn("private artifact diagnostic", json.dumps(report))

    def test_unknown_role_fields_are_redacted_without_disguising_the_guard_failure_as_success(self):
        model = ScriptedRoles(self.suite)
        original = model.role
        def injected(role, data, schema):
            result = original(role, data, schema)
            if role == "refine":
                result["private_unexpected_field"] = "private payload not in allowed DTO"
            return result
        model.role = injected
        report, _ = self.run_suite(model)
        self.assertEqual(report["totals"]["automatedPassedCases"], 2)  # critic-only controls have no refiner
        self.assertTrue(all(not case["automatedPassed"] for case in report["cases"] if case["family"] != "critic-stale-proposal"))
        self.assertNotIn("private payload", json.dumps(report))
        self.assertNotIn("private_unexpected_field", json.dumps(report))
        self.assertTrue(any(role.get("output", {}).get("unexpectedFieldsRedacted") for role in report["roles"]))
        self.assertEqual(report["totals"]["workflowBlockedStages"], 8)
        self.assertEqual(report["totals"]["attemptedPlanStages"], 0)
        self.assertEqual(report["totals"]["rolePortAttempts"], 24)
        self.assertEqual(report["totals"]["expectedStages"], 32)
        blocked = [stage for case in report["cases"] for stage in case["stages"] if stage["outcome"] == "WORKFLOW_BLOCKED"]
        self.assertTrue(all(not stage["workflow"]["priorRefinerValidated"] and stage["workflow"]["priorRefinerStatus"] == "STOPPED" for stage in blocked))


if __name__ == "__main__":
    unittest.main()
