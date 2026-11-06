"""Deterministic wording for a validated transfer answer, without new inference.

Output preferences affect prose only. They cannot change report scope, access,
amounts, evidence or the answer schema, and never require another model call.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import re

from .analytics import AnalyticsAnswer


@dataclass(frozen=True)
class OutputOptions:
    language: str = "en"
    focus: str = "summary"

    def __post_init__(self) -> None:
        if self.language not in ("ko", "en") or self.focus not in (
                "summary", "incoming", "outgoing", "count"):
            raise ValueError("Unsupported output options")


# Only finite output declarations are cues; a descriptive language noun is not.
# Negated declarations are ignored, and conflicting positive cues keep the
# request-language fallback rather than guessing which declaration to follow.
_LANGUAGE = re.compile(
    r"(?P<ko>\b(?:in|use)\s+korean\b|\bkorean(?:으로|로)|(?:한국어|한글|국문)(?:으로|로))|"
    r"(?P<en>\b(?:in|use)\s+english\b|\benglish(?:으로|로)|(?:영어|영문)(?:으로|로))", re.IGNORECASE)
_LANGUAGE_REPLACEMENT = re.compile(
    r"(?:한국어|한글|국문|\bKorean)\s*대신\s*(?P<en>English|영어|영문)(?:으로|로)?|"
    r"(?:영어|영문|\bEnglish)\s*대신\s*(?P<ko>Korean|한국어|한글|국문)(?:으로|로)?", re.IGNORECASE)
_CLAUSE_BOUNDARY = re.compile(r"[.!?;,\n]")
_LANGUAGE_NEGATED_BEFORE = re.compile(r"\b(?:not|never|don't|do\s+not|cannot|can't)\b", re.IGNORECASE)
_LANGUAGE_NEGATED_AFTER = re.compile(r"(?:하지|쓰지)\s*(?:마|말|않)|말고|아닌|아니|금지")
_HANGUL = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]")
_FOCUS = {
    "incoming": re.compile(
        r"(?<!\w)입금\s*만(?![가-힣])|\b(?:only\s+(?:incoming(?:\s+transfers?)?|deposits?)|"
        r"(?:incoming(?:\s+transfers?)?|deposits?)\s+only)\b", re.IGNORECASE),
    "outgoing": re.compile(
        r"(?<!\w)출금\s*만(?![가-힣])|\b(?:only\s+(?:outgoing(?:\s+transfers?)?|withdrawals?)|"
        r"(?:outgoing(?:\s+transfers?)?|withdrawals?)\s+only)\b", re.IGNORECASE),
    "count": re.compile(
        r"(?<!\w)(?:건수|거래\s*건수|횟수)\s*만(?![가-힣])|"
        r"\b(?:only\s+(?:the\s+)?(?:transfer\s+counts?|counts?|number\s+of\s+transfers?)|"
        r"(?:transfer\s+counts?|counts?|number\s+of\s+transfers?)\s+only)\b", re.IGNORECASE),
}
_AMBIGUOUS_FOCUS = re.compile(
    r"\b(?:not|don't|do\s+not|except|excluding|exclude|without)\b|말고|제외|빼고|아닌|아니",
    re.IGNORECASE)
_DIRECTION_WORDS = {
    "incoming": re.compile(r"입금|\b(?:incoming|deposits?)\b", re.IGNORECASE),
    "outgoing": re.compile(r"출금|\b(?:outgoing|withdrawals?)\b", re.IGNORECASE),
}
_COMBINED_COUNT = re.compile(
    r"\bcounts?\s+(?:only\s+)?(?:and|or)\s+(?:amounts?|totals?|values?)\b|"
    r"\b(?:amounts?|totals?|values?)\s+(?:and|or)\s+(?:transfer\s+)?counts?\b|"
    r"(?:건수|횟수)\s*만?\s*(?:과|와|및|하고|,).*?(?:금액|수량)|"
    r"(?:금액|수량)\s*(?:과|와|및|하고|,).*?(?:건수|횟수)|(?:금액|수량)\s*도", re.IGNORECASE)


def _output_language(purpose: str) -> str:
    fallback = "ko" if _HANGUL.search(purpose) else "en"
    # Merge the replacement form with normal declarations at the same start.
    # This keeps English로 in "한국어 대신 English로" as one declaration.
    cues = {(cue.start(), cue.lastgroup): cue.end() for cue in _LANGUAGE.finditer(purpose)}
    for cue in _LANGUAGE_REPLACEMENT.finditer(purpose):
        start = cue.start(cue.lastgroup)
        key = (start, cue.lastgroup)
        cues[key] = max(cues.get(key, 0), cue.end())
    ordered = sorted((start, end, language) for (start, language), end in cues.items())
    boundaries = tuple(match.start() for match in _CLAUSE_BOUNDARY.finditer(purpose))
    languages = set()
    for index, (start, end, language) in enumerate(ordered):
        left = max((point + 1 for point in boundaries if point < start), default=0)
        right = min((point for point in boundaries if point >= end), default=len(purpose))
        if index:
            left = max(left, ordered[index - 1][1])
        if index + 1 < len(ordered):
            right = min(right, ordered[index + 1][0])
        if (_LANGUAGE_NEGATED_BEFORE.search(purpose[left:start]) or
                _LANGUAGE_NEGATED_AFTER.search(purpose[end:right])):
            continue
        languages.add(language)
    return next(iter(languages)) if len(languages) == 1 else fallback


def infer_output_options(purpose: str) -> OutputOptions:
    """Recognize narrow wording preferences; uncertainty keeps the full summary."""
    if type(purpose) is not str:
        raise TypeError("Purpose must be text")
    language = _output_language(purpose)
    focuses = [focus for focus, pattern in _FOCUS.items() if pattern.search(purpose)]
    focus = focuses[0] if len(focuses) == 1 and not _AMBIGUOUS_FOCUS.search(purpose) else "summary"
    if (focus in _DIRECTION_WORDS and _DIRECTION_WORDS[
            "outgoing" if focus == "incoming" else "incoming"].search(purpose)):
        focus = "summary"
    if focus == "count" and _COMBINED_COUNT.search(purpose):
        focus = "summary"
    return OutputOptions(language, focus)


_LIMITATIONS = (
    ("Partial coverage: counts and amounts cover only the returned transfers.",
     "일부 범위만 조회되었습니다. 건수와 금액은 반환된 전송 내역에만 해당합니다."),
    ("Pagination is incomplete; more records may exist.",
     "페이지 조회가 완료되지 않아 추가 내역이 있을 수 있습니다."),
    ("Transfer amounts are activity, not wallet balances or profit.",
     "전송 금액은 활동 내역이며, 지갑 잔액이나 수익을 나타내지 않습니다."),
)


def present_answer(answer: AnalyticsAnswer, options: OutputOptions, *, purpose: str = "") -> AnalyticsAnswer:
    """Replace only prose on the already validated answer.

    Focus applies to the narrative. All original totals and references remain
    in the returned answer and its detailed renderings. Unknown limitations are
    preserved verbatim rather than being reinterpreted or translated.
    """
    if not isinstance(answer, AnalyticsAnswer) or not isinstance(options, OutputOptions):
        raise TypeError("Present a validated AnalyticsAnswer with OutputOptions")
    if type(purpose) is not str:
        raise TypeError("Purpose must be text")
    ko = options.language == "ko"
    translations = {text: pair[1 if ko else 0] for pair in _LIMITATIONS for text in pair}
    limitations = tuple(translations.get(text, text) for text in answer.limitations)
    lines = []
    if answer.is_synthetic:
        lines.append("합성 데이터 기반 지갑 전송 보고서." if ko else "Synthetic wallet-transfer report.")
    coverage_warnings = tuple(pair[1 if ko else 0] for pair in _LIMITATIONS[:2])
    if not answer.complete:
        lines.append(coverage_warnings[0])
    lines.extend(text for text in limitations if text in coverage_warnings and text not in lines)
    directions = {"in": "입금" if ko else "Incoming", "out": "출금" if ko else "Outgoing",
                  "self": "동일 지갑 내 전송" if ko else "Self transfer"}
    direction = {"incoming": "in", "outgoing": "out"}.get(options.focus)
    if direction is None:
        lines.append(f"반환된 전송: {answer.transfer_count}건." if ko else
                     f"Returned transfers: {answer.transfer_count}.")
    else:
        count = sum(total.transfer_count for total in answer.totals if total.direction == direction)
        lines.append(f"반환된 {directions[direction]}: {count}건." if ko else
                     f"Returned {directions[direction].lower()} transfers: {count}.")
    if options.focus == "count":
        for direction, label in directions.items():
            count = sum(total.transfer_count for total in answer.totals if total.direction == direction)
            lines.append(f"{label}: {count}건." if ko else
                         f"{label}: {count} transfer{'s' if count != 1 else ''}.")
    else:
        totals = tuple(total for total in answer.totals if direction is None or total.direction == direction)
        for total in totals:
            label = directions.get(total.direction, total.direction)
            lines.append(f"{total.asset_ref} · {label} ({total.direction}): {total.transfer_count}건, "
                         f"{total.amount_display} 단위." if ko else
                         f"{total.asset_ref} · {label} ({total.direction}): {total.transfer_count} "
                         f"transfer{'s' if total.transfer_count != 1 else ''}, "
                         f"{total.amount_display} units.")
        if direction is not None and not totals and answer.transfer_count:
            lines.append(f"반환된 보고서에 {directions[direction]} 내역이 없습니다." if ko else
                         f"No {directions[direction].lower()} transfers were returned in this report.")
    if not answer.transfer_count:
        if ko:
            lines.append("반환된 보고서에 전송 내역이 없습니다." if answer.complete else
                         "반환된 전송 내역이 없습니다. 조회 범위가 불완전하므로 활동이 없었다고 판단할 수 없습니다.")
        else:
            lines.append("No transfers in the returned report." if answer.complete else
                         "No transfers were returned; incomplete coverage cannot establish no activity.")
    lines.extend(text for text in limitations if text not in coverage_warnings)
    if purpose:
        lines.append(("요청: " if ko else "Request: ") + purpose)
    return replace(answer, answer_text="\n".join(lines), limitations=limitations)
