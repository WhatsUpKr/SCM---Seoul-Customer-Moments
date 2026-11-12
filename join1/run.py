"""Join 1: do 30 agents react differently to the same 5 messages?

Each agent is a separate API call with its own persona, so no agent sees
another one's answer. The script then checks three things:
  1. spread: no message gets the same reaction from more than 80% of agents
  2. sensitivity: tired agents unsubscribe more, loyal agents open more
  3. diversity: the agents' diary lines are not near copies of each other

Usage:
  python join1/run.py --dry-run          # no API call, random fake reactions
  Live runs happen only in GitHub Actions, through Workload Identity
  Federation: GitHub's short-lived OIDC token is exchanged for a short-lived
  Anthropic token. No API key exists anywhere.

Hard caps: at most MAX_CALLS calls per run, Haiku only, short answers.
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.request
from collections import Counter
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402
from agents.fatigue import expected_exit, opt_out_probability  # noqa: E402

MODEL = "claude-haiku-5-5"
MAX_CALLS = 160
MAX_TOKENS = 300
ACTIONS = ["open_and_click", "open_only", "ignore", "unsubscribe"]

SYSTEM = (
    "You play one fictional customer in a closed simulation. Stay in character. "
    "React to the marketing message like this real person would. Real people mostly "
    "ignore brand messages, and they unsubscribe without a second thought when a brand "
    "feels pushy or irrelevant: it takes one tap and costs nothing. Do not be polite to "
    "the brand. Unsubscribing stops all messages from this brand. "
    "Answer with JSON only: "
    '{"annoyance": integer 0-10, "action": one of ' + json.dumps(ACTIONS) + ', '
    '"diary": "one short sentence in English, first person, what you thought"}'
)


def call_model(client, persona: str, message: dict, history: list) -> dict:
    past = "".join(f"- {h['channel']}: {h['en']} -> you chose {h['action']}\n" for h in history)
    context = (f"Messages Haneul Market already sent you this week:\n{past}\n" if past
               else "This is the first message from Haneul Market this week.\n\n")
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM + "\n\nYour persona: " + persona,
        messages=[{"role": "user", "content":
                   context + f"Now you receive this {message['channel']} message:\n"
                   f"{message['text']}\n(English: {message['en']})"}],
    )
    text = next(b.text for b in resp.content if b.type == "text")
    start, end = text.find("{"), text.rfind("}") + 1
    out = json.loads(text[start:end])
    if out.get("action") not in ACTIONS:
        out["action"] = "invalid"
    return out


def refresh_github_token() -> None:
    """GitHub identity tokens expire after about 5 minutes, which also caps
    the Anthropic token. Rewrite the file so the SDK always finds a fresh one."""
    url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    path = os.environ.get("ANTHROPIC_IDENTITY_TOKEN_FILE")
    if not url or not path:
        return
    req = urllib.request.Request(
        url + "&audience=https://api.anthropic.com",
        headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        Path(path).write_text(json.load(r)["value"])


def fake_reaction(rng: random.Random, agent, message) -> dict:
    return {"annoyance": rng.randint(0, 10), "action": rng.choice(ACTIONS),
            "diary": f"dry run {rng.randint(0, 9999)}"}


def words(s: str) -> set:
    return {w.strip(".,!?").lower() for w in s.split() if len(w) > 3}


def analyse(agents, messages, reactions) -> dict:
    by_id = {a.id: a for a in agents}
    report = {"spread": {}, "sensitivity": {}, "diversity": None, "verdict": []}

    for m in messages:
        counts = Counter(r["action"] for r in reactions
                         if r["message"] == m["id"] and r["action"] != "not_sent")
        top_share = max(counts.values()) / sum(counts.values())
        report["spread"][m["id"]] = {"counts": dict(counts), "top_share": round(top_share, 2)}

    def rate(pred, action):
        sub = [r for r in reactions if pred(by_id[r["agent"]])]
        return round(sum(r["action"] == action for r in sub) / max(len(sub), 1), 2)

    exited = {r["agent"] for r in reactions if r["action"] == "unsubscribe"}
    world_exited = {r["agent"] for r in reactions if r.get("exited")}
    bands = {"low": lambda a: a.message_fatigue < 0.33,
             "medium": lambda a: 0.33 <= a.message_fatigue <= 0.66,
             "high": lambda a: a.message_fatigue > 0.66}
    report["exits"] = {}
    for name, pred in bands.items():
        group = [a for a in agents if pred(a)]
        n = max(len(group), 1)
        report["exits"][name] = {
            "agents": len(group),
            "model_exit_rate": round(sum(a.id in exited for a in group) / n, 2),
            "hybrid_exit_rate": round(sum(a.id in world_exited for a in group) / n, 2),
            "baseline_exit_rate": round(sum(expected_exit(a, messages) for a in group) / n, 2),
        }
    report["exits"]["all"] = {
        "agents": len(agents),
        "model_exit_rate": round(len(exited) / len(agents), 2),
        "hybrid_exit_rate": round(len(world_exited) / len(agents), 2),
        "baseline_exit_rate": round(sum(expected_exit(a, messages) for a in agents) / len(agents), 2),
    }

    report["sensitivity"] = {
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

    s, e = report["sensitivity"], report["exits"]
    checks = {
        "spread: no message above 80% same reaction":
            all(v["top_share"] <= 0.8 for v in report["spread"].values()),
        "exits: agents unsubscribe on their own":
            e["all"]["model_exit_rate"] > 0,
        "exits: tired agents leave more than relaxed ones":
            e["high"]["model_exit_rate"] > e["low"]["model_exit_rate"],
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

    client = None
    if not args.dry_run:
        if not os.environ.get("ANTHROPIC_IDENTITY_TOKEN_FILE"):
            sys.exit("No federated identity found. Run through GitHub Actions, or use --dry-run.")
        import anthropic  # reads the ANTHROPIC_* federation variables, no API key
        client = anthropic.Anthropic()

    rng = random.Random(args.seed)
    world_rng = random.Random(args.seed + 1)  # separate stream: the world's dice
    reactions = []
    last_refresh = 0.0
    for a in agents:
        if client and time.time() - last_refresh > 120:
            refresh_github_token()
            last_refresh = time.time()
        history = []
        for m in messages:
            if any(h.get("exited") for h in history):
                reactions.append({"agent": a.id, "message": m["id"], "action": "not_sent",
                                  "diary": ""})
                continue
            try:
                if args.dry_run:
                    out = fake_reaction(rng, a, m)
                else:
                    try:
                        out = call_model(client, a.brief(), m, history)
                    except json.JSONDecodeError:  # malformed answer: one retry
                        out = call_model(client, a.brief(), m, history)
            except Exception as e:  # one failed call must not kill the run
                if "401" in str(e) or "authentication" in str(e).lower():
                    sys.exit(f"Authentication refused, run stopped: {str(e)[:200]}")
                out = {"action": "error", "diary": str(e)[:120]}
            # Hybrid rule: the model says who is annoyed and whether it WANTS to leave;
            # the code decides who actually leaves, with a probability anchored on the
            # market benchmark and scaled by the model's annoyance (0-10, mean ~5 -> 1x).
            prior = sum(h["channel"] == m["channel"] for h in history)
            annoyance = out.get("annoyance") if isinstance(out.get("annoyance"), (int, float)) else 5
            p_exit = opt_out_probability(m["channel"], min(max(annoyance, 0), 10) / 10, prior)
            exited = out["action"] not in ("error", "invalid") and world_rng.random() < p_exit
            reactions.append({"agent": a.id, "message": m["id"], **out,
                              "p_exit": round(p_exit, 4), "exited": exited})
            shown = "unsubscribe (wanted to, but didn't get round to it)" \
                if out["action"] == "unsubscribe" and not exited else out["action"]
            history.append({"channel": m["channel"], "en": m["en"], "action": shown,
                            "exited": exited})

    report = analyse(agents, messages, reactions)
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    tag = "dry" if args.dry_run else "live"
    (out_dir / f"join1_{tag}_reactions.json").write_text(json.dumps(reactions, indent=1, ensure_ascii=False))
    (out_dir / f"join1_{tag}_report.json").write_text(json.dumps(report, indent=1))

    lines = [f"## Join 1 ({tag}): {report['passed']}/{len(report['verdict'])} checks passed", ""]
    lines += [f"- {'✅' if v['pass'] else '❌'} {v['check']}" for v in report["verdict"]]
    lines += ["", "| Message | Top reaction share | Counts |", "|---|---|---|"]
    lines += [f"| {k} | {v['top_share']} | {v['counts']} |" for k, v in report["spread"].items()]
    lines += ["", "| Fatigue | Agents | Model wants to leave | Hybrid (actually left) | Benchmark baseline |",
              "|---|---|---|---|---|"]
    lines += [f"| {k} | {v['agents']} | {v['model_exit_rate']} | {v['hybrid_exit_rate']} | {v['baseline_exit_rate']} |"
              for k, v in report["exits"].items()]
    lines += ["", f"Sensitivity: `{report['sensitivity']}`", f"Diary overlap: {report['diversity']}"]
    summary = "\n".join(lines)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary + "\n")


if __name__ == "__main__":
    main()
