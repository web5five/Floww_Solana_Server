"""Opt-in OpenAI Responses adapter for the existing, authority-free model ports.

Construction never reads credentials or sends a request. The official HTTPS
endpoint is fixed; HTTP is available only through the explicit loopback-test
constructor. Socket timeouts are inactivity limits, not a total deadline.
"""

from __future__ import annotations

import http.client
import json
import math
import re
import ssl

from .workflow import (
    MAX_CANDIDATES, MAX_MODEL_BYTES, MAX_RECORDS, RESULT_INSTRUCTION,
    SELECTION_INSTRUCTION, Candidate, Record,
)


_ERROR_CODES = frozenset({
    "INVALID_CONFIG", "INVALID_MODEL_INPUT", "REQUEST_TOO_LARGE",
    "NETWORK_TIMEOUT", "NETWORK_ERROR", "HTTP_REDIRECT", "HTTP_ERROR",
    "RESPONSE_TOO_LARGE", "INVALID_RESPONSE", "MODEL_REFUSAL",
    "MODEL_INCOMPLETE", "MODEL_ERROR",
})


class ModelAPIError(RuntimeError):
    """A fixed diagnostic code; no upstream body, URL, key or exception chain."""

    def __init__(self, code: str):
        self.code = code if code in _ERROR_CODES else "INVALID_RESPONSE"
        super().__init__(self.code)


def _text(value: object, limit: int) -> bool:
    if type(value) is not str or not 0 < len(value) <= limit or not value.strip():
        return False
    valid = True
    try:
        value.encode("utf-8")
    except UnicodeError:
        valid = False
    return valid and all(ord(c) >= 32 or c in "\n\t" for c in value)


def _ref(value: object) -> bool:
    return type(value) is str and re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", value) is not None


def _object(properties: dict) -> dict:
    return {"type": "object", "properties": properties,
            "required": list(properties), "additionalProperties": False}


def _selection_schema(ids: list[str]) -> dict:
    # Structured Outputs requires an object root; the union is a child field.
    return _object({"decision": {"anyOf": [
        _object({"action": {"type": "string", "enum": ["PROPOSE"]},
                 "candidate_id": {"type": "string", "enum": ids},
                 "reason": {"type": "string"}}),
        _object({"action": {"type": "string", "enum": ["CLARIFY"]},
                 "question": {"type": "string"}}),
        _object({"action": {"type": "string", "enum": ["STOP"]},
                 "reason": {"type": "string"}}),
    ]}})


def _evidence_schema(ids: list[str]) -> dict:
    return _object({"record_ids": {"type": "array", "minItems": 1,
                                  "maxItems": 10,
                                  "items": {"type": "string", "enum": ids}}})


def _pairs(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _constant(_: str) -> None:
    raise ValueError()


def _decode(raw: bytes) -> object:
    failed = False
    parsed = None
    try:
        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                            parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError):
        failed = True
    if failed:
        # Raise outside except so even __context__ cannot retain a raw body.
        raise ModelAPIError("INVALID_RESPONSE")
    return parsed


def _output(envelope: object) -> bytes:
    if type(envelope) is not dict or envelope.get("object") != "response":
        raise ModelAPIError("INVALID_RESPONSE")
    if envelope.get("error") is not None:
        raise ModelAPIError("MODEL_ERROR")
    if envelope.get("status") != "completed" or envelope.get("incomplete_details") is not None:
        raise ModelAPIError("MODEL_INCOMPLETE")
    output = envelope.get("output")
    if type(output) is not list or not output:
        raise ModelAPIError("INVALID_RESPONSE")
    messages = []
    for item in output:
        if type(item) is not dict:
            raise ModelAPIError("INVALID_RESPONSE")
        if item.get("type") == "reasoning":
            continue  # REST may include reasoning before the assistant message.
        if (item.get("type") != "message" or item.get("role") != "assistant"
                or item.get("status") != "completed"):
            raise ModelAPIError("INVALID_RESPONSE")
        content = item.get("content")
        if type(content) is not list:
            raise ModelAPIError("INVALID_RESPONSE")
        if any(type(part) is dict and part.get("type") == "refusal" for part in content):
            raise ModelAPIError("MODEL_REFUSAL")
        if (len(content) != 1 or type(content[0]) is not dict
                or content[0].get("type") != "output_text"
                or not _text(content[0].get("text"), MAX_MODEL_BYTES)):
            raise ModelAPIError("INVALID_RESPONSE")
        messages.append(content[0]["text"].encode("utf-8"))
    if len(messages) != 1 or len(messages[0]) > MAX_MODEL_BYTES:
        raise ModelAPIError("INVALID_RESPONSE")
    return messages[0]


