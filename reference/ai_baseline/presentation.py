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
    r"(?P<ko>\b(?:in|use)\s+korean\b|\b(?:language|reply|answer|response|summary|explanation)\s+(?:to|:)\s*korean\b|"
    r"\bkorean(?:으로|로)|(?:한국어|한글|국문)(?:으로|로))|"
    r"(?P<en>\b(?:in|use)\s+english\b|\b(?:language|reply|answer|response|summary|explanation)\s+(?:to|:)\s*english\b|"
    r"\benglish(?:으로|로)|(?:영어|영문)(?:으로|로))", re.IGNORECASE)
_LANGUAGE_REPLACEMENT = re.compile(
    r"(?:한국어|한글|국문|\bKorean)\s*대신\s*(?P<en>English|영어|영문)(?:으로|로)?|"
    r"(?:영어|영문|\bEnglish)\s*대신\s*(?P<ko>Korean|한국어|한글|국문)(?:으로|로)?", re.IGNORECASE)
_CLAUSE_BOUNDARY = re.compile(r"[.!?;,\n]")
_LANGUAGE_NEGATED_BEFORE = re.compile(
    r"\b(?:not|never|don't|do\s+not|cannot|can't)\b"
    r"(?:\s+(?:answer|reply|respond|write|explain|summarize|speak|use|change|switch|set|the|my|your))*\s*$",
    re.IGNORECASE)
_LANGUAGE_NEGATED_AFTER = re.compile(
    r"^[\s,;:]*(?:는|은)?\s*(?:(?:답변|답|작성|설명|요약|표현|응답|사용|번역)\s*)?"
    r"(?:(?:하지|쓰지)\s*(?:마|말|않)|말고|아닌|아니|금지)")
_HANGUL = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]")
_FOCUS = {
    "incoming": re.compile(
        r"(?<!\w)입금\s*만(?=$|[^가-힣]|말고|보지|알려|보여|요약|설명)|\b(?:only\s+(?:(?:returned|observed)\s+)?(?:incoming(?:\s+(?:returned|observed))?(?:\s+transfers?)?|deposits?)|"
        r"(?:incoming(?:\s+(?:returned|observed))?(?:\s+transfers?)?|deposits?)(?:\s+|-)only)\b", re.IGNORECASE),
    "outgoing": re.compile(
        r"(?<!\w)출금\s*만(?=$|[^가-힣]|말고|보지|알려|보여|요약|설명)|\b(?:only\s+(?:(?:returned|observed)\s+)?(?:outgoing(?:\s+(?:returned|observed))?(?:\s+transfers?)?|withdrawals?)|"
        r"(?:outgoing(?:\s+(?:returned|observed))?(?:\s+transfers?)?|withdrawals?)(?:\s+|-)only)\b", re.IGNORECASE),
    "count": re.compile(
        r"(?<!\w)(?:건수|(?:거래|이체|전송)\s*건수|횟수)\s*만(?=$|[^가-힣]|말고|보지|알려|보여|요약|설명)|"
        r"\b(?:only\s+(?:the\s+)?(?:transfer\s+counts?|counts?|number\s+of\s+transfers?)|"
        r"(?:transfer\s+counts?|counts?|number\s+of\s+transfers?)(?:\s+|-)only)\b", re.IGNORECASE),
}
_FOCUS_NEGATED_BEFORE = re.compile(
    r"\b(?:not|never|don't|do\s+not|except|excluding|exclude|without)"
    r"(?:\s+(?:want|need|show|summarize|include|display|give|list|just|the))*\s*$", re.IGNORECASE)
_FOCUS_NEGATED_AFTER = re.compile(
    r"^\s*(?:(?:보지|알려\s*주지|설명하지|요약하지)\s*)?(?:말고|제외|빼고|아닌|아니)|"
    r"^\s*\b(?:not|except|excluding|without)\b", re.IGNORECASE)
_DIRECTION_WORDS = {
    "incoming": re.compile(r"입금|\b(?:incoming|deposits?)\b", re.IGNORECASE),
    "outgoing": re.compile(r"출금|\b(?:outgoing|withdrawals?)\b", re.IGNORECASE),
}
_COMBINED_COUNT = re.compile(
    r"\bcounts?\s+(?:only\s+)?(?:and|or)\s+(?:amounts?|totals?|values?)\b|"
    r"\b(?:amounts?|totals?|values?)\s+(?:and|or)\s+(?:transfer\s+)?counts?\b|"
    r"(?:건수|횟수)\s*만?\s*(?:과|와|및|하고|,).*?(?:금액|수량)|"
    r"(?:금액|수량)\s*(?:과|와|및|하고|,).*?(?:건수|횟수)|(?:금액|수량)\s*도", re.IGNORECASE)


def _declared_language(purpose: str) -> tuple[str | None, bool]:
    """A finite positive declaration, separately from script-based fallback."""
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
    return (next(iter(languages)) if len(languages) == 1 else None, bool(languages))


def _output_language(purpose: str) -> str:
    selected, _ = _declared_language(purpose)
    return selected or ("ko" if _HANGUL.search(purpose) else "en")


