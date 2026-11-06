"""Run only scripted, offline examples: python3 -m ai_baseline.demo."""

import json
from dataclasses import asdict, replace

from . import fixtures
from .workflow import consume, propose


def main() -> None:
    print("SYNTHETIC FIXTURES ONLY — no model/API/x402/chain/payment execution")
    for name, example in fixtures.CASES.items():
        ctx, candidate = fixtures.context(name), fixtures.candidate(name)
        proposed = propose(
            ctx, lambda _: (candidate,),
            lambda *_: json.dumps({"action": "PROPOSE", "candidate_id": name,
                                   "reason": "Scripted synthetic selection for this example."}),
            lambda: ctx, lambda: fixtures.NOW,
        )
        if proposed.proposal is None:
            raise RuntimeError("Synthetic proposal failed")
        outcome = fixtures.outcome(proposed.proposal)
        result = consume(proposed.proposal, outcome, lambda _: fixtures.resource(name),
                         lambda *_: json.dumps({"record_ids": example["record_ids"]}), lambda: ctx)
        print(json.dumps({"case": name, "result": asdict(result)}, ensure_ascii=False))
        uncertain = consume(proposed.proposal, replace(outcome, payment="UNKNOWN"),
                            lambda _: (_ for _ in ()).throw(AssertionError("Must not read")),
                            lambda *_: (_ for _ in ()).throw(AssertionError("Must not infer")),
                            lambda: ctx)
        print(json.dumps({"case": name + "_unknown", "result": asdict(uncertain)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
