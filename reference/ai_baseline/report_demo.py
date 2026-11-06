"""Render a deterministic synthetic answer through the existing access gate."""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from typing import Sequence

from . import fixtures
from .analytics import AnalyticsAnswer, consume_analytics, propose_analytics
from .analytics_demo import FIXTURE, request
from .render import render_html, render_markdown
from .workflow import ProtectedResource

DEMO_NOTICE = ("Offline demonstration: model selection and backend payment/delivery observations "
               "are scripted synthetic fixtures. No model, API, or payment execution occurred.")


def demo_answer(case: str = "complete") -> AnalyticsAnswer:
    """Use scripted selection/outcomes, then validate the protected fixture body."""
    if case not in {"complete", "partial", "empty-partial"}:
        raise ValueError("Unknown report example")
    context, candidate = fixtures.context("solana_analytics"), fixtures.candidate("solana_analytics")
    scope = request()
    proposed = propose_analytics(
        context, scope, lambda *_: (candidate,),
        lambda *_: json.dumps({"action": "PROPOSE", "candidate_id": candidate.candidate_id,
                               "reason": "Scripted selection of the synthetic report."}),
        lambda: context, lambda: fixtures.NOW,
    )
    if proposed.proposal is None:
        raise RuntimeError(proposed.code)

    def read_resource(_: str) -> ProtectedResource:
        body = json.loads(FIXTURE.read_text(encoding="utf-8"))
        if case != "complete":
            body["coverage"] = {"complete": False, "pagination_complete": False}
        if case == "empty-partial":
            body["transfers"] = []
        return ProtectedResource("fixture-delivery", "application/json", json.dumps(body))

    result = consume_analytics(
        proposed.proposal, fixtures.outcome(proposed.proposal), scope, read_resource,
        lambda: context, max_report_age=timedelta(hours=2), clock=lambda: fixtures.NOW,
    )
    answer = getattr(result, "answer", None)
    if result.code != "ANALYTICS_SUMMARY" or answer is None:
        raise RuntimeError(result.code)
    return replace(answer, answer_text=DEMO_NOTICE + "\n" + answer.answer_text,
                   limitations=(DEMO_NOTICE,) + answer.limitations)


def _actual_entry(target: Path) -> Path:
    entries = list(target.parent.iterdir())
    exact = next((entry for entry in entries if entry.name == target.name), None)
    if exact is not None:
        return exact
    # Some filesystems expose an equivalent spelling after the write. Inspect
    # only matching names, not unrelated entries such as dangling symlinks.
    for entry in entries:
        if unicodedata.normalize("NFC", entry.name) == target.name and entry.samefile(target):
            return entry
    raise OSError("Cannot read back the created output filename")


def _write_output(output: str, content: str) -> Path:
    requested = Path(output).expanduser()
    # The parent must already exist. Normalize only the new filename; existing
    # unrelated parent directories and their original names stay untouched.
    target = requested.with_name(unicodedata.normalize("NFC", requested.name))
    with target.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
    actual = _actual_entry(target)
    if not unicodedata.is_normalized("NFC", actual.name):
        # The created file is exclusively ours; never overwrite another entry.
        normalized = actual.with_name(unicodedata.normalize("NFC", actual.name))
        if normalized.exists() and not normalized.samefile(actual):
            raise FileExistsError("NFC output filename conflicts with an existing file")
        actual.rename(normalized)
        actual = _actual_entry(normalized)
    if not unicodedata.is_normalized("NFC", actual.name):
        raise OSError("Filesystem did not preserve the NFC output filename")
    return actual


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("complete", "partial", "empty-partial"), default="complete")
    parser.add_argument("--format", choices=("markdown", "html"), default="markdown")
    parser.add_argument("--output", help="New file in an existing directory; refuses overwrite. Default: stdout.")
    args = parser.parse_args(argv)
    try:
        answer = demo_answer(args.case)
        content = render_html(answer) if args.format == "html" else render_markdown(answer)
        if args.output:
            actual = _write_output(args.output, content)
            print("Wrote " + str(actual) + " (NFC verified)", file=sys.stderr)
        else:
            sys.stdout.write(content)
    except (OSError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
