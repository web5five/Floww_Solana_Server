"""Explicitly synthetic examples; no provider, price or chain evidence is real."""

import json
from datetime import datetime, timedelta, timezone

from .workflow import BackendOutcome, Candidate, Context, ProtectedResource, Proposal


NOW = datetime(2026, 10, 18, 7, 0, tzinfo=timezone.utc)

CASES = {
    "market_research": {
        "purpose": "Compare the supplied sample products' prices and features.",
        "body": json.dumps([
            {"id": "sample-a", "text": "Synthetic Product A: sample price 10; feature offline export."},
            {"id": "sample-b", "text": "Synthetic Product B: sample price 12; feature shared editing."},
        ]),
        "media_type": "application/json",
        "record_ids": ["sample-a", "sample-b"],
    },
    "translation": {
        "purpose": "Read the Korean translation of the sample greeting.",
        "body": "Synthetic translation example: Hello → 안녕하세요.",
        "media_type": "text/plain; charset=utf-8",
        "record_ids": ["text"],
    },
    "solana_analytics": {
        "purpose": "Summarize the sample report's activity count and observation window.",
        "body": json.dumps([
            {"id": "sample-window", "text": "Synthetic observation window: one test interval."},
            {"id": "sample-count", "text": "Synthetic activity count: 3. No RPC request was made."},
        ]),
        "media_type": "application/json",
        "record_ids": ["sample-window", "sample-count"],
    },
}


def context(case: str = "market_research") -> Context:
    return Context("fixture-owner", "fixture-task", "v1", "fixture-mandate", "v1",
                   CASES[case]["purpose"], NOW + timedelta(hours=1))


def candidate(case: str = "market_research") -> Candidate:
    return Candidate(case, "fixture-merchant", "fixture-resource-" + case,
                     "fixture-requirements-" + case, "1000", "fixture-test-asset",
                     "fixture-devnet", "fixture-recipient", "Synthetic " + case,
                     NOW + timedelta(minutes=10))


def proposal(case: str = "market_research") -> Proposal:
    return Proposal("fixture-proposal", context(case), candidate(case), "Synthetic selection.")


def outcome(p: Proposal) -> BackendOutcome:
    return BackendOutcome(p.proposal_ref, p.context, p.candidate.requirements_ref,
                          "fixture-attempt", "ALLOW", "CONFIRMED", "COMPLETED",
                          "fixture-settlement-reference", "fixture-delivery", "synthetic_fixture")


def resource(case: str = "market_research") -> ProtectedResource:
    example = CASES[case]
    return ProtectedResource("fixture-delivery", example["media_type"], example["body"])
