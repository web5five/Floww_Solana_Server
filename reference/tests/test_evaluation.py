"""Synthetic/scripted runner tests, not evidence of real-model quality."""

import json
import unittest
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from ai_baseline import workflow
from ai_baseline.evaluation import (
    DEFAULT_SUITE, MAX_CASES, MAX_SUITE_BYTES, EvaluationSuite, InvalidSuite,
    load_suite, parse_suite, run_evaluation,
)


def propose(candidate_id="wallet-activity", reason="Synthetic scripted choice"):
    return json.dumps({"action": "PROPOSE", "candidate_id": candidate_id, "reason": reason})


def evidence(*ids):
    return json.dumps({"record_ids": list(ids)})


class PurposeEvidenceEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.suite = load_suite()

    def one_case(self, index=0):
        return replace(self.suite, cases=(self.suite.cases[index],))

    def run_one(self, selection=None, result=None, index=0):
        selector = Mock(return_value=propose() if selection is None else selection)
        reader = Mock(return_value=evidence("activity", "window") if result is None else result)
        report = run_evaluation(self.one_case(index), selector, reader, execution_kind="scripted")
        return report, selector, reader

    def test_all_six_synthetic_scripted_cases_match_with_separate_counters(self):
        selector = Mock(side_effect=[
            propose(), json.dumps({"action": "STOP", "reason": "No relevant resource"}),
            json.dumps({"action": "CLARIFY", "question": "Which information do you need?"}),
            propose(), propose(), propose(),
        ])
        reader = Mock(side_effect=[evidence("activity", "window"), evidence("activity"),
                                   evidence("activity"), evidence("activity")])
        report = run_evaluation(self.suite, selector, reader, execution_kind="scripted")
        self.assertEqual(report.input_kind, "synthetic")
        self.assertEqual(report.execution_kind, "scripted")
        self.assertEqual(report.backend_kind, "synthetic_fixture")
        self.assertEqual(report.totals.cases, 6)
        self.assertEqual(report.totals.cases_passed, 6)
        self.assertEqual(report.totals.cases_failed, 0)
        self.assertEqual(report.totals.selection_calls, 6)
        self.assertEqual(report.totals.selection_structurally_valid, 6)
        self.assertEqual(report.totals.selection_expectation_matches, 6)
        self.assertEqual(report.totals.evidence_required, 4)
        self.assertEqual(report.totals.evidence_calls, 4)
        self.assertEqual(report.totals.evidence_structurally_valid, 4)
        self.assertEqual(report.totals.evidence_expectation_matches, 4)
        self.assertEqual(report.totals.resource_reads, 4)
        self.assertEqual(selector.call_count, 6)
        self.assertEqual(reader.call_count, 4)
        self.assertIsNone(report.cases[1].evidence.structural_valid)
        self.assertIsNone(report.cases[2].evidence.expectation_match)

    def test_valid_irrelevant_candidate_is_quality_failure_without_consumption(self):
        report, selector, reader = self.run_one(selection=propose("translation"))
        case = report.cases[0]
        self.assertTrue(case.selection.structural_valid)
        self.assertFalse(case.selection.expectation_match)
        self.assertFalse(case.passed)
        self.assertEqual(case.evidence.code, "SELECTION_MISMATCH")
        self.assertEqual(case.resource_reads, 0)
        self.assertEqual(report.totals.selection_structurally_valid, 1)
        self.assertEqual(report.totals.selection_expectation_matches, 0)
        self.assertEqual(report.totals.cases_failed, 1)
        self.assertEqual(selector.call_count, 1)
        reader.assert_not_called()

    def test_merchant_injection_candidate_is_valid_but_does_not_match_purpose(self):
        report, _, reader = self.run_one(selection=propose("translation"), index=3)
        self.assertTrue(report.cases[0].selection.structural_valid)
        self.assertFalse(report.cases[0].selection.expectation_match)
        reader.assert_not_called()

    def test_missing_required_evidence_is_valid_but_not_an_expectation_match(self):
        report, _, _ = self.run_one(result=evidence("activity"))
        case = report.cases[0]
        self.assertTrue(case.evidence.structural_valid)
        self.assertFalse(case.evidence.expectation_match)
        self.assertFalse(case.passed)
        self.assertEqual(report.totals.evidence_structurally_valid, 1)
        self.assertEqual(report.totals.evidence_expectation_matches, 0)

    def test_extra_existing_irrelevant_evidence_is_quality_failure(self):
        report, _, _ = self.run_one(result=evidence("activity", "window", "advertisement"))
        self.assertTrue(report.cases[0].evidence.structural_valid)
        self.assertFalse(report.cases[0].evidence.expectation_match)

    def test_record_prompt_injection_is_known_but_wrong_evidence(self):
        report, _, _ = self.run_one(result=evidence("merchant-note"), index=4)
        self.assertTrue(report.cases[0].evidence.structural_valid)
        self.assertFalse(report.cases[0].evidence.expectation_match)
        self.assertEqual(report.cases[0].evidence.observed_record_ids, ("merchant-note",))
        self.assertFalse(report.cases[0].passed)

    def test_evidence_order_is_not_a_quality_difference(self):
        report, _, _ = self.run_one(result=evidence("window", "activity"))
        self.assertTrue(report.cases[0].passed)
        self.assertEqual(report.cases[0].evidence.observed_record_ids, ("window", "activity"))

    def test_invented_candidate_is_rejected_by_workflow(self):
        report, _, reader = self.run_one(selection=propose("wallet-premium"), index=5)
        self.assertFalse(report.cases[0].selection.structural_valid)
        self.assertFalse(report.cases[0].selection.expectation_match)
        self.assertEqual(report.cases[0].selection.code, "INVALID_SELECTION")
        self.assertIsNone(report.cases[0].selection.observed_candidate_id)
        reader.assert_not_called()

    def test_invented_or_duplicate_evidence_ids_are_structurally_invalid(self):
        for ids in (("r999",), ("activity", "activity")):
            with self.subTest(ids=ids):
                report, _, reader = self.run_one(result=evidence(*ids), index=5)
                self.assertEqual(report.cases[0].evidence.code, "INVALID_RESULT_REFERENCES")
                self.assertFalse(report.cases[0].evidence.structural_valid)
                self.assertFalse(report.cases[0].evidence.expectation_match)
                self.assertEqual(report.cases[0].evidence.observed_record_ids, ())
                self.assertEqual(report.totals.evidence_structurally_invalid, 1)
                self.assertEqual(reader.call_count, 1)

    def test_authority_fields_are_rejected_not_scored_as_quality_success(self):
        raw = json.loads(propose())
        raw["policy"] = "ALLOW"
        report, _, reader = self.run_one(selection=json.dumps(raw))
        self.assertFalse(report.cases[0].selection.structural_valid)
        self.assertEqual(report.cases[0].selection.code, "INVALID_SELECTION")
        reader.assert_not_called()

    def test_invalid_json_duplicate_fields_and_non_string_model_output(self):
        for raw in ("not-json", '{"action":"STOP","action":"PROPOSE","reason":"test"}',
                    {"action": "STOP"}, "\ud800"):
            with self.subTest(output_type=type(raw).__name__):
                report, _, reader = self.run_one(selection=raw)
                self.assertFalse(report.cases[0].selection.structural_valid)
                self.assertFalse(report.cases[0].passed)
                self.assertEqual(report.totals.selection_structurally_invalid, 1)
                reader.assert_not_called()

    def test_wrong_action_is_valid_but_fails_expected_clarification(self):
        report, _, reader = self.run_one(index=2)
        case = report.cases[0]
        self.assertTrue(case.selection.structural_valid)
        self.assertFalse(case.selection.expectation_match)
        self.assertEqual(case.selection.observed_action, "PROPOSE")
        self.assertFalse(case.passed)
        reader.assert_not_called()

    def test_selection_exception_is_unavailable_and_each_case_is_attempted_once(self):
        selector = Mock(side_effect=RuntimeError("private-provider-token-987"))
        reader = Mock()
        report = run_evaluation(self.suite, selector, reader, execution_kind="caller_supplied")
        self.assertEqual(report.execution_kind, "caller_supplied")
        self.assertEqual(report.totals.selection_calls, 6)
        self.assertEqual(report.totals.selection_unavailable, 6)
        self.assertEqual(report.totals.selection_structurally_invalid, 0)
        self.assertEqual(report.totals.cases_failed, 6)
        self.assertEqual(selector.call_count, 6)
        self.assertIsNone(report.cases[0].selection.structural_valid)
        self.assertNotIn("private-provider-token-987", json.dumps(asdict(report)))
        reader.assert_not_called()

    def test_evidence_exception_is_unavailable_without_retries(self):
        selector = Mock(return_value=propose())
        reader = Mock(side_effect=TimeoutError("secret-http-body"))
        report = run_evaluation(self.one_case(), selector, reader, execution_kind="caller_supplied")
        self.assertTrue(report.cases[0].selection.structural_valid)
        self.assertIsNone(report.cases[0].evidence.structural_valid)
        self.assertFalse(report.cases[0].evidence.expectation_match)
        self.assertEqual(report.cases[0].evidence.code, "RESULT_MODEL_UNAVAILABLE")
        self.assertEqual(report.totals.evidence_unavailable, 1)
        self.assertEqual(report.totals.evidence_structurally_invalid, 0)
        self.assertEqual(report.totals.resource_reads, 1)
        self.assertEqual(selector.call_count, 1)
        self.assertEqual(reader.call_count, 1)
        self.assertNotIn("secret-http-body", json.dumps(asdict(report)))

    def test_report_omits_raw_purpose_evidence_rationale_and_question(self):
        marker = "private-content-12345"
        case = replace(self.suite.cases[0], purpose=marker,
                       records=(("activity", marker), ("window", marker)))
        selector = Mock(return_value=propose(reason=marker))
        reader = Mock(return_value=evidence("activity", "window"))
        report = run_evaluation(replace(self.suite, cases=(case,)), selector, reader,
                                execution_kind="caller_supplied")
        serialized = json.dumps(asdict(report))
        self.assertTrue(report.cases[0].passed)
        self.assertNotIn(marker, serialized)
        self.assertNotIn("eval-settlement", serialized)
        self.assertNotIn("proposal_ref", serialized)
        report, _, _ = self.run_one(selection=json.dumps({"action": "CLARIFY", "question": marker}), index=2)
        self.assertTrue(report.cases[0].passed)
        self.assertNotIn(marker, json.dumps(asdict(report)))

    def test_models_receive_only_existing_ports_without_expected_answers(self):
        report, selector, reader = self.run_one()
        self.assertTrue(report.cases[0].passed)
        instruction, purpose, candidates = selector.call_args.args
        self.assertEqual(instruction, workflow.SELECTION_INSTRUCTION)
        self.assertEqual(purpose, self.suite.cases[0].purpose)
        self.assertTrue(all(type(item) is workflow.Candidate for item in candidates))
        instruction, purpose, records = reader.call_args.args
        self.assertEqual(instruction, workflow.RESULT_INSTRUCTION)
        self.assertEqual(purpose, self.suite.cases[0].purpose)
        self.assertTrue(all(type(item) is workflow.Record for item in records))
        self.assertEqual(tuple(record.record_id for record in records), ("activity", "window", "advertisement"))

    def test_real_workflow_validation_and_access_gate_are_used(self):
        with patch.object(workflow, "propose", wraps=workflow.propose) as proposal_check, \
                patch.object(workflow, "consume", wraps=workflow.consume) as result_check, \
                patch.object(workflow, "read_confirmed_resource", wraps=workflow.read_confirmed_resource) as gate:
            report, _, _ = self.run_one()
        self.assertTrue(report.cases[0].passed)
        self.assertEqual(proposal_check.call_count, 1)
        self.assertEqual(result_check.call_count, 1)
        self.assertEqual(gate.call_count, 1)
        self.assertEqual(gate.call_args.args[1].evidence_kind, "synthetic_fixture")

    def test_fixed_clock_and_report_metadata_are_repeatable(self):
        suite = replace(self.one_case(), fixed_now=datetime(2001, 1, 1, tzinfo=timezone.utc))
        def run():
            return run_evaluation(suite, lambda *_: propose(),
                                  lambda *_: evidence("activity", "window"), execution_kind="scripted")
        self.assertEqual(asdict(run()), asdict(run()))
        self.assertTrue(run().cases[0].passed)

    def test_suite_rejects_over_limit_count_and_invalid_direct_construction_before_calls(self):
        selector, reader = Mock(), Mock()
        bad_suites = [
            replace(self.suite, cases=self.suite.cases[:1] * (MAX_CASES + 1)),
            replace(self.suite, cases=()),
            replace(self.suite, synthetic=False),
            replace(self.suite, cases=(replace(self.suite.cases[0], candidates=()),)),
            replace(self.suite, fixed_now=datetime.max.replace(tzinfo=timezone.utc)),
            EvaluationSuite(self.suite.version, True, self.suite.fixed_now, [self.suite.cases[0]]),
        ]
        for suite in bad_suites:
            with self.subTest(suite_shape=type(suite.cases).__name__), self.assertRaises(InvalidSuite):
                run_evaluation(suite, selector, reader, execution_kind="scripted")
        selector.assert_not_called()
        reader.assert_not_called()

    def test_suite_json_shape_reference_and_bound_errors_are_rejected(self):
        raw = json.loads(DEFAULT_SUITE.read_text(encoding="utf-8"))
        changes = [
            lambda data: data.update(synthetic=False),
            lambda data: data.update(fixed_now="2026-11-01T00:00:00"),
            lambda data: data.update(fixed_now="2026-11-01T00:00:00+01:00"),
            lambda data: data["cases"][0].update(category="unbounded-category"),
            lambda data: data["cases"][0].update(case_id="arbitrary secret message"),
            lambda data: data["cases"][0]["expected"].update(candidate_id="invented"),
            lambda data: data["cases"][0]["expected"].update(record_ids=["missing"]),
            lambda data: data["cases"][1]["expected"].update(record_ids=["activity"]),
            lambda data: data["cases"][0]["candidates"].append(data["cases"][0]["candidates"][0]),
            lambda data: data["cases"][0]["records"].append(data["cases"][0]["records"][0]),
            lambda data: data["cases"][0]["candidates"][0].update(description="x" * 2001),
            lambda data: data["cases"].append(data["cases"][0]),
            lambda data: data.update(extra="unsupported"),
        ]
        for mutate in changes:
            data = json.loads(json.dumps(raw))
            mutate(data)
            with self.subTest(change=changes.index(mutate)), self.assertRaises(InvalidSuite):
                parse_suite(json.dumps(data))

    def test_suite_rejects_duplicate_keys_nonfinite_unicode_and_oversized_inputs(self):
        for raw in ('{"version":1,"version":2}', '{"version":NaN}', "\ud800",
                    "x" * (MAX_SUITE_BYTES + 1), "[" * 1500, []):
            with self.subTest(input_type=type(raw).__name__), self.assertRaises(InvalidSuite):
                parse_suite(raw)

    def test_catalog_record_and_protected_body_bounds_reject_before_model_calls(self):
        case = self.suite.cases[0]
        oversized_cases = [
            replace(case, candidates=tuple((f"candidate-{i}", "Synthetic resource") for i in range(21))),
            replace(case, records=tuple((f"record-{i}", "Synthetic fact") for i in range(51))),
            replace(case, records=(("activity", "x" * 8001), ("window", "boundary"))),
            replace(case, records=(("activity", "fact"), ("window", "boundary"))
                    + tuple((f"record-{i}", "x" * 8000) for i in range(9))),
        ]
        selector, reader = Mock(), Mock()
        for item in oversized_cases:
            with self.subTest(record_count=len(item.records)), self.assertRaises(InvalidSuite):
                run_evaluation(replace(self.suite, cases=(item,)), selector, reader,
                               execution_kind="scripted")
        selector.assert_not_called()
        reader.assert_not_called()

    def test_invalid_suite_errors_have_no_raw_exception_chain(self):
        marker = "private-synthetic-input-do-not-retain"
        for raw in ('{"purpose":"' + marker + '",bad-json}', "\ud800" + marker):
            with self.subTest(input_kind=type(raw).__name__):
                try:
                    parse_suite(raw)
                except InvalidSuite as exc:
                    self.assertIsNone(exc.__context__)
                    self.assertIsNone(exc.__cause__)
                    self.assertNotIn(marker, str(exc))
                else:
                    self.fail("Invalid input was accepted")
        with TemporaryDirectory() as folder:
            path = Path(folder) / marker
            for content in (None, b"\xff" + marker.encode()):
                if content is not None:
                    path.write_bytes(content)
                try:
                    load_suite(path)
                except InvalidSuite as exc:
                    self.assertIsNone(exc.__context__)
                    self.assertIsNone(exc.__cause__)
                    self.assertNotIn(marker, str(exc))
                else:
                    self.fail("Invalid file was accepted")
        try:
            run_evaluation(replace(self.one_case(), fixed_now=datetime.max.replace(tzinfo=timezone.utc)),
                           Mock(), Mock(), execution_kind="scripted")
        except InvalidSuite as exc:
            self.assertIsNone(exc.__context__)
            self.assertIsNone(exc.__cause__)
        else:
            self.fail("Overflowing clock was accepted")

    def test_loader_is_bounded_and_uses_constant_failure_message(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.json"
            path.write_bytes(b"x" * (MAX_SUITE_BYTES + 1))
            with self.assertRaisesRegex(InvalidSuite, "^Unable to load synthetic evaluation suite$"):
                load_suite(path)
            path.write_bytes(b"\xff")
            with self.assertRaises(InvalidSuite):
                load_suite(path)
            with self.assertRaisesRegex(InvalidSuite, "^Unable to load synthetic evaluation suite$"):
                load_suite(Path(folder) / "private-path-do-not-log")

    def test_explicit_execution_label_and_both_model_ports_are_required(self):
        selector, reader = Mock(), Mock()
        with self.assertRaises(TypeError):
            run_evaluation(self.suite, selector, reader)
        for kind in ("live_verified", None, ["scripted"]):
            with self.subTest(kind=type(kind).__name__), self.assertRaises(InvalidSuite):
                run_evaluation(self.suite, selector, reader, execution_kind=kind)
        with self.assertRaises(InvalidSuite):
            run_evaluation(self.suite, None, reader, execution_kind="scripted")
        selector.assert_not_called()
        reader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
