"""Reproducible offline adapter demonstration; no live model or network calls."""

import json
from dataclasses import asdict, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import fixtures
from .analytics import AnalyticsRequest, consume_analytics, propose_analytics
from .workflow import ProtectedResource

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "analytics-report-v1.json"


def request() -> AnalyticsRequest:
    return AnalyticsRequest("fixture-task", "v1", "fixture-resource-solana_analytics",
                            "fixture-wallet", "fixture-mainnet-snapshot",
                            datetime(2026, 10, 11, tzinfo=timezone.utc),
                            datetime(2026, 10, 18, tzinfo=timezone.utc))


def main() -> None:
    context, candidate = fixtures.context("solana_analytics"), fixtures.candidate("solana_analytics")
    proposed = propose_analytics(
        context, request(), lambda *_: (candidate,),
        lambda *_: json.dumps({"action": "PROPOSE", "candidate_id": candidate.candidate_id,
                               "reason": "Scripted selection of the requested synthetic report."}),
        lambda: context, lambda: fixtures.NOW,
    )
    if proposed.proposal is None:
        raise RuntimeError("Synthetic proposal failed")
    outcome = fixtures.outcome(proposed.proposal)
    report = json.loads(FIXTURE.read_text(encoding="utf-8"))
    partial = {**report, "coverage": {"complete": False, "pagination_complete": False}}
    cases = [
        ("complete", outcome, report, "ANALYTICS_SUMMARY"),
        ("partial", outcome, partial, "ANALYTICS_SUMMARY"),
        ("unknown", replace(outcome, payment="UNKNOWN", reason_code="SETTLEMENT_UNRESOLVED",
                            next_action="RECONCILE"), report, "PAYMENT_RECONCILIATION_REQUIRED"),
        ("undelivered", replace(outcome, fulfillment="FAILED", next_action="RECOVER_DELIVERY"),
         report, "PAID_RESOURCE_UNDELIVERED"),
        ("wrong_wallet", outcome, {**report, "wallet": "other-wallet"}, "REPORT_SCOPE_MISMATCH"),
    ]
    print("SYNTHETIC FIXTURES ONLY — scripted selection, no model/API/payment execution")
    for name, observation, body, expected_code in cases:
        def read(_):
            if name in ("unknown", "undelivered"):
                raise AssertionError("Unconfirmed or undelivered content must not be read")
            return ProtectedResource("fixture-delivery", "application/json", json.dumps(body))
        result = consume_analytics(proposed.proposal, observation, request(), read, lambda: context,
                                   max_report_age=timedelta(hours=2), clock=lambda: fixtures.NOW)
        if result.code != expected_code:
            raise AssertionError((name, result.code, expected_code))
        print(json.dumps({"case": name, "result": asdict(result)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
