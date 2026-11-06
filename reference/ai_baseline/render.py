"""Deterministic presentation of an already validated AnalyticsAnswer.

Call consume_analytics before rendering. This module neither authorizes access
nor authenticates a payment, provider, or report. References remain inert text.
"""

from __future__ import annotations

import html
import re

from .analytics import AnalyticsAnswer
from .presentation import OutputOptions


_COPY = {
    "title": ("Wallet transfer report", "지갑 전송 보고서"),
    "synthetic": ("Synthetic data.", "합성 데이터입니다."),
    "non_synthetic": ("Data is marked non-synthetic by the supplied answer.",
                      "제공된 분석 결과에 비합성 데이터로 표시되어 있습니다."),
    "partial": ("Partial coverage — counts and amounts cover only returned transfers.",
                "일부 범위만 조회되었습니다. 건수와 금액은 반환된 전송 내역에만 해당합니다."),
    "complete": ("Complete within the supplied report's declared scope.",
                 "제공된 보고서가 선언한 범위 내에서 조회가 완료되었습니다."),
    "empty_complete": ("No transfers in the returned report.", "반환된 보고서에 전송 내역이 없습니다."),
    "empty_partial": ("No transfers were returned; incomplete coverage cannot establish no activity.",
                      "반환된 전송 내역이 없습니다. 조회 범위가 불완전하므로 활동이 없었다고 판단할 수 없습니다."),
    "wallet": ("Wallet", "지갑"),
    "data_network": ("Data network", "데이터 네트워크"),
    "payment_network": ("Payment network (backend observation)", "결제 네트워크 (백엔드 관측값)"),
    "window_start": ("Window start (inclusive)", "조회 시작 (포함)"),
    "window_end": ("Window end (exclusive)", "조회 종료 (미포함)"),
    "data_as_of": ("Data as of", "데이터 기준 시각"),
    "generated_at": ("Report generated at", "보고서 생성 시각"),
    "transfer_count": ("Returned transfers", "반환된 전송 건수"),
    "generator": ("Summary generator", "요약 생성기"),
    "summary": ("Summary", "요약"),
    "metadata": ("Report scope and details", "조회 범위와 보고서 정보"),
    "totals": ("Amounts by asset and direction", "자산·방향별 금액"),
    "separate_assets": ("Each amount keeps its own asset and direction. No cross-asset total is calculated.",
                        "금액은 자산과 방향별로 구분합니다. 서로 다른 자산의 금액을 합산하지 않습니다."),
    "asset": ("Asset", "자산"),
    "direction": ("direction", "방향"),
    "transfers": ("Transfers", "전송 건수"),
    "display_units": ("Display units", "표시 단위 금액"),
    "base_units": ("Base units", "최소 단위 금액"),
    "decimals": ("Decimals", "소수 자릿수"),
    "evidence": ("Evidence", "근거"),
    "empty_totals": ("No asset totals were returned.", "반환된 자산별 합계가 없습니다."),
    "sources": ("Source references", "출처 참조"),
    "records": ("Report and record evidence", "보고서·개별 내역 근거"),
    "limitations": ("Reported limitations", "보고서의 한계"),
    "none": ("None supplied.", "제공된 항목이 없습니다."),
    "activity": ("Transfer amounts describe activity, not wallet balances or profit.",
                 "전송 금액은 활동 내역이며, 지갑 잔액이나 수익을 나타내지 않습니다."),
    "payment_observation": ("The payment-network label is a backend observation. This presentation does not "
                            "independently verify payment settlement or merchant delivery.",
                            "결제 네트워크 표시는 백엔드 관측값입니다. 이 보고서 화면은 결제 정산이나 "
                            "판매자 전달 완료를 독립적으로 검증하지 않습니다."),
}


def _copy(language: str) -> dict[str, str]:
    options = OutputOptions(language=language)
    return {key: values[options.language == "ko"] for key, values in _COPY.items()}


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


def _coverage(answer: AnalyticsAnswer, words: dict[str, str]) -> str:
    return words["complete" if answer.complete else "partial"]


def _empty(answer: AnalyticsAnswer, words: dict[str, str]) -> str:
    if answer.transfer_count:
        return ""
    return words["empty_complete" if answer.complete else "empty_partial"]


def _metadata(answer: AnalyticsAnswer, words: dict[str, str]) -> tuple[tuple[str, object], ...]:
    return (
        (words["wallet"], answer.wallet),
        (words["data_network"], answer.data_network),
        (words["payment_network"], answer.payment_network),
        (words["window_start"], answer.window_start),
        (words["window_end"], answer.window_end),
        (words["data_as_of"], answer.data_as_of),
        (words["generated_at"], answer.generated_at),
        (words["transfer_count"], answer.transfer_count),
        (words["generator"], answer.generator_version),
    )


