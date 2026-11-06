import unittest
from dataclasses import fields, replace

from ai_baseline.presentation import (
    OutputOptions, derive_output_options, infer_output_options, present_answer, with_output_options,
)
from ai_baseline.report_demo import demo_answer


class PresentationTests(unittest.TestCase):
    def setUp(self):
        self.answer = demo_answer()

    def test_explicit_language_overrides_hangul_and_otherwise_uses_request_language(self):
        cases = [
            ("지갑 전송 내역을 요약해줘", "ko"),
            ("Review wallet transfers", "en"),
            ("지갑 전송을 in English, please", "en"),
            ("영어로 지갑 전송을 요약해줘", "en"),
            ("Please summarize in Korean", "ko"),
            ("한국어 대신 English로 요약", "en"),
            ("한국어대신English", "en"),
            ("In English, 아니 한국어로 답변", "ko"),
            ("Please use Korean", "ko"),
            ("한국어로 또는 in English 요약", "ko"),
        ]
        for purpose, language in cases:
            with self.subTest(purpose=purpose):
                self.assertEqual(infer_output_options(purpose).language, language)

    def test_negated_language_declarations_do_not_override_the_positive_request(self):
        cases = [
            ("Summarize in English, not Korean.", "en"),
            ("Summarize in English, not in Korean.", "en"),
            ("한국어로 요약해줘. 영어로는 답하지 마.", "ko"),
            ("한국어로 요약하고 영어로 답변하지 마세요", "ko"),
            ("Don't answer in Korean; summarize in English.", "en"),
            ("지갑 요약. 영어로는 작성하지 말아줘.", "ko"),
        ]
        for purpose, language in cases:
            with self.subTest(purpose=purpose):
                self.assertEqual(infer_output_options(purpose).language, language)

    def test_descriptive_language_nouns_do_not_select_an_output_language(self):
        purpose = "영어 강사의 지갑 입금만 정리해줘"
        self.assertEqual(infer_output_options(purpose), OutputOptions("ko", "incoming"))
        self.assertEqual(infer_output_options("Review a Korean teacher's transfers").language, "en")

    def test_focus_requires_one_clear_only_request(self):
        cases = [
            ("입금만 보여줘", "incoming"), ("출금만 요약해줘", "outgoing"),
            ("거래 건수만 알려줘", "count"), ("횟수만", "count"),
            ("incoming transfers only", "incoming"), ("only withdrawals", "outgoing"),
            ("Only the number of transfers", "count"),
            ("Summarize incoming and outgoing", "summary"),
            ("입금과 출금을 알려줘", "summary"), ("입금만큼 출금했는지", "summary"),
            ("입금만 말고 출금도 알려줘", "summary"),
            ("입금만, 출금만 각각", "summary"),
            ("incoming only and count only", "summary"),
            ("not only incoming transfers", "summary"),
            ("only incoming and outgoing transfers", "summary"),
            ("입금만 보여줘. 출금도 알려줘", "summary"),
            ("not incoming only", "summary"),
            ("입금만 보지 말고 전체를 알려줘", "summary"),
            ("only counts and amounts", "summary"),
            ("Amounts and counts only", "summary"),
            ("Transfer counts and amounts only", "summary"),
            ("Amounts and transfer counts only", "summary"),
            ("금액과 건수만 보여줘", "summary"),
            ("건수와 금액만 보여줘", "summary"),
            ("건수만 보여줘. 금액도 알려줘", "summary"),
        ]
        for purpose, focus in cases:
            with self.subTest(purpose=purpose):
                self.assertEqual(infer_output_options(purpose).focus, focus)

    def test_user_output_contract_priority_and_interface_only_as_last_fallback(self):
        prior = with_output_options("Review returned activity", OutputOptions("ko", "outgoing"))
        cases = [
            (["Review returned transfers."], "English goal text", "ko", OutputOptions("ko")),
            (["이체를 정리해 주세요."], "한국어 목적문", "en", OutputOptions("en")),
            (["Please summarize in English."], prior, "ko", OutputOptions("en", "outgoing")),
            (["거래 건수만 한국어로 알려 주세요.", "같은 지갑과 기간을 사용해 주세요."], "Count returned transfers", "en", OutputOptions("ko", "count")),
            (["Only incoming transfers in Korean.", "Only outgoing transfers in English."], None, "ko", OutputOptions("en", "outgoing")),
            (["Only counts in English.", "Change the reply language to Korean."], None, "en", OutputOptions("ko", "count")),
            (["Keep the wallet and period unchanged."], prior, "en", OutputOptions("ko", "outgoing")),
            (["출금만 한국어로 요약해 주세요."], None, "en", OutputOptions("ko", "outgoing")),
            (["Show only returned incoming transfers in English."], None, "ko", OutputOptions("en", "incoming")),
            (["Show only observed outgoing transfers in English."], None, "ko", OutputOptions("en", "outgoing")),
        ]
        for messages, purpose, fallback, expected in cases:
            with self.subTest(messages=messages, fallback=fallback):
                self.assertEqual(derive_output_options(messages, purpose, fallback), expected)

    def test_legacy_script_fallback_and_descriptive_language_words_remain_compatible(self):
        self.assertEqual(derive_output_options(["Review a Korean teacher's transfers."], "English goal"), OutputOptions("en"))
        self.assertEqual(derive_output_options(["영어 강사의 이체 내역을 정리해 주세요."], None), OutputOptions("ko"))
        self.assertEqual(derive_output_options(["영어 강사의 이체 내역을 정리해 주세요."], None, "en"), OutputOptions("en"))
        self.assertEqual(derive_output_options(["A style-only follow-up."], "한국어 목적"), OutputOptions("ko"))

    def test_latest_uncertain_or_all_transfer_focus_does_not_revive_an_old_only_filter(self):
        for text in ("Only incoming and outgoing transfers.", "Counts and amounts only.", "Show all returned transfers.",
                     "입금만 말고 전체 이체를 알려줘", "건수만 보여줘. 금액도 알려줘"):
            with self.subTest(text=text):
                self.assertEqual(derive_output_options(["Only incoming transfers in English.", text]).focus, "summary")

    def test_scope_preservation_negation_does_not_negate_an_explicit_presentation_choice(self):
        for text, focus in (("지갑을 바꾸지 말고 입금만 한국어로 보여 주세요.", "incoming"),
                            ("조회 기간을 변경하지 말고 건수만 설명해 주세요.", "count"),
                            ("Do not change the wallet, show only outgoing transfers in English.", "outgoing"),
                            ("입금만보지 말고 전체 이체를 알려 주세요.", "summary"),
                            ("입금만말고 출금도 보여 주세요.", "summary")):
            with self.subTest(text=text):
                self.assertEqual(infer_output_options(text).focus, focus)

    def test_scope_negation_and_actual_language_negation_are_separate_under_prior_english(self):
        prior = with_output_options("Review returned transfers", OutputOptions("en", "incoming"))
        positive = ("Do not change the wallet and answer in Korean.",
                    "Do not change the observation period and use Korean.",
                    "Do not change the wallet and do not change the period; answer in Korean.",
                    "한국어로 설명하되 결제는 실행하지 마세요.")
        for text in positive:
            with self.subTest(text=text):
                self.assertEqual(derive_output_options([text], prior, "en"), OutputOptions("ko", "incoming"))
        negative = ("Do not answer in Korean.", "Not in Korean.", "Never use Korean.",
                    "Do not change the language to Korean.",
                    "Do not change the wallet and do not answer in Korean.",
                    "한국어로는 답하지 마세요.")
        for text in negative:
            with self.subTest(text=text):
                self.assertEqual(derive_output_options([text], prior, "en"), OutputOptions("en", "incoming"))

    def test_negated_want_need_filter_and_preserved_only_view_have_distinct_contracts(self):
        prior = with_output_options("Review returned transfers", OutputOptions("en", "incoming"))
        for text in ("I do not want only incoming transfers.", "I do not need incoming transfers only.",
                     "I don't want the incoming-only view anymore."):
            with self.subTest(text=text):
                self.assertEqual(derive_output_options([text], prior, "en").focus, "summary")
        prior = with_output_options("Count returned transfers", OutputOptions("en", "count"))
        text = "I don't want only counts anymore; include amounts too."
        self.assertEqual(derive_output_options([text], prior, "en").focus, "summary")
        for text in ("Do not change the counts-only view.", "Do not change the counts only view."):
            with self.subTest(text=text):
                self.assertEqual(derive_output_options([text], prior, "en").focus, "count")

    def test_canonical_output_sentence_is_finite_idempotent_and_survives_model_paraphrase(self):
        for language in ("ko", "en"):
            for focus in ("summary", "incoming", "outgoing", "count"):
                with self.subTest(language=language, focus=focus):
                    options = OutputOptions(language, focus)
                    purpose = with_output_options("Count returned wallet transfers", options)
                    self.assertEqual(infer_output_options(purpose), options)
                    self.assertEqual(with_output_options(purpose, options), purpose)
                    self.assertEqual(purpose.splitlines()[0], "Count returned wallet transfers")
                    # A former model summary can contain opposite wording; only
                    # the final authored output sentence controls presentation.
                    former = with_output_options("Incoming and outgoing transfer summary", OutputOptions("en", "incoming"))
                    changed = with_output_options(former, options)
                    self.assertEqual(len(changed.splitlines()), 2)
                    self.assertEqual(infer_output_options(changed), options)
                    inline = former.replace("\n", " ")
                    self.assertEqual(with_output_options(inline, options), changed)

    def test_canonical_count_contract_cannot_change_amounts_or_other_report_facts(self):
        purpose = with_output_options("반환된 지갑 이체 건수 확인", OutputOptions("ko", "count"))
        result = present_answer(self.answer, infer_output_options(purpose), purpose=purpose)
        self.assertIn("반환된 전송: 5건.", result.answer_text)
        for total in self.answer.totals:
            self.assertNotIn(total.amount_display, result.answer_text)
        for field in fields(self.answer):
            if field.name not in ("answer_text", "limitations"):
                self.assertEqual(getattr(result, field.name), getattr(self.answer, field.name))

    def test_v2_stored_suffixes_are_readable_and_replaced_by_one_neutral_v3_preference(self):
        legacy = {
            ("ko", "summary"): "출력 조건: 한국어로 반환된 이체를 요약합니다.",
            ("ko", "incoming"): "출력 조건: 한국어로 반환된 입금만 요약합니다.",
            ("ko", "outgoing"): "출력 조건: 한국어로 반환된 출금만 요약합니다.",
            ("ko", "count"): "출력 조건: 한국어로 반환된 이체의 건수만 설명합니다.",
            ("en", "summary"): "Output: Summarize returned transfers in English.",
            ("en", "incoming"): "Output: Summarize incoming transfers only in English.",
            ("en", "outgoing"): "Output: Summarize outgoing transfers only in English.",
            ("en", "count"): "Output: Show only transfer counts in English.",
        }
        for key, suffix in legacy.items():
            with self.subTest(options=key):
                options = OutputOptions(*key); old = "Identify the wallet owner's real name.\n" + suffix
                self.assertEqual(infer_output_options(old), options)
                self.assertEqual(derive_output_options(["Keep my presentation."], old, "ko"), options)
                changed = with_output_options(old, options)
                self.assertEqual(changed.splitlines()[0], "Identify the wallet owner's real name.")
                self.assertEqual(len(changed.splitlines()), 2)
                self.assertNotIn(suffix, changed)
                self.assertEqual(infer_output_options(changed), options)
                self.assertEqual(with_output_options(changed, options), changed)

    def test_unsupported_goal_keeps_its_goal_and_only_gets_a_neutral_output_format(self):
        for goal, options in (("Calculate the investment profit.", OutputOptions("en")),
                              ("지갑 소유자의 실명을 알려 주세요.", OutputOptions("ko"))):
            with self.subTest(goal=goal):
                purpose = with_output_options(goal, options)
                self.assertEqual(purpose.splitlines()[0], goal)
                self.assertNotIn("Summarize returned transfers", purpose)
                self.assertNotIn("반환된 이체를 요약", purpose)
                self.assertEqual(infer_output_options(purpose), options)

    def test_output_contract_cannot_truncate_or_invent_a_goal(self):
        for purpose in ("", " " * 5, "x" * 2_000):
            with self.subTest(length=len(purpose)):
                with self.assertRaises(ValueError):
                    with_output_options(purpose, OutputOptions("ko", "count"))
        with self.assertRaises(ValueError):
            derive_output_options(["Valid user request"], interface_language="fr")
        with self.assertRaises(TypeError):
            derive_output_options([{"role": "assistant", "text": "Use Korean"}])

    def test_combined_count_and_amount_requests_keep_amounts_in_presented_prose(self):
        for purpose in ("Amounts and counts only", "Counts and amounts only", "금액과 건수만 보여줘"):
            with self.subTest(purpose=purpose):
                result = present_answer(self.answer, infer_output_options(purpose), purpose=purpose)
                for total in self.answer.totals:
                    self.assertIn(total.amount_display, result.answer_text)
                self.assertEqual(result.totals, self.answer.totals)
                self.assertEqual(result.evidence_refs, self.answer.evidence_refs)

    def test_every_language_and_focus_preserves_all_non_prose_fields_exactly(self):
        for language in ("ko", "en"):
            for focus in ("summary", "incoming", "outgoing", "count"):
                with self.subTest(language=language, focus=focus):
                    result = present_answer(self.answer, OutputOptions(language, focus))
                    for field in fields(self.answer):
                        if field.name not in ("answer_text", "limitations"):
                            self.assertEqual(getattr(result, field.name), getattr(self.answer, field.name))
                    self.assertIs(result.totals, self.answer.totals)
                    self.assertIs(result.evidence_refs, self.answer.evidence_refs)
                    self.assertIs(result.source_refs, self.answer.source_refs)

    def test_direction_focus_changes_narrative_without_discarding_other_totals(self):
        for focus, included, excluded in (("incoming", "4.000000", "0.750000"),
                                          ("outgoing", "0.750000", "4.000000")):
            for language in ("en", "ko"):
                with self.subTest(focus=focus, language=language):
                    result = present_answer(self.answer, OutputOptions(language, focus))
                    self.assertIn(included, result.answer_text)
                    self.assertNotIn(excluded, result.answer_text)
                    self.assertNotIn("0.100000", result.answer_text)
                    self.assertEqual(result.totals, self.answer.totals)

    def test_count_focus_counts_self_transfers_once_and_does_not_summarize_amounts(self):
        for language, expected in (("en", ("Incoming: 3 transfers.", "Outgoing: 1 transfer.",
                                           "Self transfer: 1 transfer.")),
                                   ("ko", ("입금: 3건.", "출금: 1건.", "동일 지갑 내 전송: 1건."))):
            result = present_answer(self.answer, OutputOptions(language, "count"))
            for text in expected:
                self.assertIn(text, result.answer_text)
            for total in self.answer.totals:
                self.assertNotIn(total.amount_display, result.answer_text)
            self.assertEqual(result.transfer_count, 5)

    def test_large_amount_strings_remain_exact_in_both_languages(self):
        amount = "1999999999999999999999999999999999999999999999999999999999999.999999999999999998"
        total = replace(self.answer.totals[0], amount_display=amount, amount_base_units=amount.replace(".", ""))
        answer = replace(self.answer, totals=(total,))
        for language in ("en", "ko"):
            result = present_answer(answer, OutputOptions(language))
            self.assertIn(amount, result.answer_text)
            self.assertEqual(result.totals[0].amount_base_units, total.amount_base_units)

    def test_empty_partial_never_establishes_no_activity_in_either_language_or_focus(self):
        answer = demo_answer("empty-partial")
        for language, warning in (("en", "incomplete coverage cannot establish no activity"),
                                  ("ko", "활동이 없었다고 판단할 수 없습니다")):
            for focus in ("summary", "incoming", "outgoing", "count"):
                with self.subTest(language=language, focus=focus):
                    result = present_answer(answer, OutputOptions(language, focus))
                    self.assertIn(warning, result.answer_text)
                    self.assertFalse(result.complete)
                    self.assertEqual(result.transfer_count, 0)

    def test_zero_matching_direction_is_limited_to_returned_report(self):
        answer = replace(self.answer, complete=False,
                         totals=tuple(t for t in self.answer.totals if t.direction != "out"))
        result = present_answer(answer, OutputOptions("ko", "outgoing"))
        self.assertIn("반환된 보고서에 출금 내역이 없습니다", result.answer_text)
        self.assertIn("일부 범위만 조회", result.answer_text)
        self.assertNotIn("출금이 없었습니다", result.answer_text)

    def test_only_recognized_fixed_limitations_are_translated(self):
        answer = demo_answer("partial")
        unknown = "Keep source wording: <untrusted> `label`"
        answer = replace(answer, limitations=(*answer.limitations, unknown))
        ko = present_answer(answer, OutputOptions("ko"))
        self.assertIn("페이지 조회가 완료되지 않아 추가 내역이 있을 수 있습니다.", ko.limitations)
        self.assertEqual(ko.limitations[-1], unknown)
        self.assertEqual(present_answer(ko, OutputOptions("en")).limitations, answer.limitations)

    def test_requested_result_precedes_purpose_and_technical_metadata_stays_in_fields(self):
        for language, label in (("ko", "반환된 입금: 3건."), ("en", "Returned incoming transfers: 3.")):
            purpose = "Please show incoming transfers only"
            result = present_answer(self.answer, OutputOptions(language, "incoming"), purpose=purpose)
            self.assertLess(result.answer_text.index(label), result.answer_text.index(purpose))
            self.assertLess(result.answer_text.index("4.000000"), result.answer_text.index(purpose))
            for value in (self.answer.wallet, self.answer.window_start, self.answer.window_end):
                self.assertNotIn(value, result.answer_text)
            self.assertEqual(result.wallet, self.answer.wallet)
            self.assertEqual(result.window_start, self.answer.window_start)
            self.assertEqual(result.window_end, self.answer.window_end)

    def test_synthetic_and_partial_warnings_still_precede_requested_result(self):
        answer = demo_answer("partial")
        for language, warning, count in (("ko", "일부 범위만 조회", "반환된 전송: 5건"),
                                         ("en", "Partial coverage", "Returned transfers: 5")):
            result = present_answer(answer, OutputOptions(language))
            self.assertLess(result.answer_text.index(warning), result.answer_text.index(count))
            self.assertTrue(result.answer_text.startswith("합성 데이터" if language == "ko" else "Synthetic"))

    def test_balance_and_profit_requests_keep_the_transfer_report_boundary(self):
        for purpose, disclaimer in (("잔액과 수익을 알려줘", "지갑 잔액이나 수익을 나타내지 않습니다"),
                                     ("Calculate my balance and profit", "not wallet balances or profit")):
            result = present_answer(self.answer, infer_output_options(purpose), purpose=purpose)
            self.assertIn(disclaimer, result.answer_text)
            self.assertEqual(result.totals, self.answer.totals)
            self.assertNotIn("balance:", result.answer_text.lower())
            self.assertNotIn("profit:", result.answer_text.lower())

    def test_invalid_options_or_raw_reports_cannot_be_presented(self):
        for values in (("fr", "summary"), ("en", "balance"), ("ko\" onload=\"x", "summary")):
            with self.assertRaises(ValueError):
                OutputOptions(*values)
        with self.assertRaises(TypeError):
            present_answer({"wallet": "raw"}, OutputOptions())


if __name__ == "__main__":
    unittest.main()