class OpenAIResponsesModel:
    """Explicit model/key configuration; use .select and .select_evidence.

    One POST per invocation, no redirect/retry/proxy handling or model tools.
    No production model is selected here. Supported Structured Outputs models
    must be chosen and access approved by the integrating application.
    """

    def __init__(self, *, model: str, api_key: str,
                 timeout_seconds: float = 15.0, max_request_bytes: int = 96_000,
                 max_response_bytes: int = 32_000, max_output_tokens: int = 1_024):
        if (type(model) is not str or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", model) is None
                or type(api_key) is not str
                or re.fullmatch(r"[!-~]{1,512}", api_key) is None
                or type(timeout_seconds) not in (int, float)
                or not 0 < timeout_seconds <= 60 or not math.isfinite(timeout_seconds)
                or any(type(value) is not int or not 1 <= value <= 1_000_000
                       for value in (max_request_bytes, max_response_bytes))
                or type(max_output_tokens) is not int or not 16 <= max_output_tokens <= 16_384):
            raise ModelAPIError("INVALID_CONFIG")
        self._model = model
        self._api_key = api_key
        self._timeout = float(timeout_seconds)
        self._max_request = max_request_bytes
        self._max_response = max_response_bytes
        self._max_output_tokens = max_output_tokens
        self._test_port = None

    def __repr__(self) -> str:
        return "<OpenAIResponsesModel configured>"

    @classmethod
    def for_loopback_test(cls, *, port: int, **kwargs) -> OpenAIResponsesModel:
        """Explicit test-only HTTP opt-in: fixed 127.0.0.1 and /v1/responses.

        Use a dummy key. This does not accept arbitrary provider/merchant URLs.
        """
        if type(port) is not int or not 1 <= port <= 65_535:
            raise ModelAPIError("INVALID_CONFIG")
        instance = cls(**kwargs)
        instance._test_port = port
        return instance

    def select(self, instruction: str, purpose: str,
               candidates: tuple[Candidate, ...]) -> str:
        """Choose a candidate reference; never send owner/task/payment metadata."""
        if (instruction != SELECTION_INSTRUCTION or not _text(purpose, 2_000)
                or type(candidates) is not tuple or not 1 <= len(candidates) <= MAX_CANDIDATES
                or any(type(c) is not Candidate or not _ref(c.candidate_id)
                       or not _text(c.description, 2_000) for c in candidates)
                or len({c.candidate_id for c in candidates}) != len(candidates)):
            raise ModelAPIError("INVALID_MODEL_INPUT")
        ids = [c.candidate_id for c in candidates]
        payload = {"purpose": purpose, "candidates": [
            {"candidate_id": c.candidate_id, "description": c.description} for c in candidates]}
        result = self._call(instruction + '\nWrap the selected JSON object in {"decision": ...}.',
                            payload, "floww_selection", _selection_schema(ids))
        if type(result) is not dict or set(result) != {"decision"} or type(result["decision"]) is not dict:
            raise ModelAPIError("INVALID_RESPONSE")
        # Existing workflow remains the authority for all shape, ID and expiry checks.
        return json.dumps(result["decision"], ensure_ascii=False, separators=(",", ":"))

    def select_evidence(self, instruction: str, purpose: str,
                        records: tuple[Record, ...]) -> str:
        """Select known IDs from records released by the existing access gate."""
        if (instruction != RESULT_INSTRUCTION or not _text(purpose, 2_000)
                or type(records) is not tuple or not 1 <= len(records) <= MAX_RECORDS
                or any(type(r) is not Record or not _ref(r.record_id)
                       or not _text(r.text, 8_000) for r in records)
                or len({r.record_id for r in records}) != len(records)):
            raise ModelAPIError("INVALID_MODEL_INPUT")
        ids = [r.record_id for r in records]
        result = self._call(instruction, {"purpose": purpose, "records": [
            {"record_id": r.record_id, "text": r.text} for r in records]},
            "floww_evidence", _evidence_schema(ids))
        if type(result) is not dict:
            raise ModelAPIError("INVALID_RESPONSE")
        return json.dumps(result, ensure_ascii=False, separators=(",", ":"))

    def _call(self, instruction: str, payload: dict, name: str, schema: dict) -> object:
        body = json.dumps({
            "model": self._model, "store": False, "stream": False, "tools": [],
            "instructions": instruction, "max_output_tokens": self._max_output_tokens,
            "input": [{"role": "user", "content": [{"type": "input_text",
                      "text": json.dumps(payload, ensure_ascii=False)}]}],
            "text": {"format": {"type": "json_schema", "name": name,
                                "schema": schema, "strict": True}},
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(body) > self._max_request:
            raise ModelAPIError("REQUEST_TOO_LARGE")
        raw = self._post(body)
        return _decode(_output(_decode(raw)))

    def _post(self, body: bytes) -> bytes:
        connection = None
        failure = None
        raw = b""
        try:
            if self._test_port is None:
                connection = http.client.HTTPSConnection(
                    "api.openai.com", 443, timeout=self._timeout,
                    context=ssl.create_default_context())
            else:
                connection = http.client.HTTPConnection(
                    "127.0.0.1", self._test_port, timeout=self._timeout)
            connection.request("POST", "/v1/responses", body=body, headers={
                "Authorization": "Bearer " + self._api_key,
                "Content-Type": "application/json", "Accept": "application/json",
                "Accept-Encoding": "identity", "Connection": "close",
            })
            response = connection.getresponse()
            if 300 <= response.status < 400:
                failure = "HTTP_REDIRECT"
            elif response.status != 200:
                failure = "HTTP_ERROR"
            elif (response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
                  != "application/json"
                  or response.getheader("Content-Encoding", "identity").lower() != "identity"):
                failure = "INVALID_RESPONSE"
            else:
                lengths = response.headers.get_all("Content-Length", [])
                if len(lengths) > 1 or (lengths and not re.fullmatch(r"[0-9]+", lengths[0])):
                    failure = "INVALID_RESPONSE"
                elif lengths and int(lengths[0]) > self._max_response:
                    failure = "RESPONSE_TOO_LARGE"
                else:
                    raw = response.read(self._max_response + 1)
                    if len(raw) > self._max_response:
                        failure = "RESPONSE_TOO_LARGE"
                    elif lengths and len(raw) != int(lengths[0]):
                        failure = "INVALID_RESPONSE"
        except TimeoutError:
            failure = "NETWORK_TIMEOUT"
        except Exception:
            # Do not retain upstream exception objects or include their text.
            failure = "NETWORK_ERROR"
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass
        if failure is not None:
            raise ModelAPIError(failure)
        return raw
