"""Versioned workspace acceptance regression; explicit model injection only.

This module never reads a credential/environment, constructs a model client,
opens a database, or provides financial/voice ports. A live caller must supervise
the owned process with a hard wall deadline and meter/reserve every API request.
The existing synchronous role budget is not a cancellation boundary. No retry or
replacement is made after an uncertain role-port failure.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import time
from dataclasses import asdict
from pathlib import Path

from .analytics import AnalyticsAnswer, AssetTotal
from .presentation import infer_output_options, present_answer
from .render import render_html, render_markdown
from .workspace_cli import (
    CRITIC_INSTRUCTION, PLAN_INSTRUCTION, REFINE_INSTRUCTION, PROMPT_VERSION,
    RESOURCE, handle,
)

VERSION = "workspace-live-acceptance/v5"
MODEL = "gpt-5.4-mini"
BASELINE_SUITE_HASH = "1000fdca31768a038645e48f9d775e24c5556a66d244d952189ab1d461602295"
PREVIOUS_SUITE_HASH = "e9ac5f86a3de94df7beb90968d0aa6de3bd347ae102330c0068b9efdaa4284fc"
DEFAULT_SUITE = Path(__file__).resolve().parents[1] / "evaluations" / "workspace-live-acceptance-v5.json"
OPERATIONS = {"refine", "plan", "critic_probe"}
_SECRET = re.compile(r"sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|-----BEGIN[^\n]*PRIVATE KEY-----", re.I)
_URL = re.compile(r"[a-z][a-z0-9+.-]*://|\bwww\.", re.I)
_ID = re.compile(r"[a-z][a-z0-9-]{0,95}")
_PORT_FAILURES = {"HTTP_ERROR", "HTTP_REDIRECT", "NETWORK_TIMEOUT", "NETWORK_ERROR", "RESPONSE_TOO_LARGE",
                  "INVALID_RESPONSE", "INVALID_CONFIG", "BUDGET_EXHAUSTED", "SUPERVISOR_STOPPED"}


class InvalidAcceptance(ValueError):
    """Fixed validation diagnostics, never model/provider input text."""


def _fail():
    raise InvalidAcceptance("INVALID_WORKSPACE_ACCEPTANCE")


def _identifier(value):
    return type(value) is str and _ID.fullmatch(value) is not None


def _pairs(items):
    value = {}
    for key, item in items:
        if key in value:
            _fail()
        value[key] = item
    return value


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def validate_suite(suite):
    if (type(suite) is not dict or suite.get("version") != VERSION or suite.get("model") != MODEL
            or suite.get("promptVersion") != PROMPT_VERSION or suite.get("split") != "post-baseline-regression"
            or suite.get("originalPreSampleSuiteHash") != BASELINE_SUITE_HASH or suite.get("sameCasesAsBaseline") is not True
            or suite.get("previousRegressionSuiteHash") != PREVIOUS_SUITE_HASH
            or suite.get("historyLimit") != 12 or suite.get("humanReviewed") is not False
            or suite.get("expectedCases") != 12 or suite.get("expectedStages") != 32
            or suite.get("maxRoleCalls") != 40 or suite.get("generatedPlanStages") != 8
            or suite.get("criticOnlyStages") != 2
            or suite.get("expectedRoleCounts") != {"refine": 22, "plan": 8, "critic": 10}
            or type(suite.get("cases")) is not list or len(suite["cases"]) != 12
            or type(suite.get("rubric")) is not dict or type(suite.get("grounding")) is not dict):
        _fail()
    families, ids, counts, stages = {}, set(), {"refine": 0, "plan": 0, "critic": 0}, 0
    for case in suite["cases"]:
        if (type(case) is not dict or not _identifier(case.get("id")) or case["id"] in ids
                or case.get("inputLanguage") not in {"ko", "en"} or type(case.get("family")) is not str
                or type(case.get("stages")) is not list or not 1 <= len(case["stages"]) <= 4):
            _fail()
        ids.add(case["id"]); families.setdefault(case["family"], set()).add(case["inputLanguage"])
        initial = case.get("initial")
        if (type(initial) is not dict or set(initial) != {"intent", "history", "memories", "catalog"}
                or type(initial["intent"]) is not dict or type(initial["history"]) is not list
                or len(initial["history"]) > 10 or type(initial["memories"]) is not list
                or type(initial["catalog"]) is not list):
            _fail()
        seen = set()
        for stage in case["stages"]:
            stages += 1
            if (type(stage) is not dict or not _identifier(stage.get("id")) or stage["id"] in seen
                    or stage.get("operation") not in OPERATIONS or type(stage.get("at")) is not str
                    or type(stage.get("expected")) is not dict
                    or not set(stage) <= {"id", "operation", "at", "userText", "expected", "fixtureProposal", "roleProvenance"}
                    or not isinstance(stage.get("userText"), (str, type(None)))):
                _fail()
            seen.add(stage["id"])
            op = stage["operation"]
            if op == "refine":
                counts["refine"] += 1
                required = {"status", "wallet", "windowStart", "windowEnd", "resourceId", "missingFields", "purposeNonempty"}
                if (not required <= set(stage["expected"]) or stage["expected"]["status"] not in
                        {"READY_TO_PLAN", "CLARIFICATION_REQUIRED", "UNSUPPORTED"} or not stage["userText"]):
                    _fail()
                expected = stage["expected"]
                if (not set(expected) <= required | {"outputOptions"} or expected["purposeNonempty"] is not True
                        or type(expected["missingFields"]) is not list
                        or any(type(field) is not str or field not in {"purpose", "wallet", "windowStart", "windowEnd", "resourceId"} for field in expected["missingFields"])
                        or len(set(expected["missingFields"])) != len(expected["missingFields"])):
                    _fail()
                if "outputOptions" in expected and (type(expected["outputOptions"]) is not dict
                        or set(expected["outputOptions"]) != {"language", "focus"}
                        or expected["outputOptions"]["language"] not in {"ko", "en"}
                        or expected["outputOptions"]["focus"] not in {"summary", "count", "incoming", "outgoing"}):
                    _fail()
            elif op == "plan":
                counts["plan"] += 1; counts["critic"] += 1
                if stage["expected"] != {"status": "PROPOSED", "criticVerdict": "ACCEPT"}:
                    _fail()
            else:
                counts["critic"] += 1
                if (type(stage.get("fixtureProposal")) is not dict or
                        stage.get("roleProvenance") != {"plan": "injected_negative_fixture", "critic": "explicit_model_port"}
                        or stage["expected"].get("code") != "WORKSPACE_PLAN_REJECTED"
                        or stage["expected"].get("criticVerdict") != "REJECT"):
                    _fail()
    if len(families) != 6 or any(languages != {"ko", "en"} for languages in families.values()) or stages != 32 or counts != suite["expectedRoleCounts"]:
        _fail()
    if len(_json(suite).encode("utf-8")) > 256_000:
        _fail()
    return suite


def load_suite(path=DEFAULT_SUITE):
    try:
        raw = Path(path).read_bytes()
        if len(raw) > 256_000:
            _fail()
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                           parse_constant=lambda _: _fail())
        return validate_suite(value)
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError):
        _fail()


def _safe_record(value):
    """Bounded qualitative evidence; no raw envelopes/headers/exceptions."""
    try:
        encoded = _json(value)
    except (TypeError, ValueError, UnicodeError):
        return {"recordingError": "NON_JSON_ROLE_OUTPUT"}
    if len(encoded.encode("utf-8")) > 16_000:
        return {"recordingError": "ROLE_OUTPUT_TOO_LARGE"}
    if _SECRET.search(encoded) or _URL.search(encoded):
        return {"recordingError": "UNSAFE_ROLE_OUTPUT_REDACTED"}
    return json.loads(encoded)


def _role_record(value, role):
    allowed = {"refine": {"contextDigest", "status", "assistantText", "intent"},
               "plan": {"contextDigest", "summary", "steps", "limitations"},
               "critic": {"contextDigest", "verdict", "reason", "issueCodes"}}[role]
    if type(value) is not dict:
        return {"recordingError": "INVALID_ROLE_SHAPE"}
    result = {key: item for key, item in value.items() if key in allowed}
    unexpected = bool(set(value) - allowed)
    if role == "refine" and type(result.get("intent")) is dict:
        intent_fields = {"purpose", "wallet", "windowStart", "windowEnd", "resourceId", "missingFields"}
        unexpected |= bool(set(result["intent"]) - intent_fields)
        result["intent"] = {key: item for key, item in result["intent"].items() if key in intent_fields}
    if role == "plan" and type(result.get("steps")) is list:
        if len(result["steps"]) > 3:
            return {"recordingError": "INVALID_ROLE_SHAPE"}
        steps = []
        for step in result["steps"]:
            if type(step) is not dict:
                return {"recordingError": "INVALID_ROLE_SHAPE"}
            fields = {"role", "capability", "resourceId", "reason"}
            unexpected |= bool(set(step) - fields)
            steps.append({key: item for key, item in step.items() if key in fields})
        result["steps"] = steps
    if unexpected:
        result["unexpectedFieldsRedacted"] = True
    return _safe_record(result)


class _Recorder:
    def __init__(self, model, limit, execution_kind, on_event):
        self.model, self.limit, self.execution_kind = model, limit, execution_kind
        self.rows, self.attempts, self.failure = [], 0, None
        self.invocations, self.failure_origin = 0, None
        self.tag = None
        self.on_event = on_event

    def emit(self, value):
        if self.on_event is not None:
            try:
                self.on_event(copy.deepcopy(value))
            except Exception:
                self.failure = "ARTIFACT_WRITE_FAILED"
                self.failure_origin = "ARTIFACT"
                raise InvalidAcceptance(self.failure) from None

    def role(self, role, payload, schema):
        if self.failure or self.attempts >= self.limit:
            self.failure = self.failure or "ROLE_CALL_LIMIT"
            self.failure_origin = self.failure_origin or "CALL_LIMIT"
            raise InvalidAcceptance("ROLE_CALL_LIMIT")
        self.attempts += 1
        started = time.monotonic()
        row = {"attempt": self.attempts, "role": role, "caseId": self.tag[0], "stageId": self.tag[1],
               "source": self.execution_kind, "state": "ATTEMPTED"}
        self.rows.append(row)
        self.emit({"event": "role_attempt", **row})
        try:
            self.invocations += 1
            value = self.model.role(role, payload, schema)
        except Exception as error:
            try:
                code = str(error)
            except Exception:
                code = None
            self.failure = code if code in _PORT_FAILURES else "MODEL_PORT_FAILED"
            self.failure_origin = "PORT"
            row.update(state="PORT_FAILED", code=self.failure, elapsedMs=int((time.monotonic() - started) * 1000))
            self.emit({"event": "role_failed", **row})
            raise InvalidAcceptance(self.failure) from None
        row.update(state="RETURNED", output=_role_record(value, role), elapsedMs=int((time.monotonic() - started) * 1000))
        self.emit({"event": "role_returned", **row})
        return value


class _CriticProbe:
    def __init__(self, recorder, proposal):
        self.recorder, self.proposal = recorder, proposal

    def role(self, role, payload, schema):
        if role == "plan":
            # Fresh binding plus a deliberately stale semantic scope. This is
            # the injected plan fixture, never counted as a generated plan.
            return {"contextDigest": payload["contextDigest"], **copy.deepcopy(self.proposal)}
        return self.recorder.role(role, payload, schema)


def _presentation(suite, intent, expected, at):
    purpose = intent.get("purpose")
    if type(purpose) is not str:
        return {"optionsMatch": False, "factsPreserved": False, "status": "INVALID_PURPOSE"}
    options = infer_output_options(purpose)
    actual_options = asdict(options)
    matches = actual_options == expected
    if any(intent.get(key) is None for key in ("wallet", "windowStart", "windowEnd")):
        return {"optionsMatch": matches, "actualOptions": actual_options, "factsPreserved": None,
                "status": "INCOMPLETE_SCOPE_NOT_RENDERED", "modelGeneratedGrounding": False}
    f = suite["grounding"]
    outgoing = AssetTotal(f["asset_ref"], f["decimals"], "out", 1, f["amount_base_units"], f["amount_display"], (f["record_ref"],))
    incoming_ref = "synthetic-delivery#transfer-incoming-1"
    incoming = AssetTotal(f["asset_ref"], f["decimals"], "in", 1, f["other_amount_base_units"], f["other_amount_display"], (incoming_ref,))
    answer = AnalyticsAnswer("Synthetic fixture only.", intent["wallet"], "synthetic-data-network", "not-executed",
        intent["windowStart"], intent["windowEnd"], intent["windowEnd"], at, True, False, 2,
        (incoming, outgoing), (f["source_ref"],), ("synthetic-delivery", incoming_ref, f["record_ref"]),
        ("Partial coverage: counts and amounts cover only the returned transfers.",
         "Pagination is incomplete; more records may exist.",
         "Transfer amounts are activity, not wallet balances or profit."))
    shown = present_answer(answer, options, purpose=purpose)
    before, after = asdict(answer), asdict(shown)
    preserved = all(before[key] == after[key] for key in before if key not in {"answer_text", "limitations"})
    html, markdown = render_html(shown, language=options.language), render_markdown(shown, language=options.language)
    exported = all(text in html and text in markdown for text in (f["amount_display"], f["source_ref"], f["record_ref"]))
    return {"status": "SYNTHETIC_FORMATTER_ONLY", "modelGeneratedGrounding": False, "protectedConsumptionRan": False,
            "optionsMatch": matches, "actualOptions": actual_options, "factsPreserved": preserved and exported,
            "answerText": shown.answer_text, "isSynthetic": shown.is_synthetic, "complete": shown.complete}


def _score(suite, stage, result, roles):
    expected = stage["expected"]
    checks = {"expectedStatus": result.get("status") == expected["status"]}
    if "code" in expected:
        checks["expectedCode"] = result.get("code") == expected["code"]
    if stage["operation"] == "refine":
        intent = result.get("intent")
        checks["hasValidatedIntent"] = type(intent) is dict
        if type(intent) is dict:
            for key in ("wallet", "windowStart", "windowEnd", "resourceId"):
                checks[key] = intent.get(key) == expected[key]
            checks["missingFields"] = set(intent.get("missingFields", [])) == set(expected["missingFields"])
            checks["clearPurpose"] = type(intent.get("purpose")) is str and bool(intent["purpose"].strip())
            if "outputOptions" in expected:
                presentation = _presentation(suite, intent, expected["outputOptions"], stage["at"])
                checks["purposeOutputOptions"] = presentation["optionsMatch"]
                checks["formatterFacts"] = presentation["factsPreserved"] is not False
            else:
                presentation = None
        else:
            presentation = None
    else:
        critic = next((role.get("output") for role in roles if role["role"] == "critic"), None)
        checks["criticReturned"] = type(critic) is dict
        if type(critic) is dict:
            checks["criticVerdict"] = critic.get("verdict") == expected["criticVerdict"]
            checks["criticIssues"] = (bool(set(critic.get("issueCodes", [])) & set(expected["issueAnyOf"]))
                                     if "issueAnyOf" in expected else critic.get("issueCodes") == [])
        presentation = None
    return checks, presentation


def run_suite(suite, *, model, execution_kind, model_name=MODEL, on_event=None):
    """No default model. Live callers own hard supervision and cost admission.

    Port attempts are not invoice/HTTP counts. A budget-denied port attempt may
    make zero API requests; only the caller's actual POST/usage meter proves it.
    """
    validate_suite(suite)
    if (not callable(getattr(model, "role", None)) or model_name != MODEL
            or execution_kind not in {"scripted_roles", "actual_responses"}
            or (on_event is not None and not callable(on_event))):
        _fail()
    recorder, cases = _Recorder(model, suite["maxRoleCalls"], execution_kind, on_event), []
    for case in suite["cases"]:
        state = copy.deepcopy(case["initial"])
        history, intent = state["history"], state["intent"]
        refiner_status, refiner_stage, refiner_validated = None, None, False
        stages = []
        expected_language = case["inputLanguage"]
        for index, stage in enumerate(case["stages"]):
            if recorder.failure:
                stages.append({"id": stage["id"], "operation": stage["operation"],
                    "outcome": "NOT_RUN_AFTER_FAILURE", "automatedPassed": False, "rolePortAttempts": 0,
                    "workflow": {"decision": "NOT_RUN_AFTER_FAILURE", "priorRefinerStageId": refiner_stage,
                        "priorRefinerStatus": refiner_status, "priorRefinerValidated": refiner_validated}})
                continue
            if stage["userText"] is not None:
                history.append({"id": case["id"] + "-user-" + str(index), "role": "user", "text": stage["userText"]})
            history = history[-suite["historyLimit"]:]
            if "outputOptions" in stage["expected"]:
                expected_language = stage["expected"]["outputOptions"]["language"]
            raw = {"messages": copy.deepcopy(history), "intent": copy.deepcopy(intent),
                   "memories": state["memories"], "catalog": state["catalog"], "nowIso": stage["at"]}
            recorder.tag = (case["id"], stage["id"])
            before, rows_before = recorder.attempts, len(recorder.rows)
            eligible = refiner_validated and refiner_status == "READY_TO_PLAN"
            blocked = stage["operation"] == "plan" and not eligible
            workflow = {"priorRefinerStageId": refiner_stage, "priorRefinerStatus": refiner_status,
                "priorRefinerValidated": refiner_validated,
                "decision": "WORKFLOW_BLOCKED" if blocked else "RUN_REFINE" if stage["operation"] == "refine"
                else "INDEPENDENT_CRITIC_PROBE" if stage["operation"] == "critic_probe" else "PLAN_AFTER_READY"}
            if blocked:
                # Intent completeness is not workflow authority. Never repair
                # or replace a non-READY/invalid refiner using the case oracle.
                result = {"status": "STOPPED", "code": "WORKFLOW_BLOCKED"}
            else:
                port = _CriticProbe(recorder, stage["fixtureProposal"]) if stage["operation"] == "critic_probe" else recorder
                result = handle("refine" if stage["operation"] == "refine" else "plan", raw,
                                model=port, model_version=model_name)
            roles = recorder.rows[rows_before:]
            try:
                checks, presentation = _score(suite, stage, result, roles)
            except Exception:
                checks, presentation = {"scoringProtocol": False}, None
            if blocked:
                checks["workflowReady"] = False
            attempted = recorder.attempts - before
            outcome = ("ARTIFACT_WRITE_FAILED" if recorder.failure_origin == "ARTIFACT" else
                       "CALL_LIMIT_BLOCKED" if recorder.failure_origin == "CALL_LIMIT" else
                       "PORT_FAILED" if recorder.failure else "WORKFLOW_BLOCKED" if blocked
                       else "GUARD_ONLY" if not attempted else "EVALUATED")
            # Prior intent comes only from an actual validated refiner result.
            # Never substitute the expected oracle or repair a failed output.
            if stage["operation"] == "refine":
                refiner_stage, refiner_status = stage["id"], result.get("status")
                refiner_validated = (refiner_status in {"READY_TO_PLAN", "CLARIFICATION_REQUIRED", "UNSUPPORTED"}
                                     and type(result.get("intent")) is dict)
                if refiner_validated:
                    intent = copy.deepcopy(result["intent"])
                    history.append({"id": case["id"] + "-assistant-" + str(index), "role": "assistant", "text": result["assistantText"]})
                    history = history[-suite["historyLimit"]:]
            workflow.update(refinerStageIdAfter=refiner_stage, refinerStatusAfter=refiner_status,
                            refinerValidatedAfter=refiner_validated)
            row = {"id": stage["id"], "operation": stage["operation"], "outcome": outcome,
                "rolePortAttempts": attempted, "automatedPassed": outcome == "EVALUATED" and all(checks.values()),
                "checks": checks, "result": _safe_record(result), "presentation": presentation,
                "workflow": workflow,
                "historyMessages": len(raw["messages"]), "inputDigest": _hash(raw),
                "plannerSource": "injected_negative_fixture" if stage["operation"] == "critic_probe" else "explicit_model_port" if stage["operation"] == "plan" and not blocked else None,
                "qualitativeReview": {"status": "NOT_RUN_WORKFLOW_BLOCKED" if blocked else "PENDING", "reviewerKind": None, "humanReviewed": False,
                    "expectedUserFacingLanguage": None if stage["operation"] == "critic_probe" else expected_language}}
            stages.append(row)
            if not recorder.failure:
                try:
                    recorder.emit({"event": "stage_result", "caseId": case["id"], **row})
                except InvalidAcceptance:
                    row["outcome"] = "ARTIFACT_WRITE_FAILED"; row["automatedPassed"] = False
        cases.append({"id": case["id"], "family": case["family"], "inputLanguage": case["inputLanguage"],
            "automatedPassed": all(stage["automatedPassed"] for stage in stages), "stages": stages,
            "humanReviewed": False})
    flat = [stage for case in cases for stage in case["stages"]]
    return {"suiteVersion": VERSION, "suiteHash": _hash(suite), "model": model_name, "promptVersion": PROMPT_VERSION,
        "comparisonSplit": suite["split"], "sameCasesAsBaseline": True,
        "baselineSuiteHash": suite["originalPreSampleSuiteHash"],
        "previousRegressionSuiteHash": suite["previousRegressionSuiteHash"],
        "workflowPolicy": "plan-requires-latest-validated-ready-refiner",
        "validatedPurposeMayIncludeDeterministicUserOutputContract": True,
        "missingFieldsSource": "derived_from_validated_null_fields",
        "rawRefinerIntentContract": "five_fields_without_missingFields",
        "promptHash": _hash([REFINE_INSTRUCTION, PLAN_INSTRUCTION, CRITIC_INSTRUCTION]), "executionKind": execution_kind,
        "requiresExternalHardSupervisor": True, "costMeter": "external_actual_post_usage_and_conservative_reservations",
        "humanReviewed": False, "modelQualityAccepted": False,
        "totals": {"expectedCases": 12, "expectedStages": 32, "plannedRoleCalls": 40,
            "generatedPlanStages": 8, "criticOnlyStages": 2, "rolePortAttempts": recorder.attempts,
            "modelPortInvocations": recorder.invocations,
            "returnedRoleCalls": sum(row["state"] == "RETURNED" for row in recorder.rows),
            "automatedPassedCases": sum(case["automatedPassed"] for case in cases),
            "automatedPassedStages": sum(stage["automatedPassed"] for stage in flat),
            "automatedFailedStages": sum(not stage["automatedPassed"] for stage in flat),
            "workflowBlockedStages": sum(stage["outcome"] == "WORKFLOW_BLOCKED" for stage in flat),
            "attemptedPlanStages": sum(stage.get("operation") == "plan" and stage["rolePortAttempts"] > 0 for stage in flat),
            "evaluatedStages": sum(stage["outcome"] == "EVALUATED" for stage in flat),
            "guardOnlyStages": sum(stage["outcome"] == "GUARD_ONLY" for stage in flat),
            "portFailedStages": sum(stage["outcome"] == "PORT_FAILED" for stage in flat),
            "artifactFailedStages": sum(stage["outcome"] == "ARTIFACT_WRITE_FAILED" for stage in flat),
            "callLimitBlockedStages": sum(stage["outcome"] == "CALL_LIMIT_BLOCKED" for stage in flat),
            "notRunStages": sum(stage["outcome"] == "NOT_RUN_AFTER_FAILURE" for stage in flat)},
        "stoppedCode": recorder.failure, "cases": cases, "roles": recorder.rows}


if __name__ == "__main__":
    # Offline inventory only. There is deliberately no --live/key/env shortcut.
    suite = load_suite()
    print(_json({"suiteVersion": VERSION, "suiteHash": _hash(suite), "cases": 12, "stages": 32,
                 "maxRoleCalls": 40, "humanReviewed": False, "modelCallsMade": 0}))
