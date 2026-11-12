"""Build docs/data.json for the replay page from the latest live run."""
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402

out = ROOT / "results"
reactions = json.loads((out / "join1_live_reactions.json").read_text())
meta_path = out / "join1_live_meta.json"
meta = json.loads(meta_path.read_text()) if meta_path.exists() else \
    {"agents": len({r["agent"] for r in reactions}), "seed": 42, "holdout": 0.0}
agents = make_population(meta["agents"], meta["seed"], meta["holdout"])
messages = json.loads((ROOT / "join1" / "messages.json").read_text())
measure_path = out / "measure_live_report.json"
data = {
    "agents": [asdict(a) for a in agents],
    "messages": messages,
    "reactions": [{k: r.get(k) for k in ("agent", "message", "action", "diary", "exited")}
                  for r in reactions],
    "measure": json.loads(measure_path.read_text()) if measure_path.exists() else None,
}
(ROOT / "docs").mkdir(exist_ok=True)
(ROOT / "docs" / "data.json").write_text(json.dumps(data, ensure_ascii=False))
print(f"docs/data.json: {len(agents)} agents, {len(reactions)} reactions")
