"""Build docs/data.json for the replay page from the latest live run.

Everything the page shows comes from this file: agents, messages, each
reaction (with the model's annoyance score), the weekly purchase of every
agent in both worlds (silent week / messaged week), and the two reports.
The purchases come from join1/measure.py, so page and report cannot disagree.
"""
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402
from join1.measure import BASE_BUY, CLICK_LIFT, EXIT_KEEP, measure, per_agent  # noqa: E402


def build(tag: str = "live") -> dict:
    out = ROOT / "results"
    reactions = json.loads((out / f"join1_{tag}_reactions.json").read_text())
    meta_path = out / f"join1_{tag}_meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else \
        {"agents": len({r["agent"] for r in reactions}), "seed": 42, "holdout": 0.0}
    agents = make_population(meta["agents"], meta["seed"], meta["holdout"])
    messages = json.loads((ROOT / "join1" / "messages.json").read_text())
    report_path = out / f"join1_{tag}_report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    return {
        "run": {"tag": tag, **meta},
        "agents": [asdict(a) for a in agents],
        "messages": messages,
        "reactions": [{k: r.get(k) for k in ("agent", "message", "action", "diary", "exited", "annoyance")}
                      for r in reactions],
        "outcomes": {row["agent"]: [int(row["silence"]), int(row["treated"])]
                     for row in per_agent(agents, reactions, meta["seed"])},
        "measure": {**measure(agents, reactions, meta["seed"]), "run": tag},
        "rule": {"base_buy": BASE_BUY, "click_lift": CLICK_LIFT, "exit_keep": EXIT_KEEP},
        "checks": {k: report.get(k) for k in ("verdict", "passed", "sensitivity", "diversity", "exits")},
    }


if __name__ == "__main__":
    tag = "live" if (ROOT / "results" / "join1_live_reactions.json").exists() else "dry"
    data = build(tag)
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "data.json").write_text(json.dumps(data, ensure_ascii=False))
    print(f"docs/data.json ({tag} run): {len(data['agents'])} agents, {len(data['reactions'])} reactions")
