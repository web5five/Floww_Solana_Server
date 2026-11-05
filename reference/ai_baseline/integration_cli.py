"""Bounded stdio adapter for an authenticated integration service.

The caller owns trusted snapshots and must recheck them after this process
returns. This adapter cannot turn caller assertions into on-chain proof.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import json
import os
import sys

from .analytics import AnalyticsProposal, AnalyticsRequest, consume_analytics, propose_analytics
from .model_api import OpenAIResponsesModel
from .render import render_html, render_markdown
from .workflow import BackendOutcome, Candidate, Context, ProtectedResource, _json, _ref, _text

MAX_INPUT = 600_000
MAX_OUTPUT = 1_500_000


def _date(value: object) -> datetime:
    if type(value) is not str or len(value) > 35:
        raise ValueError()
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError()
    return parsed.astimezone(timezone.utc)


def _construct(cls, raw: object, fields: tuple[str, ...], dates: tuple[str, ...]):
    if type(raw) is not dict or set(raw) != set(fields):
        raise ValueError()
    return cls(**{key: _date(value) if key in dates else value for key, value in raw.items()})


def _context(raw: object) -> Context:
    value = _construct(Context, raw, ("owner_ref", "task_ref", "task_version", "mandate_ref",
        "mandate_version", "purpose", "valid_until"), ("valid_until",))
    if (not all(_ref(getattr(value, key)) for key in ("owner_ref", "task_ref", "task_version",
            "mandate_ref", "mandate_version")) or not _text(value.purpose, 2_000)):
        raise ValueError()
    return value


def _candidate(raw: object) -> Candidate:
    value = _construct(Candidate, raw, ("candidate_id", "merchant_ref", "resource_ref",
        "requirements_ref", "amount_atomic", "asset_ref", "network_ref", "recipient_ref",
        "description", "valid_until"), ("valid_until",))
    if not value.valid(value.valid_until - timedelta(microseconds=1)):
        raise ValueError()
    return value


def _request(raw: object) -> AnalyticsRequest:
    return _construct(AnalyticsRequest, raw, ("task_ref", "task_version", "resource_ref", "wallet",
        "data_network", "window_start", "window_end"), ("window_start", "window_end"))


def _result(value, execution_kind: str) -> dict:
    result = {"status": value.status, "code": value.code, "execution_kind": execution_kind}
    if value.question is not None:
        result["question"] = value.question
    if value.proposal is not None:
        result.update(proposal_ref=value.proposal.proposal_ref, explanation=value.proposal.explanation)
    answer = getattr(value, "answer", None)
    if answer is not None:
        result.update(answer=asdict(answer), html=render_html(answer), markdown=render_markdown(answer))
    return result


def handle(operation: str, raw: object, *, clock=None) -> dict:
    if type(raw) is not dict or operation not in ("propose", "consume"):
        raise ValueError()
    context, candidate, request = _context(raw.get("context")), _candidate(raw.get("candidate")), _request(raw.get("request"))
    current = _context(raw["currentContext"]) if "currentContext" in raw else context
    clock = clock or (lambda: datetime.now(timezone.utc))
    if operation == "propose":
        mode = raw.get("selectionMode", "direct_resource")
        if mode == "direct_resource":
            def select(*_):
                return json.dumps({"action": "PROPOSE", "candidate_id": candidate.candidate_id,
                    "reason": "The user explicitly selected the registered wallet transfer report."})
            kind = "explicit_resource_selection"
        elif mode == "model":
            model, api_key = os.environ.get("FLOWW_AI_MODEL", ""), os.environ.get("FLOWW_AI_API_KEY", "")
            if not model or not api_key:
                return {"status": "STOPPED", "code": "MODEL_NOT_CONFIGURED"}
            select = OpenAIResponsesModel(model=model, api_key=api_key).select
            kind = "live_model_selection"
        else:
            return {"status": "STOPPED", "code": "INVALID_SELECTION_MODE"}
        value = propose_analytics(context, request, lambda *_: (candidate,), select, lambda: current, clock)
        return _result(value, kind)
    body = raw.get("body")
    if type(body) is not str or len(body.encode("utf-8")) > 256_000:
        raise ValueError()
    if not _ref(raw.get("proposalRef")) or not _ref(raw.get("attemptRef")):
        raise ValueError()
    proposal = AnalyticsProposal(raw.get("proposalRef"), context, candidate,
        "Explicit registered resource selection", request)
    outcome = BackendOutcome(raw.get("proposalRef"), context, candidate.requirements_ref,
        raw.get("attemptRef"), raw.get("policy", "PENDING"), raw.get("payment", "NOT_ATTEMPTED"),
        raw.get("fulfillment", "PENDING"), raw.get("settlementRef"), raw.get("deliveryRef"),
        evidence_kind="backend_verified")
    age = raw.get("maxReportAgeSeconds", 300)
    if type(age) is not int or not 1 <= age <= 3_600:
        raise ValueError()
    value = consume_analytics(proposal, outcome, request,
        lambda ref: ProtectedResource(ref, raw.get("mediaType", "application/json"), body),
        lambda: current, max_report_age=timedelta(seconds=age), clock=clock)
    return _result(value, "validated_transfer_summary")


def main() -> None:
    result = {"status": "STOPPED", "code": "AI_INVALID_INPUT"}
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        source = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(source) > MAX_INPUT:
            raise ValueError()
        raw = _json(source.decode("utf-8"), MAX_INPUT)
        result = handle(sys.argv[1], raw)
        output = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        if len(output.encode("utf-8")) > MAX_OUTPUT:
            result = {"status": "STOPPED", "code": "AI_OUTPUT_TOO_LARGE"}
    except Exception:
        # Error text, __context__, input and provider responses never escape.
        result = {"status": "STOPPED", "code": "AI_INVALID_INPUT"}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
