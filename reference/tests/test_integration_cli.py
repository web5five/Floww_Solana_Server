import copy
import json
import unittest
from datetime import datetime, timedelta, timezone

from ai_baseline.integration_cli import handle
from ai_baseline.render import render_html, render_markdown
from ai_baseline.analytics import AnalyticsAnswer, AssetTotal


class IntegrationCliTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
        self.clock = lambda: self.now
        iso = lambda value: value.isoformat()
        self.payload = {
            "context": {"owner_ref": "owner-1", "task_ref": "task-1", "task_version": "1",
                "mandate_ref": "mandate-1", "mandate_version": "1", "purpose": "Wallet transfer report",
                "valid_until": iso(self.now + timedelta(minutes=5))},
            "candidate": {"candidate_id": "report-1", "merchant_ref": "merchant-1", "resource_ref": "resource-1",
                "requirements_ref": "quote-1", "amount_atomic": "1000", "asset_ref": "asset-1",
                "network_ref": "solana:devnet", "recipient_ref": "payee-1", "description": "Wallet transfer report",
                "valid_until": iso(self.now + timedelta(minutes=5))},
            "request": {"task_ref": "task-1", "task_version": "1", "resource_ref": "resource-1",
                "wallet": "wallet-1", "data_network": "solana:devnet",
                "window_start": iso(self.now - timedelta(hours=1)), "window_end": iso(self.now - timedelta(minutes=1))},
        }

    def consumed(self):
        raw = copy.deepcopy(self.payload)
        proposed = handle("propose", raw, clock=self.clock)
        raw.update(proposalRef=proposed["proposal_ref"], attemptRef="attempt-1", settlementRef="settlement-1",
            deliveryRef="delivery-1", policy="ALLOW", payment="CONFIRMED", fulfillment="COMPLETED")
        raw["body"] = json.dumps({"schema_version": "analytics-reference/v1", "resource_ref": "resource-1",
            "wallet": "wallet-1", "data_network": "solana:devnet", "window_start": raw["request"]["window_start"],
            "window_end": raw["request"]["window_end"], "generated_at": self.now.isoformat(),
            "data_as_of": raw["request"]["window_end"], "coverage": {"complete": False, "pagination_complete": True},
            "is_synthetic": False, "source_refs": ["solana:devnet:rpc"], "transfers": []})
        return raw

    def test_explicit_selection_generates_proposal_without_model(self):
        result = handle("propose", self.payload, clock=self.clock)
        self.assertEqual(result["status"], "PROPOSED")
        self.assertEqual(result["execution_kind"], "explicit_resource_selection")
        self.assertIn("explicitly selected", result["explanation"])

    def test_changed_context_prevents_proposal(self):
        self.payload["currentContext"] = {**self.payload["context"], "task_version": "2"}
        self.assertEqual(handle("propose", self.payload, clock=self.clock)["code"], "STALE_CONTEXT_OR_QUOTE")

    def test_scope_mismatch_prevents_proposal(self):
        self.payload["request"]["resource_ref"] = "different-resource"
        self.assertNotEqual(handle("propose", self.payload, clock=self.clock)["status"], "PROPOSED")

    def test_consumption_renders_existing_validated_answer(self):
        result = handle("consume", self.consumed(), clock=self.clock)
        self.assertEqual(result["status"], "EVIDENCE_READY")
        self.assertFalse(result["answer"]["complete"])
        self.assertFalse(result["answer"]["is_synthetic"])
        self.assertIn("Partial coverage", result["markdown"])
        self.assertIn("<!doctype html>", result["html"])

    def test_korean_request_uses_one_presented_answer_in_json_html_and_markdown(self):
        self.payload["context"]["purpose"] = "최근 전송 건수만 알려줘"
        result = handle("consume", self.consumed(), clock=self.clock)
        self.assertEqual(result["status"], "EVIDENCE_READY")
        self.assertIn("입금: 0건", result["answer"]["answer_text"])
        self.assertIn("활동이 없었다고 판단할 수 없습니다", result["answer"]["answer_text"])
        self.assertIn('<html lang="ko">', result["html"])
        self.assertIn("# 지갑 전송 보고서", result["markdown"])
        answer = AnalyticsAnswer(**{**result["answer"], "totals": tuple(
            AssetTotal(**total) for total in result["answer"]["totals"])})
        self.assertEqual(result["html"], render_html(answer, language="ko"))
        self.assertEqual(result["markdown"], render_markdown(answer, language="ko"))

    def test_explicit_english_on_korean_request_does_not_change_scope_or_evidence(self):
        self.payload["context"]["purpose"] = "지갑 전송을 영어로 요약해줘"
        raw = self.consumed()
        result = handle("consume", raw, clock=self.clock)
        self.assertIn("Returned transfers: 0", result["answer"]["answer_text"])
        self.assertIn('<html lang="en">', result["html"])
        self.assertEqual(result["answer"]["evidence_refs"], ("delivery-1",))
        self.assertEqual(result["answer"]["source_refs"], ("solana:devnet:rpc",))
        self.assertEqual(result["answer"]["window_start"], raw["request"]["window_start"])
        self.assertEqual(result["answer"]["window_end"], raw["request"]["window_end"])

    def test_purpose_with_markup_is_inert_after_consumption(self):
        purpose = '한국어로 요약\n```\n# heading\n```\n<script>alert("x")</script> [x](javascript:x)'
        self.payload["context"]["purpose"] = purpose
        result = handle("consume", self.consumed(), clock=self.clock)
        self.assertEqual(result["status"], "EVIDENCE_READY")
        self.assertIn(purpose, result["answer"]["answer_text"])
        self.assertNotIn("<script>", result["html"])
        self.assertIn("&lt;script&gt;", result["html"])
        self.assertIn("````text\n" + result["answer"]["answer_text"] + "\n````", result["markdown"])

    def test_korean_request_cannot_bypass_invalid_report_or_payment_gate(self):
        self.payload["context"]["purpose"] = "입금만 한국어로 보여줘"
        raw = self.consumed()
        raw.update(payment="UNKNOWN", body="unparseable")
        result = handle("consume", raw, clock=self.clock)
        self.assertEqual(result["code"], "PAYMENT_RECONCILIATION_REQUIRED")
        self.assertNotIn("answer", result)
        self.assertNotIn("html", result)

    def test_authority_states_default_closed(self):
        for field in ("policy", "payment", "fulfillment"):
            raw = self.consumed()
            del raw[field]
            result = handle("consume", raw, clock=self.clock)
            self.assertNotEqual(result["status"], "EVIDENCE_READY")
            self.assertNotIn("answer", result)

    def test_unknown_payment_does_not_read_report(self):
        raw = self.consumed()
        raw.update(payment="UNKNOWN", body="unparseable report")
        self.assertEqual(handle("consume", raw, clock=self.clock)["code"], "PAYMENT_RECONCILIATION_REQUIRED")

    def test_paid_resource_failure_does_not_generate_answer(self):
        raw = self.consumed()
        raw.update(fulfillment="FAILED", body="unparseable report")
        self.assertEqual(handle("consume", raw, clock=self.clock)["code"], "PAID_RESOURCE_UNDELIVERED")

    def test_invalid_identifiers_and_extra_context_fields_are_rejected(self):
        malformed = copy.deepcopy(self.payload)
        malformed["context"]["extra"] = "SECRET"
        with self.assertRaises(ValueError):
            handle("propose", malformed, clock=self.clock)
        raw = self.consumed()
        raw["proposalRef"] = None
        with self.assertRaises(ValueError):
            handle("consume", raw, clock=self.clock)

    def test_freshness_policy_remains_bounded(self):
        raw = self.consumed()
        raw["maxReportAgeSeconds"] = 3_601
        with self.assertRaises(ValueError):
            handle("consume", raw, clock=self.clock)


if __name__ == "__main__":
    unittest.main()
