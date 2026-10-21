"""Offline wallet-transfer adapter; a local reference format, not a provider DTO.

Inputs come from scoped backend adapters. Network/wallet/source identifiers are
opaque labels here; no RPC, address resolution, signing or payment is performed.
The production mapper and freshness threshold remain owner review decisions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Callable

from .workflow import (
    MAX_CANDIDATES, BackendOutcome, Candidate, Context, InvalidInput, ProtectedResource, Proposal,
    Result, SelectionModel, _date, _json, _ref, outcome_result, propose,
    read_confirmed_resource, utc_now,
)

SCHEMA_VERSION = "analytics-reference/v1"
MAX_REPORT_BYTES = 256_000
MAX_TRANSFERS = 500
MAX_SOURCES = 20
MAX_WINDOW = timedelta(days=7)


class InvalidReport(InvalidInput):
    """Only a fixed code escapes the adapter, never the merchant payload."""


@dataclass(frozen=True)
class AnalyticsRequest:
    task_ref: str
    task_version: str
    resource_ref: str
    wallet: str | None
    data_network: str | None
    window_start: datetime | None
    window_end: datetime | None


@dataclass(frozen=True)
class AnalyticsProposal(Proposal):
    request: AnalyticsRequest


@dataclass(frozen=True)
class Transfer:
    record_id: str
    source_ref: str
    transaction_ref: str
    event_index: int
    timestamp: datetime
    asset_ref: str
    decimals: int
    amount_base_units: str
    from_wallet: str
    to_wallet: str


@dataclass(frozen=True)
class AnalyticsReport:
    wallet: str
    data_network: str
    window_start: datetime
    window_end: datetime
    generated_at: datetime
    data_as_of: datetime
    complete: bool
    pagination_complete: bool
    is_synthetic: bool
    source_refs: tuple[str, ...]
    transfers: tuple[Transfer, ...]


@dataclass(frozen=True)
class AssetTotal:
    asset_ref: str
    decimals: int
    direction: str
    transfer_count: int
    amount_base_units: str
    amount_display: str
    evidence_refs: tuple[str, ...]


@dataclass(frozen=True)
class AnalyticsAnswer:
    answer_text: str
    wallet: str
    data_network: str
    payment_network: str
    window_start: str
    window_end: str
    data_as_of: str
    generated_at: str
    is_synthetic: bool
    complete: bool
    transfer_count: int
    totals: tuple[AssetTotal, ...]
    source_refs: tuple[str, ...]
    evidence_refs: tuple[str, ...]
    limitations: tuple[str, ...]
    generator_version: str = "deterministic-transfer-summary/v1"


@dataclass(frozen=True)
class AnalyticsResult(Result):
    answer: AnalyticsAnswer | None = None


def check_request(request: AnalyticsRequest, context: Context, now: datetime) -> Result | None:
    """Require explicit scope before discovery/model calls; never infer a window."""
    if (not isinstance(request, AnalyticsRequest) or not isinstance(context, Context)
            or not _date(now)
            or not all(_ref(v) for v in (request.task_ref, request.task_version, request.resource_ref))
            or (request.task_ref, request.task_version) != (context.task_ref, context.task_version)):
        return Result("STOPPED", "ANALYTICS_SCOPE_MISMATCH")
    missing = [name for name in ("wallet", "data_network", "window_start", "window_end")
               if getattr(request, name) is None]
    if missing:
        return Result("CLARIFICATION_REQUIRED", "ANALYTICS_SCOPE_REQUIRED",
                      question="Please specify " + ", ".join(missing) + ".")
    if (not _ref(request.wallet) or not _ref(request.data_network)
            or not _date(request.window_start) or not _date(request.window_end)
            or not request.window_start < request.window_end <= now
            or request.window_end - request.window_start > MAX_WINDOW):
        return Result("STOPPED", "INVALID_ANALYTICS_SCOPE")
    return None


def propose_analytics(context: Context, request: AnalyticsRequest,
                      discover: Callable[[Context, AnalyticsRequest], tuple[Candidate, ...]],
                      select: SelectionModel, refresh: Callable[[], Context],
                      clock: Callable[[], datetime] = utc_now) -> Result:
    try:
        failure = check_request(request, context, clock())
    except Exception:
        return Result("STOPPED", "CONTEXT_UNAVAILABLE")
    if failure:
        return failure

    def scoped_discovery(ctx: Context) -> tuple[Candidate, ...]:
        candidates = discover(ctx, request)
        if (type(candidates) not in (tuple, list) or len(candidates) > MAX_CANDIDATES
                or any(not isinstance(c, Candidate) or c.resource_ref != request.resource_ref
                       for c in candidates)):
            raise InvalidInput("Unscoped discovery")
        return tuple(candidates)

    result = propose(context, scoped_discovery, select, refresh, clock)
    if result.proposal is None:
        return result
    proposal = result.proposal
    return replace(result, proposal=AnalyticsProposal(proposal.proposal_ref, proposal.context,
                   proposal.candidate, proposal.explanation, request))


def _object(value: object, fields: set[str]) -> dict:
    if type(value) is not dict or set(value) != fields:
        raise InvalidReport("INVALID_ANALYTICS_REPORT")
    return value


def _identifier(value: object) -> bool:
    # Record IDs become fragments, so slash/dot traversal is not accepted.
    return type(value) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) is not None


def _timestamp(value: object) -> datetime:
    if (type(value) is not str or len(value) > 35
            or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", value) is None):
        raise InvalidReport("INVALID_ANALYTICS_REPORT")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError) as exc:
        raise InvalidReport("INVALID_ANALYTICS_REPORT") from exc


def parse_report(resource: ProtectedResource, request: AnalyticsRequest,
                 now: datetime, max_report_age: timedelta) -> AnalyticsReport:
    """Parse a bounded canonical report. Freshness is an explicit caller policy.

    Windows are [start, end). data_as_of describes the historical dataset;
    generated_at controls report freshness, so old requested windows are valid.
    """
    if (not isinstance(resource, ProtectedResource) or not _ref(resource.delivery_ref)
            or type(resource.media_type) is not str
            or resource.media_type.split(";", 1)[0].strip().lower() != "application/json"):
        raise InvalidReport("INVALID_ANALYTICS_REPORT")
    try:
        value = _json(resource.body, MAX_REPORT_BYTES)
    except InvalidInput as exc:
        raise InvalidReport("INVALID_ANALYTICS_REPORT") from exc
    report = _object(value, {"schema_version", "resource_ref", "wallet", "data_network",
                             "window_start", "window_end", "generated_at", "data_as_of",
                             "coverage", "is_synthetic", "source_refs", "transfers"})
    if report["schema_version"] != SCHEMA_VERSION:
        raise InvalidReport("UNSUPPORTED_ANALYTICS_SCHEMA")
    if (report["resource_ref"] != request.resource_ref or report["wallet"] != request.wallet
            or report["data_network"] != request.data_network):
        raise InvalidReport("REPORT_SCOPE_MISMATCH")
    start, end = _timestamp(report["window_start"]), _timestamp(report["window_end"])
    if (start, end) != (request.window_start, request.window_end):
        raise InvalidReport("REPORT_SCOPE_MISMATCH")
    generated, as_of = _timestamp(report["generated_at"]), _timestamp(report["data_as_of"])
    if not _date(now) or not start <= as_of <= generated <= now:
        raise InvalidReport("INVALID_REPORT_TIME")
    if type(max_report_age) is not timedelta or max_report_age <= timedelta(0):
        raise InvalidReport("INVALID_FRESHNESS_POLICY")
    if now - generated > max_report_age:
        raise InvalidReport("STALE_ANALYTICS_REPORT")
    coverage = _object(report["coverage"], {"complete", "pagination_complete"})
    if (any(type(v) is not bool for v in coverage.values())
            or type(report["is_synthetic"]) is not bool):
        raise InvalidReport("INVALID_ANALYTICS_REPORT")
    if coverage["complete"] and (not coverage["pagination_complete"] or as_of < end):
        raise InvalidReport("CONTRADICTORY_COVERAGE")
    sources = report["source_refs"]
    if (type(sources) is not list or not 1 <= len(sources) <= MAX_SOURCES
            or any(not _ref(s) for s in sources) or len(set(sources)) != len(sources)):
        raise InvalidReport("INVALID_REPORT_SOURCES")
    values = report["transfers"]
    if type(values) is not list or len(values) > MAX_TRANSFERS:
        raise InvalidReport("REPORT_RECORD_LIMIT")
    transfers, record_ids, events, decimals_by_asset = [], set(), set(), {}
    for value in values:
        row = _object(value, {"record_id", "source_ref", "transaction_ref", "event_index",
                              "timestamp", "asset_ref", "decimals", "amount_base_units",
                              "from_wallet", "to_wallet"})
        if (not _identifier(row["record_id"]) or row["source_ref"] not in sources
                or any(not _ref(row[f]) for f in ("transaction_ref", "asset_ref", "from_wallet", "to_wallet"))
                or type(row["event_index"]) is not int or not 0 <= row["event_index"] < 1_000_000
                or type(row["decimals"]) is not int or not 0 <= row["decimals"] <= 18
                or type(row["amount_base_units"]) is not str
                or re.fullmatch(r"[1-9][0-9]{0,77}", row["amount_base_units"]) is None):
            raise InvalidReport("INVALID_TRANSFER")
        event = (row["transaction_ref"], row["event_index"])
        if row["record_id"] in record_ids or event in events:
            raise InvalidReport("DUPLICATE_TRANSFER")
        record_ids.add(row["record_id"])
        events.add(event)
        timestamp = _timestamp(row["timestamp"])
        if not start <= timestamp < end or timestamp > as_of:
            raise InvalidReport("TRANSFER_OUTSIDE_WINDOW")
        if request.wallet not in (row["from_wallet"], row["to_wallet"]):
            raise InvalidReport("UNRELATED_TRANSFER")
        asset = row["asset_ref"]
        if asset in decimals_by_asset and decimals_by_asset[asset] != row["decimals"]:
            raise InvalidReport("CONFLICTING_ASSET_UNITS")
        decimals_by_asset[asset] = row["decimals"]
        transfers.append(Transfer(**{**row, "timestamp": timestamp}))
    return AnalyticsReport(request.wallet, request.data_network, start, end, generated, as_of,
                           coverage["complete"], coverage["pagination_complete"],
                           report["is_synthetic"], tuple(sources), tuple(transfers))


def _display(amount: int, decimals: int) -> str:
    if decimals == 0:
        return str(amount)
    digits = str(amount).zfill(decimals + 1)
    return digits[:-decimals] + "." + digits[-decimals:]


def summarize(report: AnalyticsReport, delivery_ref: str, outcome: BackendOutcome,
              payment_network: str) -> AnalyticsAnswer:
    groups: dict[tuple[str, int, str], list[Transfer]] = {}
    for row in report.transfers:
        direction = ("self" if row.from_wallet == row.to_wallet else
                     "in" if row.to_wallet == report.wallet else "out")
        groups.setdefault((row.asset_ref, row.decimals, direction), []).append(row)
    totals = []
    for (asset, decimals, direction), rows in sorted(groups.items()):
        amount = sum(int(row.amount_base_units) for row in rows)
        refs = tuple(delivery_ref + "#transfer-" + row.record_id for row in rows)
        totals.append(AssetTotal(asset, decimals, direction, len(rows), str(amount),
                                 _display(amount, decimals), refs))
    synthetic = report.is_synthetic or outcome.evidence_kind == "synthetic_fixture"
    limitations = []
    if not report.complete:
        limitations.append("Partial coverage: counts and amounts cover only the returned transfers.")
    if not report.pagination_complete:
        limitations.append("Pagination is incomplete; more records may exist.")
    limitations.append("Transfer amounts are activity, not wallet balances or profit.")
    text = ["Synthetic wallet-transfer report." if synthetic else "Wallet-transfer report.",
            f"Wallet: {report.wallet}. Data network: {report.data_network}.",
            f"Window: {report.window_start.isoformat()} to {report.window_end.isoformat()} (end exclusive).",
            f"Data as of: {report.data_as_of.isoformat()}.",
            f"Returned transfers: {len(report.transfers)}. Coverage: {'complete' if report.complete else 'partial'}."]
    for total in totals:
        text.append(f"{total.asset_ref}, {total.direction}: {total.transfer_count} transfers, "
                    f"{total.amount_display} units.")
    if not totals:
        text.append("No transfers in the returned report." if report.complete else
                    "No transfers were returned; incomplete coverage cannot establish no activity.")
    text.extend(limitations)
    refs = (delivery_ref,) + tuple(delivery_ref + "#transfer-" + r.record_id for r in report.transfers)
    return AnalyticsAnswer("\n".join(text), report.wallet, report.data_network, payment_network,
                           report.window_start.isoformat(), report.window_end.isoformat(),
                           report.data_as_of.isoformat(), report.generated_at.isoformat(),
                           synthetic, report.complete, len(report.transfers), tuple(totals),
                           report.source_refs, refs, tuple(limitations))


def consume_analytics(proposal: Proposal, outcome: BackendOutcome, request: AnalyticsRequest,
                      read_resource: Callable[[str], ProtectedResource],
                      refresh: Callable[[], Context], *, max_report_age: timedelta,
                      clock: Callable[[], datetime] = utc_now) -> Result:
    """Use the existing access gate, validate/aggregate, then recheck task access."""
    if (not isinstance(proposal, AnalyticsProposal) or request != proposal.request
            or not isinstance(proposal.candidate, Candidate)):
        return Result("STOPPED", "ANALYTICS_SCOPE_MISMATCH")
    try:
        now = clock()
        failure = check_request(request, proposal.context, now)
    except Exception:
        return Result("STOPPED", "CONTEXT_UNAVAILABLE")
    if failure:
        return failure
    if request.resource_ref != proposal.candidate.resource_ref:
        return Result("STOPPED", "ANALYTICS_SCOPE_MISMATCH")
    if type(max_report_age) is not timedelta or max_report_age <= timedelta(0):
        return Result("STOPPED", "INVALID_FRESHNESS_POLICY")
    resource = read_confirmed_resource(proposal, outcome, read_resource, refresh)
    if isinstance(resource, Result):
        return resource
    try:
        now = clock()
    except Exception:
        return outcome_result("STOPPED", "CONTEXT_UNAVAILABLE", outcome)
    try:
        report = parse_report(resource, request, now, max_report_age)
        answer = summarize(report, resource.delivery_ref, outcome, proposal.candidate.network_ref)
    except InvalidReport as exc:
        return outcome_result("STOPPED", str(exc), outcome)
    try:
        if refresh() != proposal.context:
            return outcome_result("STOPPED", "STALE_CONTEXT", outcome)
        final_time = clock()
        if not _date(final_time) or final_time < now:
            return outcome_result("STOPPED", "INVALID_REPORT_TIME", outcome)
        if final_time - report.generated_at > max_report_age:
            return outcome_result("STOPPED", "STALE_ANALYTICS_REPORT", outcome)
    except Exception:
        return outcome_result("STOPPED", "CONTEXT_UNAVAILABLE", outcome)
    return AnalyticsResult("EVIDENCE_READY", "ANALYTICS_SUMMARY", evidence_kind=outcome.evidence_kind,
                           backend_reason_code=outcome.reason_code, backend_next_action=outcome.next_action,
                           answer=answer)
