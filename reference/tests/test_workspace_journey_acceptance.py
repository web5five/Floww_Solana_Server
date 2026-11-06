"""Paired synthetic acceptance contracts; no model, payment or delivery occurred."""

import copy
import json
import unittest
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from ai_baseline.analytics import AnalyticsRequest, InvalidReport, parse_report, summarize
from ai_baseline.integration_cli import handle as integration
from ai_baseline.presentation import infer_output_options, present_answer
from ai_baseline.render import render_html, render_markdown
from ai_baseline.workflow import BackendOutcome, Context, ProtectedResource
from ai_baseline.workspace_cli import context_digest, handle, normalize

SUITE = json.loads((Path(__file__).parents[1] / "evaluations" / "workspace-journey-v1.json").read_text())
NOW = datetime.fromisoformat(SUITE["fixed_now"])
MODEL = "scripted-acceptance-contract"
RESOURCE = "wallet-transfers"


class ScriptedRoles:
    """Only supplied role responses; expectations never enter the adapter input."""

    def __init__(self, *responses):
        self.responses, self.roles = list(responses), []

    def role(self, role, data, schema):
        self.roles.append(role)
        response = copy.deepcopy(self.responses.pop(0))
        response.setdefault("contextDigest", data["contextDigest"])
        return response


def data_for(case):
    return {
        "messages": [{"id": "first-user-turn", "role": "user", "text": case["turns"][0]["text"]}],
        "intent": {**SUITE["initial_scope"], "purpose": case["purpose"], "missingFields": []},
        "memories": [],
        "catalog": [{"id": RESOURCE, "capability": RESOURCE, "name": "Wallet transfers",
                     "description": "Only bounded returned transfer observations."}],
        "nowIso": SUITE["fixed_now"],
    }


def refined(intent, status="READY_TO_PLAN"):
    return {"status": status, "assistantText": "Scripted acceptance response.", "intent": {key: value for key, value in intent.items() if key != "missingFields"}}


def proposal():
    return {"summary": "Scripted bounded transfer proposal.",
            "steps": [{"role": "planner", "capability": RESOURCE, "resourceId": RESOURCE,
                       "reason": "The explicit wallet and observation period match this report."}],
            "limitations": ["Only returned transfer observations are covered."]}


def critic(verdict="ACCEPT"):
    return {"verdict": verdict, "reason": "Scripted acceptance review.",
            "issueCodes": [] if verdict == "ACCEPT" else ["PURPOSE_MISMATCH"]}


def run(operation, data, roles):
    return handle(operation, data, model=roles, model_version=MODEL)


