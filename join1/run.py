"""Join 1: do 30 agents react differently to the same 5 messages?

Each agent is a separate API call with its own persona, so no agent sees
another one's answer. The script then checks three things:
  1. spread: no message gets the same reaction from more than 80% of agents
  2. sensitivity: tired agents unsubscribe more, loyal agents open more
  3. diversity: the agents' diary lines are not near copies of each other

Usage:
  python join1/run.py --dry-run          # no API call, random fake reactions
  ANTHROPIC_API_KEY=... python join1/run.py

Hard caps: at most MAX_CALLS calls per run, Haiku only, short answers.
"""

import argparse
import json
import os
import random
import sys
import urllib.request
from collections import Counter
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402

MODEL = "claude-haiku-5-5"
MAX_CALLS = 160
MAX_TOKENS = 220
ACTIONS = ["open_and_click", "open_only", "ignore", "unsubscribe"]

SYSTEM = (
    "You play one fictional customer in a closed simulation. Stay in character. "
    "React to the marketing message like this real person would, including ignoring it. "
    "Answer with JSON only: "
    '{"action": one of ' + json.dumps(ACTIONS) + ', '
    '"diary": "one short sentence in English, first person, what you thought"}'
)


def call_model(api_key: str, persona: str, message: dict) -> dict:
    body = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM + "\n\nYour persona: " + persona,
        "messages": [{"role": "user", "content":
                      f"You receive this {message['channel']} message:\n{message['text']}\n"
                      f"(English: {message['en']})"}],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        text = json.load(r)["content"][0]["text"]
    start, end = text.find("{"), text.rfind("}") + 1
    out = json.loads(text[start:end])
    if out.get("action") not in ACTIONS:
        out["action"] = "invalid"
    return out


def fake_reaction(rng: random.Random, agent, message) -> dict:
    return {"action": rng.choice(ACTIONS), "diary": f"dry run {rng.randint(0, 9999)}"}


def words(s: str) -> set:
    return {w.strip(".,!?").lower() for w in s.split() if len(w) > 3}


def analyse(agents, messages, reactions) -> dict:
    by_id = {a.id: a for a in agents}
    report = {"spread": {}, "sensitivity": {}, "diversity": None, "verdict": []}

    for m in messages:
        counts = Counter(r["action"] for r in reactions if r["message"] == m["id"])
        top_share = max(counts.values()) / sum(counts.values())
        report["spread"][m["id"]] = {"counts": dict(counts), "top_share": round(top_share, 2)}

    def rate(pred, action):
        sub = [r for r in reactions if pred(by_id[r["agent"]])]
        return round(sum(r["action"] == action for r in sub) / max(len(sub), 1), 2)

    report["sensitivity"] = {
        "unsubscribe_high_fatigue": rate(lambda a: a.message_fatigue > 0.66, "unsubscribe"),
        "unsubscribe_low_fatigue": rate(lambda a: a.message_fatigue < 0.33, "unsubscribe"),
        "click_high_capital": rate(lambda a: a.relationship_capital > 0.66, "open_and_click"),
        "click_low_capital": rate(lambda a: a.relationship_capital < 0.33, "open_and_click"),
    }

    sims = []
    for m in messages:
        diaries = [words(r["diary"]) for r in reactions if r["message"] == m["id"]]
        for x, y in combinations(diaries, 2):
            if x | y:
                sims.append(len(x & y) / len(x | y))
    report["diversity"] = round(sum(sims) / max(len(sims), 1), 2)

    s = report["sensitivity"]
    checks = {
        "spread: no message above 80% same reaction":
            all(v["top_share"] <= 0.8 for v in report["spread"].values()),
        "sensitivity: tired agents unsubscribe more":
            s["unsubscribe_high_fatigue"] > s["unsubscribe_low_fatigue"],
        "sensitivity: loyal agents click more":
            s["click_high_capital"] > s["click_low_capital"],
        "diversity: average diary overlap below 0.35":
            report["diversity"] < 0.35,
    }
    report["verdict"] = [{"check": k, "pass": v} for k, v in checks.items()]
    report["passed"] = sum(checks.values())
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--agents", type=int, default=30)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    agents = make_population(args.agents, args.seed)
    messages = json.loads((ROOT / "join1" / "messages.json").read_text())
    if len(agents) * len(messages) > MAX_CALLS:
        sys.exit(f"Refused: {len(agents) * len(messages)} calls is above the cap of {MAX_CALLS}.")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not args.dry_run and not api_key:
        sys.exit("ANTHROPIC_API_KEY is missing. Use --dry-run to test without it.")

    rng = random.Random(args.seed)
    reactions = []
    for a in agents:
        for m in messages:
            try:
                out = fake_reaction(rng, a, m) if args.dry_run else call_model(api_key, a.brief(), m)
            except Exception as e:  # one failed call must not kill the run
                out = {"action": "error", "diary": str(e)[:120]}
            reactions.append({"agent": a.id, "message": m["id"], **out})

    report = analyse(agents, messages, reactions)
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    tag = "dry" if args.dry_run else "live"
    (out_dir / f"join1_{tag}_reactions.json").write_text(json.dumps(reactions, indent=1, ensure_ascii=False))
    (out_dir / f"join1_{tag}_report.json").write_text(json.dumps(report, indent=1))

    lines = [f"## Join 1 ({tag}): {report['passed']}/4 checks passed", ""]
    lines += [f"- {'✅' if v['pass'] else '❌'} {v['check']}" for v in report["verdict"]]
    lines += ["", "| Message | Top reaction share | Counts |", "|---|---|---|"]
    lines += [f"| {k} | {v['top_share']} | {v['counts']} |" for k, v in report["spread"].items()]
    lines += ["", f"Sensitivity: `{report['sensitivity']}`", f"Diary overlap: {report['diversity']}"]
    summary = "\n".join(lines)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary + "\n")


if __name__ == "__main__":
    main()
