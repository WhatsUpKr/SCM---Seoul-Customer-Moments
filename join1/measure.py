"""Measurement check: does the method find the truth?

In this world the truth is known: every agent carries a hidden flag,
"would buy anyway". So we can compare three numbers that a real CRM team
can never line up side by side:

  1. click attribution : purchases by people who clicked a message
  2. holdout estimate  : purchase rate of messaged agents minus the silent
                         control group (only if the run had a holdout)
  3. the truth         : purchases that happened BECAUSE of the messages,
                         minus purchases the messages destroyed

This script proves nothing about real customers. The purchase rule below is
an assumption written by hand. What it tests is the measurement method:
when the truth is known, which estimate lands closest?

Usage:
  python join1/measure.py            # uses the live run if present, else the dry run
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402

# ASSUMPTIONS (hand-written purchase rule, to be challenged):
BASE_BUY = 0.03        # someone with no plan still shops this week
CLICK_LIFT = 0.25      # extra chance when a message was clicked, scaled by trust
EXIT_KEEP = 0.70       # a planner who unsubscribed in annoyance still shops 70% of the time


def outcomes(agent, rs, u):
    """Return (buys_in_silence, buys_with_messages) for one agent, same dice u."""
    silence = agent.would_buy_anyway or u < BASE_BUY
    clicked = any(r["action"] == "open_and_click" for r in rs)
    exited = any(r.get("exited") for r in rs)
    if agent.would_buy_anyway:
        treated = (u < EXIT_KEEP) if exited else True
    else:
        p = BASE_BUY + (CLICK_LIFT * (0.5 + agent.relationship_capital) if clicked else 0.0)
        treated = u < p
    return silence, treated, clicked


def measure(agents, reactions, seed):
    dice = random.Random(seed + 2)
    by_agent = {}
    for r in reactions:
        by_agent.setdefault(r["agent"], []).append(r)
    treated_n = holdout_n = buy_t = buy_h = click_buy = caused = destroyed = 0
    for a in agents:
        u = dice.random()
        silence, treated, clicked = outcomes(a, by_agent.get(a.id, []), u)
        if a.holdout:
            holdout_n += 1
            buy_h += silence
            continue
        treated_n += 1
        buy_t += treated
        click_buy += treated and clicked
        caused += treated and not silence
        destroyed += silence and not treated
    report = {
        "messaged_agents": treated_n, "silent_agents": holdout_n,
        "purchases_messaged": buy_t,
        "click_attributed": click_buy,
        "truth_caused": caused, "truth_destroyed": destroyed,
        "truth_net": caused - destroyed,
        "holdout_estimate": None,
    }
    if holdout_n >= 20 and treated_n:
        report["holdout_estimate"] = round((buy_t / treated_n - buy_h / holdout_n) * treated_n, 1)
    return report


def main():
    out = ROOT / "results"
    tag = "live" if (out / "join1_live_reactions.json").exists() else "dry"
    reactions = json.loads((out / f"join1_{tag}_reactions.json").read_text())
    meta_path = out / f"join1_{tag}_meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else \
        {"agents": len({r["agent"] for r in reactions}), "seed": 42, "holdout": 0.0}
    agents = make_population(meta["agents"], meta["seed"], meta["holdout"])
    rep = measure(agents, reactions, meta["seed"])
    rep["run"] = tag
    (out / f"measure_{tag}_report.json").write_text(json.dumps(rep, indent=1))
    lines = [
        f"## Measurement check ({tag} run, {rep['messaged_agents']} messaged, {rep['silent_agents']} silent)", "",
        f"- Click attribution credits the messages with **{rep['click_attributed']}** purchases.",
        f"- The truth: the messages caused **{rep['truth_caused']}** and destroyed "
        f"**{rep['truth_destroyed']}** (net {rep['truth_net']}).",
        ("- Holdout estimate: **" + str(rep["holdout_estimate"]) + "** net purchases."
         if rep["holdout_estimate"] is not None
         else "- Holdout estimate: not available (this run had no silent group of 20+ agents)."),
        "", "Simulation. The purchase rule is a hand-written assumption (see the top of this file).",
    ]
    print("\n".join(lines))


if __name__ == "__main__":
    main()