class WorkspaceJourneyAcceptanceTests(unittest.TestCase):
    def test_contract_cases_are_bounded_paired_and_explicit_about_evidence(self):
        self.assertEqual(SUITE["version"], "workspace-journey/v1")
        self.assertEqual(SUITE["split"], "contract_acceptance")
        self.assertTrue(SUITE["synthetic"])
        self.assertEqual(SUITE["model_execution"], "scripted_roles")
        self.assertEqual(SUITE["financial_transport"], "inert_not_executed")
        self.assertFalse(SUITE["model_quality_evaluated"])
        self.assertEqual(len(SUITE["cases"]), 4)
        for family in ("correction_grounding", "purpose_refusal"):
            cases = [case for case in SUITE["cases"] if case["family"] == family]
            self.assertEqual({case["language"] for case in cases}, {"ko", "en"})
            self.assertTrue(all(len(case["turns"]) <= 3 for case in cases))
        self.assertEqual(len({case["id"] for case in SUITE["cases"]}), 4)

    def test_correction_invalidates_old_plan_then_exact_scope_reaches_grounded_export(self):
        for case in SUITE["cases"]:
            if case["family"] != "correction_grounding":
                continue
            with self.subTest(case=case["id"]):
                data = data_for(case)
                old_plan = {**proposal(), "contextDigest": context_digest(normalize(data))}
                initial = ScriptedRoles(refined(copy.deepcopy(data["intent"])))
                self.assertEqual(run("refine", data, initial)["status"], "READY_TO_PLAN")
                baseline_review = ScriptedRoles(old_plan, critic())
                self.assertEqual(run("plan", data, baseline_review)["status"], "PROPOSED")
                self.assertEqual(baseline_review.roles, ["plan", "critic"])
                data["messages"].append({"id": "scope-correction", "role": "user",
                                         "text": case["turns"][1]["text"]})
                corrected = {**data["intent"], **SUITE["corrected_scope"]}
                stale_scope = run("refine", data, ScriptedRoles(refined(data["intent"])))
                self.assertEqual(stale_scope["status"], "STOPPED")
                result = run("refine", data, ScriptedRoles(refined(corrected)))
                self.assertEqual(result["status"], "READY_TO_PLAN")
                self.assertEqual({key: value for key, value in result["intent"].items() if key != "purpose"},
                                 {key: value for key, value in corrected.items() if key != "purpose"})
                self.assertTrue(result["intent"]["purpose"].startswith(corrected["purpose"] + "\n"))
                self.assertEqual(infer_output_options(result["intent"]["purpose"]), infer_output_options(corrected["purpose"]))
                data["intent"] = result["intent"]
                rejected = ScriptedRoles(old_plan)
                self.assertEqual(run("plan", data, rejected)["code"], "WORKSPACE_STALE_CONTEXT")
                self.assertEqual(rejected.roles, ["plan"])
                data["messages"].append({"id": "style-only", "role": "user",
                                         "text": case["turns"][2]["text"]})
                kept = run("refine", data, ScriptedRoles(refined(corrected)))
                self.assertEqual(kept["intent"], result["intent"])
                reviewed = ScriptedRoles(proposal(), critic())
                self.assertEqual(run("plan", data, reviewed)["status"], "PROPOSED")
                self.assertEqual(reviewed.roles, ["plan", "critic"])
                self.assertEqual(normalize(data)["explicitScopeAnchors"], {
                    key: SUITE["corrected_scope"][key]
                    for key in ("wallet", "windowStart", "windowEnd")})
                self.assert_grounding_without_payment(case, corrected)

    def assert_grounding_without_payment(self, case, intent):
        start = datetime.fromisoformat(intent["windowStart"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(intent["windowEnd"].replace("Z", "+00:00"))
        request = AnalyticsRequest("synthetic-task", "1", "synthetic-report", intent["wallet"],
                                   "synthetic-data-network", start, end)
        fact = SUITE["grounding"]
        body = {
            "schema_version": "analytics-reference/v1", "resource_ref": request.resource_ref,
            "wallet": request.wallet, "data_network": request.data_network,
            "window_start": start.isoformat(), "window_end": end.isoformat(),
            "generated_at": NOW.isoformat(), "data_as_of": end.isoformat(),
            "coverage": {"complete": False, "pagination_complete": False},
            "is_synthetic": True, "source_refs": [fact["source_ref"]],
            "transfers": [{
                "record_id": fact["record_id"], "source_ref": fact["source_ref"],
                "transaction_ref": "synthetic-transfer-record", "event_index": 0,
                "timestamp": (start + timedelta(hours=1)).isoformat(),
                "asset_ref": fact["asset_ref"], "decimals": fact["decimals"],
                "amount_base_units": fact["amount_base_units"], "from_wallet": request.wallet,
                "to_wallet": SUITE["initial_scope"]["wallet"],
            }],
        }
        resource = ProtectedResource("synthetic-document", "application/json", json.dumps(body))
        report = parse_report(resource, request, NOW, timedelta(minutes=5))
        # Presentation of a synthetic fixture does not assert authorization or delivery.
        context = Context("synthetic-owner", request.task_ref, "1", "synthetic-mandate", "1",
                          case["purpose"], NOW + timedelta(minutes=5))
        unpaid = BackendOutcome("synthetic-proposal", context, "synthetic-quote", "synthetic-attempt",
                                "PENDING", "NOT_ATTEMPTED", "PENDING", evidence_kind="synthetic_fixture")
        answer = summarize(report, resource.delivery_ref, unpaid, "not-executed")
        options = infer_output_options(case["purpose"])
        self.assertEqual(options.language, case["language"])
        shown = present_answer(answer, options, purpose=case["purpose"])
        for name, value in asdict(answer).items():
            if name not in {"answer_text", "limitations"}:
                self.assertEqual(asdict(shown)[name], value)
        self.assertEqual(shown.wallet, intent["wallet"])
        self.assertEqual((shown.window_start, shown.window_end), (start.isoformat(), end.isoformat()))
        self.assertEqual(shown.totals[0].amount_base_units, fact["amount_base_units"])
        self.assertEqual(shown.totals[0].amount_display, fact["amount_display"])
        self.assertEqual(shown.totals[0].evidence_refs, ("synthetic-document#transfer-outgoing-1",))
        self.assertEqual(shown.source_refs, (fact["source_ref"],))
        self.assertTrue(shown.is_synthetic)
        self.assertFalse(shown.complete)
        self.assertIn(fact["amount_display"], shown.answer_text)
        html, markdown = render_html(shown, language=case["language"]), render_markdown(shown, language=case["language"])
        self.assertIn('<html lang="' + case["language"] + '">', html)
        self.assertIn(fact["amount_display"], html)
        self.assertIn(fact["amount_display"], markdown)
        self.assertIn("일부" if case["language"] == "ko" else "Partial", markdown)
        self.assertIn("출금" if case["language"] == "ko" else "outgoing", shown.answer_text.lower())
        wrong = copy.deepcopy(body)
        wrong["wallet"] = SUITE["initial_scope"]["wallet"]
        with self.assertRaises(InvalidReport):
            parse_report(ProtectedResource("synthetic-document", "application/json", json.dumps(wrong)),
                         request, NOW, timedelta(minutes=5))
        expires = (NOW + timedelta(minutes=5)).isoformat()
        payload = {
            "context": {"owner_ref": "synthetic-owner", "task_ref": request.task_ref,
                        "task_version": "1", "mandate_ref": "synthetic-mandate",
                        "mandate_version": "1", "purpose": case["purpose"], "valid_until": expires},
            "candidate": {"candidate_id": "synthetic-candidate", "merchant_ref": "synthetic-merchant",
                          "resource_ref": request.resource_ref, "requirements_ref": "synthetic-quote",
                          "amount_atomic": "1000", "asset_ref": "synthetic-asset",
                          "network_ref": "not-executed", "recipient_ref": "synthetic-recipient",
                          "description": "Synthetic bounded report.", "valid_until": expires},
            "request": {"task_ref": request.task_ref, "task_version": "1", "resource_ref": request.resource_ref,
                        "wallet": request.wallet, "data_network": request.data_network,
                        "window_start": start.isoformat(), "window_end": end.isoformat()},
            "body": resource.body, "proposalRef": "synthetic-proposal", "attemptRef": "synthetic-attempt",
            "policy": "PENDING", "payment": "NOT_ATTEMPTED", "fulfillment": "PENDING",
        }
        with patch.dict("os.environ", {}, clear=True):
            blocked = integration("consume", payload, clock=lambda: NOW)
        self.assertNotEqual(blocked["status"], "EVIDENCE_READY")
        self.assertTrue({"answer", "html", "markdown"}.isdisjoint(blocked))

    def test_unsupported_purpose_and_critic_or_authority_refusal_never_become_a_plan(self):
        for case in SUITE["cases"]:
            if case["family"] != "purpose_refusal":
                continue
            with self.subTest(case=case["id"]):
                data = data_for(case)
                data["intent"]["purpose"] = case["turns"][0]["text"]
                unsupported = ScriptedRoles(refined(data["intent"], "UNSUPPORTED"))
                self.assertEqual(run("refine", data, unsupported)["status"], "UNSUPPORTED")
                self.assertEqual(unsupported.roles, ["refine"])
                data["messages"].append({"id": "supported-replacement", "role": "user",
                                         "text": case["turns"][1]["text"]})
                supported = {**data["intent"], "purpose": case["purpose"]}
                accepted = run("refine", data, ScriptedRoles(refined(supported)))
                self.assertEqual(accepted["status"], "READY_TO_PLAN")
                data["intent"] = accepted["intent"]
                data["messages"].append({"id": "untrusted-instruction", "role": "user",
                                         "text": case["turns"][2]["text"]})
                refused = ScriptedRoles(proposal(), critic("REJECT"))
                self.assertEqual(run("plan", data, refused)["code"], "WORKSPACE_PLAN_REJECTED")
                self.assertEqual(refused.roles, ["plan", "critic"])
                injected = ScriptedRoles({**proposal(), "execute_payment": True})
                stopped = run("plan", data, injected)
                self.assertEqual(stopped["status"], "STOPPED")
                self.assertEqual(injected.roles, ["plan"])
                self.assertTrue({"answer", "proposal_ref"}.isdisjoint(stopped))
