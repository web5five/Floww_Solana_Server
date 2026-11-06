"""Deterministic presentation of an already validated AnalyticsAnswer.

Call consume_analytics before rendering. This module neither authorizes access
nor authenticates a payment, provider, or report. References remain inert text.
"""

from __future__ import annotations

import html
import re

from .analytics import AnalyticsAnswer


def _answer(value: AnalyticsAnswer) -> AnalyticsAnswer:
    if not isinstance(value, AnalyticsAnswer):
        raise TypeError("Render a validated AnalyticsAnswer, not a raw report or result.")
    return value


def _code(value: object) -> str:
    """Keep even URL/Markdown-shaped labels inert in a CommonMark code span."""
    text = str(value).replace("\r", r"\r").replace("\n", r"\n")
    width = max((len(run) for run in re.findall(r"`+", text)), default=0) + 1
    fence = "`" * width
    return fence + " " + text + " " + fence


def _block(value: str) -> str:
    width = max(3, max((len(run) for run in re.findall(r"`+", value)), default=0) + 1)
    fence = "`" * width
    return fence + "text\n" + value + "\n" + fence


def _coverage(answer: AnalyticsAnswer) -> str:
    if not answer.complete:
        return "Partial coverage — counts and amounts cover only returned transfers."
    return "Complete within the supplied report's declared scope."


def _empty(answer: AnalyticsAnswer) -> str:
    if answer.transfer_count:
        return ""
    return ("No transfers in the returned report." if answer.complete else
            "No transfers were returned; incomplete coverage cannot establish no activity.")


def _metadata(answer: AnalyticsAnswer) -> tuple[tuple[str, object], ...]:
    return (
        ("Wallet", answer.wallet),
        ("Data network", answer.data_network),
        ("Payment network (backend observation)", answer.payment_network),
        ("Window start (inclusive)", answer.window_start),
        ("Window end (exclusive)", answer.window_end),
        ("Data as of", answer.data_as_of),
        ("Report generated at", answer.generated_at),
        ("Returned transfers", answer.transfer_count),
        ("Summary generator", answer.generator_version),
    )


def render_markdown(answer: AnalyticsAnswer) -> str:
    """Return CommonMark with inert code spans/blocks for every dynamic value."""
    answer = _answer(answer)
    lines = ["# Wallet transfer report", "",
             ("**Synthetic data.**" if answer.is_synthetic else
              "**Data is marked non-synthetic by the supplied answer.**"),
             "", "**" + _coverage(answer) + "**", ""]
    lines += [f"- {label}: {_code(value)}" for label, value in _metadata(answer)]
    lines += ["", "## Summary", "", _block(answer.answer_text), ""]
    if empty := _empty(answer):
        lines += [empty, ""]
    lines += ["## Amounts by asset and direction", "",
              "Each amount keeps its own asset and direction. No cross-asset total is calculated.", ""]
    for total in answer.totals:
        lines += [f"### Asset {_code(total.asset_ref)} · direction {_code(total.direction)}", "",
                  f"- Transfers: {_code(total.transfer_count)}",
                  f"- Display units: {_code(total.amount_display)}",
                  f"- Base units: {_code(total.amount_base_units)}",
                  f"- Decimals: {_code(total.decimals)}",
                  "- Evidence:"]
        lines += ["  - " + _code(ref) for ref in total.evidence_refs]
        lines.append("")
    if not answer.totals:
        lines += ["No asset totals were returned.", ""]
    for title, values in (("Source references", answer.source_refs),
                          ("Report and record evidence", answer.evidence_refs),
                          ("Reported limitations", answer.limitations)):
        lines += ["## " + title, ""]
        lines += ["- " + _code(value) for value in values] or ["None supplied."]
        lines.append("")
    lines += ["Transfer amounts describe activity, not wallet balances or profit.", "",
              "The payment-network label is a backend observation. This presentation does not "
              "independently verify payment settlement or merchant delivery.", ""]
    return "\n".join(lines)


