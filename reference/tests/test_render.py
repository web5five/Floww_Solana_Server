import contextlib
import io
import json
import tempfile
import unicodedata
import unittest
from dataclasses import replace
from datetime import timedelta
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import Mock, patch

from ai_baseline import fixtures
from ai_baseline.analytics import consume_analytics
from ai_baseline.analytics_demo import FIXTURE, request
from ai_baseline.render import render_html, render_markdown
from ai_baseline.report_demo import demo_answer, main
from ai_baseline.workflow import ProtectedResource, Result


class ParsedHtml(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.attributes = []
        self.text = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attributes.extend(attrs)

    def handle_data(self, data):
        self.text.append(data)


class ReportOutputTests(unittest.TestCase):
    def setUp(self):
        self.answer = demo_answer()

    def test_complete_report_preserves_scope_times_networks_and_generator(self):
        for render in (render_markdown, render_html):
            with self.subTest(format=render.__name__):
                output = render(self.answer)
                for value in (self.answer.wallet, self.answer.data_network, self.answer.payment_network,
                              self.answer.window_start, self.answer.window_end, self.answer.data_as_of,
                              self.answer.generated_at, self.answer.generator_version):
                    self.assertIn(value, output)
                self.assertIn("end (exclusive)", output)
                self.assertIn("backend observation", output)
                self.assertIn("Synthetic data", output)
                self.assertIn("Complete within the supplied report", output)

    def test_amounts_keep_separate_asset_direction_and_integer_base_units(self):
        for render in (render_markdown, render_html):
            output = render(self.answer)
            for total in self.answer.totals:
                for value in (total.asset_ref, total.direction, total.amount_base_units, total.amount_display):
                    self.assertIn(value, output)
            self.assertIn("4.000000", output)
            self.assertIn("0.750000", output)
            self.assertIn("0.100000", output)
            self.assertIn("1.000000001", output)
            self.assertIn("No cross-asset total", output)

    def test_large_validated_integer_totals_keep_every_digit(self):
        from ai_baseline.analytics import AnalyticsProposal
        proposal = fixtures.proposal("solana_analytics")
        proposal = AnalyticsProposal(proposal.proposal_ref, proposal.context, proposal.candidate,
                                     proposal.explanation, request())
        body = json.loads(FIXTURE.read_text(encoding="utf-8"))
        body["transfers"] = body["transfers"][:2]
        for row in body["transfers"]:
            row.update(amount_base_units="9" * 78, decimals=18)
        result = consume_analytics(
            proposal, fixtures.outcome(proposal), request(),
            lambda _: ProtectedResource("fixture-delivery", "application/json", json.dumps(body)),
            lambda: proposal.context, max_report_age=timedelta(hours=2), clock=lambda: fixtures.NOW,
        )
        self.assertEqual(result.code, "ANALYTICS_SUMMARY")
        total = result.answer.totals[0]
        self.assertEqual(total.amount_base_units, str(2 * (10 ** 78 - 1)))
        for render in (render_markdown, render_html):
            output = render(result.answer)
            self.assertIn(total.amount_base_units, output)
            self.assertIn(total.amount_display, output)

    def test_each_total_and_full_report_keep_all_evidence_and_source_refs(self):
        for render in (render_markdown, render_html):
            output = render(self.answer)
            for ref in (*self.answer.source_refs, *self.answer.evidence_refs):
                self.assertIn(ref, output)
            for total in self.answer.totals:
                for ref in total.evidence_refs:
                    self.assertGreaterEqual(output.count(ref), 2)

    def test_partial_coverage_is_visible_before_summary(self):
        answer = demo_answer("partial")
        for render in (render_markdown, render_html):
            output = render(answer)
            self.assertLess(output.index("Partial coverage"), output.index("Summary"))
            self.assertIn("Pagination is incomplete", output)

    def test_empty_partial_cannot_be_presented_as_no_activity(self):
        answer = replace(demo_answer("empty-partial"), answer_text="No transfers.", limitations=())
        for render in (render_markdown, render_html):
            output = render(answer)
            self.assertIn("incomplete coverage cannot establish no activity", output)
            self.assertIn("No asset totals were returned", output)
            self.assertIn("Partial coverage", output)

    def test_empty_complete_is_limited_to_the_returned_report(self):
        answer = replace(self.answer, transfer_count=0, totals=(), answer_text="No transfers.")
        for render in (render_markdown, render_html):
            self.assertIn("No transfers in the returned report", render(answer))

    def test_non_synthetic_flag_does_not_claim_live_verification(self):
        answer = replace(self.answer, is_synthetic=False)
        for render in (render_markdown, render_html):
            output = render(answer)
            self.assertIn("marked non-synthetic by the supplied answer", output)
            self.assertNotIn("Live verified", output)
            self.assertIn("does not independently verify payment settlement", output)

    def test_synthetic_data_does_not_label_accepted_backend_observation_offline(self):
        from ai_baseline.analytics import AnalyticsProposal
        proposal = fixtures.proposal("solana_analytics")
        proposal = AnalyticsProposal(proposal.proposal_ref, proposal.context, proposal.candidate,
                                     proposal.explanation, request())
        body = FIXTURE.read_text(encoding="utf-8")
        accepted = replace(fixtures.outcome(proposal), evidence_kind="backend_verified")
        result = consume_analytics(
            proposal, accepted, request(),
            lambda _: ProtectedResource("fixture-delivery", "application/json", body),
            lambda: proposal.context, max_report_age=timedelta(hours=2), clock=lambda: fixtures.NOW,
        )
        self.assertEqual(result.code, "ANALYTICS_SUMMARY")
        self.assertEqual(result.evidence_kind, "backend_verified")
        self.assertTrue(result.answer.is_synthetic)
        for render in (render_markdown, render_html):
            output = render(result.answer)
            self.assertIn("Synthetic data.", output)
            self.assertNotIn("offline", output.lower())
            self.assertNotIn("scripted", output.lower())

    def test_html_hostile_strings_remain_text_in_every_dynamic_section(self):
        hostile = '<script>alert("x")</script><img src=x onerror=alert(1)> & [x](javascript:alert(1))'
        total = replace(self.answer.totals[0], asset_ref=hostile, direction=hostile,
                        amount_display=hostile, amount_base_units=hostile, evidence_refs=(hostile,))
        answer = replace(self.answer, answer_text=hostile, wallet=hostile, data_network=hostile,
                         payment_network=hostile, window_start=hostile, window_end=hostile,
                         data_as_of=hostile, generated_at=hostile, generator_version=hostile,
                         totals=(total,), source_refs=(hostile,), evidence_refs=(hostile,),
                         limitations=(hostile,))
        output = render_html(answer)
        parsed = ParsedHtml(output)
        self.assertNotIn("script", parsed.tags)
        self.assertNotIn("img", parsed.tags)
        self.assertNotIn("a", parsed.tags)
        self.assertNotIn(hostile, output)
        self.assertIn(hostile, "".join(parsed.text))
        self.assertTrue(all(name not in {"href", "src", "onerror"} for name, _ in parsed.attributes))

    def test_markdown_hostile_markup_and_fences_are_inert_code(self):
        hostile = '[click](javascript:alert(1)) <img src=x onerror=alert(1)> `x` | *bold*'
        answer = replace(self.answer, wallet=hostile, source_refs=("https://example.invalid/payload",),
                         answer_text="```\n# Injected heading\n```\n" + hostile)
        output = render_markdown(answer)
        # The whole label is inside a longer code span, and the summary uses a
        # fence longer than any sequence supplied by the purported report.
        self.assertIn("- Wallet: `` " + hostile + " ``", output)
        self.assertIn("- ` https://example.invalid/payload `", output)
        self.assertIn("````text\n" + answer.answer_text + "\n````", output)

    def test_html_is_standalone_with_no_active_or_external_resources(self):
        output = render_html(self.answer)
        parsed = ParsedHtml(output)
        self.assertTrue(output.startswith("<!doctype html>"))
        self.assertTrue(output.endswith("</html>\n"))
        self.assertIn("default-src 'none'", output)
        self.assertIn("viewport", output)
        self.assertTrue({"script", "a", "iframe", "img", "link", "form"}.isdisjoint(parsed.tags))
        self.assertTrue(all(name not in {"href", "src"} for name, _ in parsed.attributes))

    def test_same_answer_renders_identically(self):
        for render in (render_markdown, render_html):
            self.assertEqual(render(self.answer), render(self.answer))

    def test_raw_reports_failure_results_and_missing_answers_are_rejected(self):
        for value in ({"wallet": "raw"}, Result("STOPPED", "POLICY_DENIED"), None, "raw body"):
            for render in (render_markdown, render_html):
                with self.subTest(value=value, render=render.__name__):
                    with self.assertRaises(TypeError):
                        render(value)

    def test_demo_cannot_render_denied_unknown_or_undelivered_content(self):
        outcome = fixtures.outcome
        for change, expected in (({"policy": "DENY"}, "POLICY_DENIED"),
                                 ({"payment": "UNKNOWN"}, "PAYMENT_RECONCILIATION_REQUIRED"),
                                 ({"fulfillment": "FAILED"}, "PAID_RESOURCE_UNDELIVERED")):
            with self.subTest(change=change):
                fixture = Mock()
                fixture.read_text.side_effect = AssertionError("Body must not be read")
                with patch("ai_baseline.report_demo.fixtures.outcome",
                           side_effect=lambda p: replace(outcome(p), **change)), \
                        patch("ai_baseline.report_demo.FIXTURE", fixture):
                    with self.assertRaisesRegex(RuntimeError, expected):
                        demo_answer()
                fixture.read_text.assert_not_called()

    def test_demo_stdout_is_the_requested_document_only(self):
        for format_name, prefix in (("markdown", "# Wallet transfer report"), ("html", "<!doctype html>")):
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                self.assertEqual(main(["--format", format_name]), 0)
            self.assertTrue(stdout.getvalue().startswith(prefix))
            self.assertIn("Synthetic data", stdout.getvalue())
            self.assertIn("payment/delivery observations are scripted synthetic fixtures", stdout.getvalue())

    def test_demo_normalizes_new_korean_filename_and_reads_it_back(self):
        with tempfile.TemporaryDirectory() as directory:
            name = unicodedata.normalize("NFD", "지갑_분석_예시.html")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--format", "html", "--output", str(Path(directory) / name)]), 0)
            actual = list(Path(directory).iterdir())
            self.assertEqual([p.name for p in actual], ["지갑_분석_예시.html"])
            self.assertTrue(unicodedata.is_normalized("NFC", actual[0].name))
            self.assertEqual(actual[0].read_text(encoding="utf-8"), render_html(self.answer))

    def test_demo_refuses_to_overwrite_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "existing.md"
            path.write_text("keep original", encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    main(["--output", str(path)])
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(path.read_text(encoding="utf-8"), "keep original")

    def test_new_output_does_not_inspect_unrelated_dangling_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            link = parent / "unrelated-link"
            link.symlink_to(parent / "missing")
            path = parent / "new.md"
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--output", str(path)]), 0)
            self.assertTrue(link.is_symlink())
            self.assertEqual(path.read_text(encoding="utf-8"), render_markdown(self.answer))


if __name__ == "__main__":
    unittest.main()
