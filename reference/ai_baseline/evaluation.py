"""Synthetic purpose/evidence checks through the existing workflow boundaries.

Callers explicitly inject both model ports. No provider, network client, payment
client, retries or default model is selected here. Reports contain only bounded
case metadata and IDs; model text and fixture bodies are never copied into them.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from . import workflow


SUITE_VERSION = "purpose-and-evidence/v1"
DEFAULT_SUITE = Path(__file__).resolve().parents[1] / "evaluations" / "purpose-and-evidence-v1.json"
MAX_CASES = 32
MAX_SUITE_BYTES = 256_000
_CATEGORIES = frozenset({"normal_purpose", "unrelated_resource", "ambiguous_request",
                         "merchant_injection", "record_injection", "invented_references"})


class InvalidSuite(ValueError):
    """Invalid synthetic evaluation input; the error never contains input text."""


@dataclass(frozen=True)
class Expected:
    action: str
    candidate_id: str | None
    record_ids: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    category: str
    purpose: str
    candidates: tuple[tuple[str, str], ...]
    records: tuple[tuple[str, str], ...]
    expected: Expected


@dataclass(frozen=True)
class EvaluationSuite:
    version: str
    synthetic: bool
    fixed_now: datetime
    cases: tuple[EvaluationCase, ...]


@dataclass(frozen=True)
class StageScore:
    status: str
    code: str
    structural_valid: bool | None
    expectation_match: bool | None
    observed_action: str | None = None
    observed_candidate_id: str | None = None
    observed_record_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class CaseScore:
    case_id: str
    category: str
    expected: Expected
    selection: StageScore
    evidence: StageScore
    passed: bool
    selection_calls: int
    evidence_calls: int
    resource_reads: int


@dataclass(frozen=True)
class Totals:
    cases: int
    cases_passed: int
    cases_failed: int
    selection_calls: int
    selection_structurally_valid: int
    selection_structurally_invalid: int
    selection_unavailable: int
    selection_expectation_matches: int
    evidence_required: int
    evidence_calls: int
    evidence_structurally_valid: int
    evidence_structurally_invalid: int
    evidence_unavailable: int
    evidence_expectation_matches: int
    resource_reads: int


@dataclass(frozen=True)
class EvaluationReport:
    suite_version: str
    input_kind: str
    execution_kind: str
    backend_kind: str
    totals: Totals
    cases: tuple[CaseScore, ...]


def _id(value: object) -> bool:
    return type(value) is str and re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", value) is not None


def _text(value: object, limit: int) -> bool:
    if type(value) is not str or not value.strip() or len(value) > limit:
        return False
    try:
        value.encode("utf-8")
    except UnicodeError:
        return False
    return all(ord(char) >= 32 or char in "\n\t" for char in value)


def _validate_suite(suite: EvaluationSuite) -> None:
    if (type(suite) is not EvaluationSuite or suite.version != SUITE_VERSION
            or suite.synthetic is not True or type(suite.fixed_now) is not datetime
            or suite.fixed_now.tzinfo is None or suite.fixed_now.utcoffset() != timedelta(0)
            or type(suite.cases) is not tuple or not 1 <= len(suite.cases) <= MAX_CASES):
        raise InvalidSuite("Invalid suite contract")
    seen = set()
    for case in suite.cases:
        if (type(case) is not EvaluationCase or not _id(case.case_id) or case.case_id in seen
                or type(case.category) is not str or case.category not in _CATEGORIES
                or not _text(case.purpose, 2_000)):
            raise InvalidSuite("Invalid case contract")
        seen.add(case.case_id)
        for rows, limit, text_limit in ((case.candidates, workflow.MAX_CANDIDATES, 2_000),
                                        (case.records, workflow.MAX_RECORDS, 8_000)):
            if (type(rows) is not tuple or len(rows) > limit
                    or any(type(row) is not tuple or len(row) != 2
                           or not _id(row[0]) or not _text(row[1], text_limit) for row in rows)
                    or len({row[0] for row in rows}) != len(rows)):
                raise InvalidSuite("Invalid catalog contract")
        # Every evaluation case must call the selector; empty discovery is a
        # workflow fallback, not evidence of model purpose understanding.
        if not case.candidates:
            raise InvalidSuite("Selection candidates required")
        expected = case.expected
        if (type(expected) is not Expected or type(expected.action) is not str
                or expected.action not in {"PROPOSE", "CLARIFY", "STOP"}
                or type(expected.record_ids) is not tuple
                or any(not _id(value) for value in expected.record_ids)
                or len(set(expected.record_ids)) != len(expected.record_ids)):
            raise InvalidSuite("Invalid expectation contract")
        if expected.action == "PROPOSE":
            if (not _id(expected.candidate_id)
                    or expected.candidate_id not in {row[0] for row in case.candidates}
                    or not 1 <= len(expected.record_ids) <= 10
                    or not set(expected.record_ids) <= {row[0] for row in case.records}):
                raise InvalidSuite("Unknown expected reference")
        elif expected.candidate_id is not None or expected.record_ids:
            raise InvalidSuite("Unexpected references for non-proposal")
        if len(_body(case).encode("utf-8")) > workflow.MAX_BODY_BYTES:
            raise InvalidSuite("Oversized protected resource")
    invalid_clock = False
    try:
        suite.fixed_now + timedelta(hours=1)
    except OverflowError:
        invalid_clock = True
    if invalid_clock:
        raise InvalidSuite("Invalid fixed clock")


def _body(case: EvaluationCase) -> str:
    return json.dumps([{"id": record_id, "text": text} for record_id, text in case.records],
                      ensure_ascii=False, separators=(",", ":"))


def _pairs(items: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in items:
        if key in result:
            raise InvalidSuite("Duplicate JSON field")
        result[key] = value
    return result


def _constant(_: str) -> None:
    raise InvalidSuite("Non-finite JSON value")


def parse_suite(raw: str) -> EvaluationSuite:
    """Parse a bounded, strict synthetic suite without logging its contents."""
    try:
        if type(raw) is not str or len(raw.encode("utf-8")) > MAX_SUITE_BYTES:
            raise InvalidSuite("Invalid suite size")
        value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=_constant)
        if (type(value) is not dict
                or set(value) != {"version", "synthetic", "fixed_now", "cases"}
                or type(value["fixed_now"]) is not str or type(value["cases"]) is not list
                or not 1 <= len(value["cases"]) <= MAX_CASES):
            raise InvalidSuite("Invalid suite shape")
        cases = []
        for item in value["cases"]:
            if (type(item) is not dict
                    or set(item) != {"case_id", "category", "purpose", "candidates", "records", "expected"}):
                raise InvalidSuite("Invalid case shape")
            rows = []
            for key, id_key in (("candidates", "candidate_id"), ("records", "id")):
                if type(item[key]) is not list:
                    raise InvalidSuite("Invalid catalog shape")
                text_key = "description" if key == "candidates" else "text"
                if any(type(row) is not dict or set(row) != {id_key, text_key} for row in item[key]):
                    raise InvalidSuite("Invalid catalog row")
                rows.append(tuple((row[id_key], row[text_key]) for row in item[key]))
            expected = item["expected"]
            if (type(expected) is not dict or set(expected) != {"action", "candidate_id", "record_ids"}
                    or type(expected["record_ids"]) is not list):
                raise InvalidSuite("Invalid expectation shape")
            cases.append(EvaluationCase(item["case_id"], item["category"], item["purpose"],
                                        rows[0], rows[1], Expected(expected["action"],
                                        expected["candidate_id"], tuple(expected["record_ids"]))))
        suite = EvaluationSuite(value["version"], value["synthetic"],
                                datetime.fromisoformat(value["fixed_now"]), tuple(cases))
        _validate_suite(suite)
        return suite
    except (ValueError, TypeError, KeyError, RecursionError, UnicodeError, OverflowError):
        pass
    # Raise after the handler so decoder exceptions cannot retain the raw
    # dataset through __context__ (even when traceback chaining is inspected).
    raise InvalidSuite("Invalid synthetic evaluation suite")


def load_suite(path: str | Path = DEFAULT_SUITE) -> EvaluationSuite:
    """Load at most MAX_SUITE_BYTES from an explicitly local dataset file."""
    try:
        with Path(path).open("rb") as handle:
            raw = handle.read(MAX_SUITE_BYTES + 1)
        if len(raw) > MAX_SUITE_BYTES:
            raise InvalidSuite("Invalid suite size")
        return parse_suite(raw.decode("utf-8"))
    except (OSError, ValueError, UnicodeError):
        pass
    raise InvalidSuite("Unable to load synthetic evaluation suite")


def _selection_score(result: workflow.Result, expected: Expected) -> StageScore:
    action = {"BACKEND_REVIEW_REQUIRED": "PROPOSE", "AMBIGUOUS_PURPOSE": "CLARIFY",
              "NO_SUITABLE_RESOURCE": "STOP"}.get(result.code)
    candidate_id = result.proposal.candidate.candidate_id if result.proposal else None
    structural = True if action else (False if result.code == "INVALID_SELECTION" else None)
    match = action == expected.action and candidate_id == expected.candidate_id
    return StageScore(result.status, result.code, structural, match, action, candidate_id)


def _run_case(suite: EvaluationSuite, case: EvaluationCase,
              select: workflow.SelectionModel, select_evidence: workflow.EvidenceModel) -> CaseScore:
    counts = {"selection": 0, "evidence": 0, "read": 0}
    context = workflow.Context("eval-owner", "eval-task/" + case.case_id, "v1",
                               "eval-mandate", "v1", case.purpose,
                               suite.fixed_now + timedelta(hours=1))
    candidates = tuple(workflow.Candidate(
        candidate_id, "eval-merchant", "eval-resource/" + candidate_id,
        "eval-requirements/" + candidate_id, "1", "eval-asset", "eval-network",
        "eval-recipient", description, suite.fixed_now + timedelta(minutes=10))
        for candidate_id, description in case.candidates)

    def selection_port(instruction, purpose, supplied_candidates):
        counts["selection"] += 1
        return select(instruction, purpose, supplied_candidates)

    result = workflow.propose(context, lambda _: candidates, selection_port,
                              lambda: context, clock=lambda: suite.fixed_now)
    selection = _selection_score(result, case.expected)
    if not selection.expectation_match:
        evidence = StageScore("SKIPPED", "SELECTION_MISMATCH", None,
                              False if case.expected.action == "PROPOSE" else None)
    elif case.expected.action != "PROPOSE":
        evidence = StageScore("SKIPPED", "NOT_EXPECTED", None, None)
    else:
        proposal = result.proposal
        # This fabricated backend observation exercises only the local gates;
        # no payment, settlement, merchant delivery or authorization is run.
        outcome = workflow.BackendOutcome(
            proposal.proposal_ref, context, proposal.candidate.requirements_ref,
            "eval-attempt", "ALLOW", "CONFIRMED", "COMPLETED", "eval-settlement",
            "eval-delivery/" + case.case_id, evidence_kind="synthetic_fixture")

        def read_resource(delivery_ref):
            counts["read"] += 1
            return workflow.ProtectedResource(delivery_ref, "application/json", _body(case))

        def evidence_port(instruction, purpose, records):
            counts["evidence"] += 1
            return select_evidence(instruction, purpose, records)

        consumed = workflow.consume(proposal, outcome, read_resource, evidence_port, lambda: context)
        ids = tuple(record.record_id for record in consumed.excerpts)
        structural = (True if consumed.code == "CITED_EXCERPTS" else
                      False if consumed.code == "INVALID_RESULT_REFERENCES" else None)
        match = structural is True and set(ids) == set(case.expected.record_ids)
        evidence = StageScore(consumed.status, consumed.code, structural, match,
                              observed_record_ids=ids)
    passed = selection.expectation_match is True and (
        case.expected.action != "PROPOSE" or evidence.expectation_match is True)
    return CaseScore(case.case_id, case.category, case.expected, selection, evidence, passed,
                     counts["selection"], counts["evidence"], counts["read"])


def run_evaluation(suite: EvaluationSuite, selection_model: workflow.SelectionModel,
                   evidence_model: workflow.EvidenceModel, *,
                   execution_kind: Literal["scripted", "caller_supplied"]) -> EvaluationReport:
    """Run each synthetic case once with explicit ports and a fixed suite clock.

    execution_kind is a caller declaration, not provider attestation. Exceptions
    reported by a port become fixed workflow codes. The caller owns deadlines
    and logging inside its ports; this synchronous runner cannot cancel a hang.
    """
    _validate_suite(suite)
    if (type(execution_kind) is not str or execution_kind not in {"scripted", "caller_supplied"}
            or not callable(selection_model) or not callable(evidence_model)):
        raise InvalidSuite("Explicit model ports and execution kind required")
    cases = tuple(_run_case(suite, case, selection_model, evidence_model) for case in suite.cases)
    selection = tuple(case.selection for case in cases)
    evidence = tuple(case.evidence for case in cases)
    totals = Totals(
        len(cases), sum(case.passed for case in cases), sum(not case.passed for case in cases),
        sum(case.selection_calls for case in cases),
        sum(score.structural_valid is True for score in selection),
        sum(score.structural_valid is False for score in selection),
        sum(score.code == "SELECTION_UNAVAILABLE" for score in selection),
        sum(score.expectation_match is True for score in selection),
        sum(case.expected.action == "PROPOSE" for case in cases),
        sum(case.evidence_calls for case in cases),
        sum(score.structural_valid is True for score in evidence),
        sum(score.structural_valid is False for score in evidence),
        sum(score.code == "RESULT_MODEL_UNAVAILABLE" for score in evidence),
        sum(score.expectation_match is True for score in evidence),
        sum(case.resource_reads for case in cases))
    return EvaluationReport(suite.version, "synthetic", execution_kind,
                            "synthetic_fixture", totals, cases)