_STYLE = """html{color-scheme:light}body{margin:0;background:#f3f6fa;color:#172235;
font:16px/1.6 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:36px 24px}
h1{font-size:2rem;line-height:1.2}h2{margin-top:2rem;font-size:1.3rem}h3{font-size:1rem}
.notice{padding:12px 16px;border-left:4px solid #526987;background:#e6edf6}
.warning{border-color:#9b5600;background:#fff0d9}dl{display:grid;
grid-template-columns:minmax(160px,1fr) minmax(0,3fr);gap:8px 16px}
dt{font-weight:650}dd{margin:0}code,pre{font-family:ui-monospace,monospace;
overflow-wrap:anywhere;white-space:pre-wrap}pre{padding:18px;background:white;
border:1px solid #d8e0e9;border-radius:8px}section.total{padding:16px 20px;
margin:12px 0;background:white;border:1px solid #d8e0e9;border-radius:8px}
li{overflow-wrap:anywhere}footer{margin-top:28px;color:#46566c;font-size:.9rem}
@media(max-width:600px){main{padding:20px 16px}dl{display:block}dd{margin:0 0 10px}}
@media print{body{background:white}main{padding:0}.total,pre{break-inside:avoid}}
"""


def render_html(answer: AnalyticsAnswer) -> str:
    """Return a self-contained document; no dynamic attribute or active link."""
    answer = _answer(answer)

    def escape(value: object) -> str:
        return html.escape(str(value), quote=True)

    def listing(values: tuple[str, ...]) -> str:
        if not values:
            return "<p>None supplied.</p>"
        return "<ul>" + "".join("<li><code>" + escape(v) + "</code></li>" for v in values) + "</ul>"

    status = ("Synthetic data." if answer.is_synthetic else
              "Data is marked non-synthetic by the supplied answer.")
    coverage_class = "notice" if answer.complete else "notice warning"
    pieces = ["<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">",
              "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
              '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
              "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
              "<title>Wallet transfer report</title><style>" + _STYLE + "</style></head>",
              "<body><main><h1>Wallet transfer report</h1>",
              '<p class="notice">' + escape(status) + "</p>",
              '<p class="' + coverage_class + '">' + escape(_coverage(answer)) + "</p>",
              "<dl>"]
    pieces += ["<dt>" + escape(label) + "</dt><dd><code>" + escape(value) + "</code></dd>"
               for label, value in _metadata(answer)]
    pieces += ["</dl><h2>Summary</h2><pre>" + escape(answer.answer_text) + "</pre>"]
    if empty := _empty(answer):
        pieces.append('<p class="' + coverage_class + '">' + escape(empty) + "</p>")
    pieces += ["<h2>Amounts by asset and direction</h2>",
               "<p>Each amount keeps its own asset and direction. No cross-asset total is calculated.</p>"]
    for total in answer.totals:
        pieces += ['<section class="total"><h3>Asset <code>' + escape(total.asset_ref) +
                   "</code> · direction <code>" + escape(total.direction) + "</code></h3><dl>"]
        pieces += ["<dt>" + escape(label) + "</dt><dd><code>" + escape(value) + "</code></dd>"
                   for label, value in (("Transfers", total.transfer_count),
                                        ("Display units", total.amount_display),
                                        ("Base units", total.amount_base_units),
                                        ("Decimals", total.decimals))]
        pieces += ["</dl><h3>Evidence</h3>" + listing(total.evidence_refs) + "</section>"]
    if not answer.totals:
        pieces.append("<p>No asset totals were returned.</p>")
    for title, values in (("Source references", answer.source_refs),
                          ("Report and record evidence", answer.evidence_refs),
                          ("Reported limitations", answer.limitations)):
        pieces.append("<h2>" + title + "</h2>" + listing(values))
    pieces += ["<footer><p>Transfer amounts describe activity, not wallet balances or profit.</p>",
               "<p>The payment-network label is a backend observation. This presentation does not "
               "independently verify payment settlement or merchant delivery.</p></footer>",
               "</main></body></html>\n"]
    return "\n".join(pieces)
