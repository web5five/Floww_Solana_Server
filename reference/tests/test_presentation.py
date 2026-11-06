import unittest
from dataclasses import fields, replace

from ai_baseline.presentation import OutputOptions, infer_output_options, present_answer
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