def render_markdown(answer: AnalyticsAnswer, language: str = "en") -> str:
    """Return CommonMark with inert code spans/blocks for every dynamic value."""
    answer = _answer(answer)
    words = _copy(language)
    lines = ["# " + words["title"], "",
             "**" + words["synthetic" if answer.is_synthetic else "non_synthetic"] + "**",
             "", "**" + _coverage(answer, words) + "**", ""]
    lines += ["", "## " + words["summary"], "", _block(answer.answer_text), ""]
    if empty := _empty(answer, words):
        lines += [empty, ""]
    lines += ["## " + words["metadata"], ""]
    lines += [f"- {label}: {_code(value)}" for label, value in _metadata(answer, words)]
    lines.append("")
    lines += ["## " + words["totals"], "", words["separate_assets"], ""]
    for total in answer.totals:
        lines += [f"### {words['asset']} {_code(total.asset_ref)} · {words['direction']} {_code(total.direction)}", "",
                  f"- {words['transfers']}: {_code(total.transfer_count)}",
                  f"- {words['display_units']}: {_code(total.amount_display)}",
                  f"- {words['base_units']}: {_code(total.amount_base_units)}",
                  f"- {words['decimals']}: {_code(total.decimals)}",
                  "- " + words["evidence"] + ":"]
        lines += ["  - " + _code(ref) for ref in total.evidence_refs]
        lines.append("")
    if not answer.totals:
        lines += [words["empty_totals"], ""]
    for title, values in ((words["sources"], answer.source_refs),
                          (words["records"], answer.evidence_refs),
                          (words["limitations"], answer.limitations)):
        lines += ["## " + title, ""]
        lines += ["- " + _code(value) for value in values] or [words["none"]]
        lines.append("")
    lines += [words["activity"], "", words["payment_observation"], ""]
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
details.metadata{margin:20px 0;padding:12px 16px;background:#e6edf6;border-radius:8px}
details.metadata summary{cursor:pointer;font-weight:650}
@media(max-width:600px){main{padding:20px 16px}dl{display:block}dd{margin:0 0 10px}}
@media print{body{background:white}main{padding:0}.total,pre{break-inside:avoid}}
"""


def render_html(answer: AnalyticsAnswer, language: str = "en") -> str:
    """Return a self-contained document; no dynamic attribute or active link."""
    answer = _answer(answer)
    words = _copy(language)

    def escape(value: object) -> str:
        return html.escape(str(value), quote=True)

    def listing(values: tuple[str, ...]) -> str:
        if not values:
            return "<p>" + words["none"] + "</p>"
        return "<ul>" + "".join("<li><code>" + escape(v) + "</code></li>" for v in values) + "</ul>"

    status = words["synthetic" if answer.is_synthetic else "non_synthetic"]
    coverage_class = "notice" if answer.complete else "notice warning"
    pieces = ['<!doctype html>\n<html lang="' + language + '"><head><meta charset="utf-8">',
              "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
              '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
              "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
              "<title>" + words["title"] + "</title><style>" + _STYLE + "</style></head>",
              "<body><main><h1>" + words["title"] + "</h1>",
              '<p class="notice">' + escape(status) + "</p>",
              '<p class="' + coverage_class + '">' + escape(_coverage(answer, words)) + "</p>",
              "<h2>" + words["summary"] + "</h2><pre>" + escape(answer.answer_text) + "</pre>"]
    if empty := _empty(answer, words):
        pieces.append('<p class="' + coverage_class + '">' + escape(empty) + "</p>")
    pieces += ['<details class="metadata"><summary>' + words["metadata"] + "</summary><dl>"]
    pieces += ["<dt>" + escape(label) + "</dt><dd><code>" + escape(value) + "</code></dd>"
               for label, value in _metadata(answer, words)]
    pieces.append("</dl></details>")
    pieces += ["<h2>" + words["totals"] + "</h2>", "<p>" + words["separate_assets"] + "</p>"]
    for total in answer.totals:
        pieces += ['<section class="total"><h3>' + words["asset"] + " <code>" + escape(total.asset_ref) +
                   "</code> · " + words["direction"] + " <code>" + escape(total.direction) + "</code></h3><dl>"]
        pieces += ["<dt>" + escape(label) + "</dt><dd><code>" + escape(value) + "</code></dd>"
                   for label, value in ((words["transfers"], total.transfer_count),
                                        (words["display_units"], total.amount_display),
                                        (words["base_units"], total.amount_base_units),
                                        (words["decimals"], total.decimals))]
        pieces += ["</dl><h3>" + words["evidence"] + "</h3>" + listing(total.evidence_refs) + "</section>"]
    if not answer.totals:
        pieces.append("<p>" + words["empty_totals"] + "</p>")
    for title, values in ((words["sources"], answer.source_refs),
                          (words["records"], answer.evidence_refs),
                          (words["limitations"], answer.limitations)):
        pieces.append("<h2>" + title + "</h2>" + listing(values))
    pieces += ["<footer><p>" + words["activity"] + "</p>",
               "<p>" + words["payment_observation"] + "</p></footer>",
               "</main></body></html>\n"]
    return "\n".join(pieces)