def _output_focus(purpose: str) -> str:
    focuses = [focus for focus, pattern in _FOCUS.items() if pattern.search(purpose)]
    negated = False
    for pattern in _FOCUS.values():
        for cue in pattern.finditer(purpose):
            left = max((m.end() for m in _CLAUSE_BOUNDARY.finditer(purpose[:cue.start()])), default=0)
            if (_FOCUS_NEGATED_BEFORE.search(purpose[left:cue.start()]) or
                    _FOCUS_NEGATED_AFTER.search(purpose[cue.end():])):
                negated = True
    focus = focuses[0] if len(focuses) == 1 and not negated else "summary"
    if (focus in _DIRECTION_WORDS and _DIRECTION_WORDS[
            "outgoing" if focus == "incoming" else "incoming"].search(purpose)):
        focus = "summary"
    if focus == "count" and _COMBINED_COUNT.search(purpose):
        focus = "summary"
    return focus


# These exact authored end sentences preserve presentation choices through the
# existing purpose field. They are prose, never scope/permission declarations.
_OUTPUT_SENTENCES = {
    ("ko", "summary"): "출력 조건: 한국어로 반환된 이체를 요약합니다.",
    ("ko", "incoming"): "출력 조건: 한국어로 반환된 입금만 요약합니다.",
    ("ko", "outgoing"): "출력 조건: 한국어로 반환된 출금만 요약합니다.",
    ("ko", "count"): "출력 조건: 한국어로 반환된 이체의 건수만 설명합니다.",
    ("en", "summary"): "Output: Summarize returned transfers in English.",
    ("en", "incoming"): "Output: Summarize incoming transfers only in English.",
    ("en", "outgoing"): "Output: Summarize outgoing transfers only in English.",
    ("en", "count"): "Output: Show only transfer counts in English.",
}
_SENTENCE_OPTIONS = {sentence: OutputOptions(*key) for key, sentence in _OUTPUT_SENTENCES.items()}
_FULL_SUMMARY = re.compile(
    r"\b(?:summarize|show|include|review)\s+(?:all|both)\s+(?:returned\s+)?(?:transfers|directions)\b|"
    r"\bboth\s+incoming\s+and\s+outgoing\b|"
    r"전체\s*(?:이체|송금|내역)|입금과\s*출금|입출금\s*(?:모두|전체)", re.IGNORECASE)


def _canonical_options(text: str) -> OutputOptions | None:
    return next((options for sentence, options in _SENTENCE_OPTIONS.items()
                 if text == sentence or text.endswith(("\n" + sentence, " " + sentence))), None)


def with_output_options(purpose: str, options: OutputOptions, *, max_length: int = 2_000) -> str:
    """Bind one bounded output sentence without truncating or inventing a goal."""
    if type(purpose) is not str or not isinstance(options, OutputOptions):
        raise TypeError("Purpose and output options are required")
    base = purpose.strip()
    while prior := _canonical_options(base):
        base = base[:-len(_OUTPUT_SENTENCES[(prior.language, prior.focus)])].strip()
    if not base:
        raise ValueError("A clear goal is required")
    result = base + "\n" + _OUTPUT_SENTENCES[(options.language, options.focus)]
    if len(result) > max_length:
        raise ValueError("Purpose exceeds output boundary")
    return result


def derive_output_options(user_messages: list[str], prior_purpose: str | None = None,
                          interface_language: str | None = None) -> OutputOptions:
    """Latest explicit user choice, previous user/purpose choice, UI fallback.

    Callers supply only genuine user turns. Memory/catalog/assistant prose never
    participates. An ambiguous explicit focus keeps the full narrative; neither
    an English goal nor a Korean proper noun overrides a supplied UI fallback.
    """
    if (type(user_messages) is not list or any(type(text) is not str for text in user_messages)
            or (prior_purpose is not None and type(prior_purpose) is not str)):
        raise TypeError("Output declarations must be user text")
    if interface_language is not None and interface_language not in ("ko", "en"):
        raise ValueError("Unsupported interface language")
    purpose = prior_purpose or ""
    fallback_text = purpose or (user_messages[-1] if user_messages else "")
    fallback_language = interface_language or _output_language(fallback_text)
    language = focus = None
    for text in [*reversed(user_messages), purpose]:
        canonical = _canonical_options(text)
        if canonical:
            language = language or canonical.language
            if focus is None:
                focus = canonical.focus
        if language is None:
            declared, mentioned = _declared_language(text)
            if mentioned:
                language = declared or fallback_language
        if focus is None and (any(pattern.search(text) for pattern in _FOCUS.values()) or _FULL_SUMMARY.search(text) or _COMBINED_COUNT.search(text)):
            focus = _output_focus(text)
        if language is not None and focus is not None:
            break
    return OutputOptions(language or fallback_language, focus or "summary")


def infer_output_options(purpose: str) -> OutputOptions:
    """Recognize narrow wording preferences; uncertainty keeps the full summary."""
    if type(purpose) is not str:
        raise TypeError("Purpose must be text")
    return _canonical_options(purpose) or OutputOptions(_output_language(purpose), _output_focus(purpose))


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
