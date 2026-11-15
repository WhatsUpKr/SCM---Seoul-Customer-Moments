"""Join 3: load the simulated week into BigQuery (sandbox, EU).

Two datasets, kept apart on purpose:
- scm_brand: what a real brand's warehouse would hold. Customers' observable
  profile and every event (delivered, opened, clicked, unsubscribed).
- scm_truth: the simulation's hidden ground truth (relationship capital,
  fatigue, "would buy anyway", the model's annoyance). Never synced to any
  activation tool; only used to score the brand's guesses afterwards.

Uses load jobs only (no streaming, no DML), which the BigQuery sandbox allows.

Usage:
  python join3/load_bigquery.py --dry-run
  python join3/load_bigquery.py            # in GitHub Actions, authenticated by WIF
"""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "join2"))
from agents.population import make_population  # noqa: E402
from send_to_amplitude import events_for, WEEK_START  # noqa: E402
from join1.measure import measure, per_agent  # noqa: E402
from datetime import timedelta  # noqa: E402

PROJECT = "scm-seoul"
LOCATION = "EU"


def build_rows(seed=42):
    reactions = json.loads((ROOT / "results" / "join1_live_reactions.json").read_text())
    messages = json.loads((ROOT / "join1" / "messages.json").read_text())
    meta_path = ROOT / "results" / "join1_live_meta.json"
    meta = (json.loads(meta_path.read_text()) if meta_path.exists() else
            {"agents": len({r["agent"] for r in reactions}), "seed": seed, "holdout": 0.0})
    # Same population as the run, silent group included (same call as join1/measure.py).
    agents = make_population(meta["agents"], meta["seed"], meta["holdout"])
    run_tag = "w1"  # one canonical id per simulated week

    events = []
    for e in events_for(reactions, agents, messages, run_tag):
        events.append({
            "user_id": e["user_id"], "event_type": e["event_type"],
            "event_time": e["time"] / 1000, "message_id": e["event_properties"]["message_id"],
            "channel": e["event_properties"]["channel"], "insert_id": e["insert_id"],
        })
    # The brand draws its control group itself, so membership is part of what it knows.
    customers = [{"user_id": f"scm_{run_tag}_{a.id}", "district": a.district,
                  "age_band": a.age_band, "household": a.household,
                  "in_control_group": a.holdout} for a in agents]
    # Orders: what the till records on Saturday, same rule as join1/measure.py.
    # The control group lives its silent week; everyone else the week as played.
    rows = {r["agent"]: r for r in per_agent(agents, reactions, meta["seed"])}
    saturday = (WEEK_START + timedelta(days=5, hours=2)).timestamp()
    orders = [{"user_id": f"scm_{run_tag}_{a.id}", "order_time": saturday}
              for a in agents if (rows[a.id]["silence"] if a.holdout else rows[a.id]["treated"])]
    truth = [{"user_id": f"scm_{run_tag}_{a.id}", **{k: v for k, v in asdict(a).items() if k != "id"},
              "buys_in_silent_week": rows[a.id]["silence"]}  # the counterfactual no brand can see
             for a in agents]
    reaction_truth = [{"user_id": f"scm_{run_tag}_{r['agent']}", "message_id": r["message"],
                       "model_action": r["action"], "annoyance": r.get("annoyance"),
                       "p_exit": r.get("p_exit"), "exited": bool(r.get("exited")),
                       "diary": r.get("diary", "")} for r in reactions]
    return {
        "_ctx": (agents, reactions, meta["seed"]),
        ("scm_brand", "customers"): customers,
        ("scm_brand", "events"): events,
        ("scm_brand", "orders"): orders,
        ("scm_truth", "agents"): truth,
        ("scm_truth", "reactions"): reaction_truth,
    }


def score_from_brand(customers, events, orders):
    """What the brand can compute alone: click attribution and the control-group estimate."""
    clicked = {e["user_id"] for e in events if e["event_type"] == "Message Clicked"}
    bought = {o["user_id"] for o in orders}
    msg = [c["user_id"] for c in customers if not c["in_control_group"]]
    ctl = [c["user_id"] for c in customers if c["in_control_group"]]
    out = {"messaged": len(msg), "control": len(ctl),
           "orders_messaged": sum(u in bought for u in msg), "orders_control": sum(u in bought for u in ctl),
           "click_attributed": sum(u in bought and u in clicked for u in msg)}
    if ctl:
        out["holdout_estimate"] = round((out["orders_messaged"] / len(msg) - out["orders_control"] / len(ctl)) * len(msg), 1)
    return out


def check_against_report(brand, ctx):
    """The warehouse must give the same figures as join1/measure.py, or the load is wrong."""
    rep = measure(*ctx)
    pairs = [("click_attributed", "click_attributed"), ("orders_messaged", "purchases_messaged"),
             ("holdout_estimate", "holdout_estimate")]
    bad = [(k, brand.get(k), rep.get(r)) for k, r in pairs if rep.get(r) is not None and brand.get(k) != rep.get(r)]
    if bad:
        sys.exit(f"Warehouse and report disagree: {bad}")
    return rep


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    tables = build_rows()
    ctx = tables.pop("_ctx")
    brand = score_from_brand(tables[("scm_brand", "customers")], tables[("scm_brand", "events")],
                             tables[("scm_brand", "orders")])
    rep = check_against_report(brand, ctx)

    lines = ["## Join 3: BigQuery load", ""]
    if args.dry_run:
        for (ds, t), rows in tables.items():
            lines.append(f"- {ds}.{t}: {len(rows)} rows (dry run)")
        lines += ["", f"- From brand data alone: {brand['click_attributed']} orders credited to clicks, "
                  f"control-group estimate {brand.get('holdout_estimate')}. Truth (hidden): {rep['truth_net']}."]
        print("\n".join(lines))
        return

    from google.cloud import bigquery
    client = bigquery.Client(project=PROJECT, location=LOCATION)
    for ds in {ds for ds, _ in tables}:
        d = bigquery.Dataset(f"{PROJECT}.{ds}")
        d.location = LOCATION
        client.create_dataset(d, exists_ok=True)

    for (ds, t), rows in tables.items():
        job = client.load_table_from_json(
            rows, f"{PROJECT}.{ds}.{t}",
            job_config=bigquery.LoadJobConfig(
                write_disposition="WRITE_TRUNCATE", autodetect=True))
        job.result()
        n = client.get_table(f"{PROJECT}.{ds}.{t}").num_rows
        lines.append(f"- {ds}.{t}: {n} rows")
        if n != len(rows):
            sys.exit(f"Mismatch on {ds}.{t}: sent {len(rows)}, table has {n}")

    # 1. What the brand can compute alone, in SQL: click attribution and the control-group test.
    q_brand = f"""
      WITH o AS (SELECT DISTINCT user_id FROM `{PROJECT}.scm_brand.orders`),
           k AS (SELECT DISTINCT user_id FROM `{PROJECT}.scm_brand.events` WHERE event_type = 'Message Clicked')
      SELECT COUNTIF(NOT c.in_control_group) AS messaged, COUNTIF(c.in_control_group) AS control,
             COUNTIF(NOT c.in_control_group AND o.user_id IS NOT NULL) AS orders_messaged,
             COUNTIF(c.in_control_group AND o.user_id IS NOT NULL) AS orders_control,
             COUNTIF(NOT c.in_control_group AND o.user_id IS NOT NULL AND k.user_id IS NOT NULL) AS click_attributed
      FROM `{PROJECT}.scm_brand.customers` c
      LEFT JOIN o USING (user_id) LEFT JOIN k USING (user_id)"""
    b = dict(next(iter(client.query(q_brand).result())).items())
    if b["control"]:
        b["holdout_estimate"] = round((b["orders_messaged"] / b["messaged"] - b["orders_control"] / b["control"]) * b["messaged"], 1)
    check_against_report(b, ctx)
    # 2. The grade, only possible here because the truth is known.
    q_truth = f"""
      SELECT SUM(CAST(o.user_id IS NOT NULL AS INT64) - CAST(t.buys_in_silent_week AS INT64)) AS truth_net
      FROM `{PROJECT}.scm_brand.customers` c
      JOIN `{PROJECT}.scm_truth.agents` t USING (user_id)
      LEFT JOIN (SELECT DISTINCT user_id FROM `{PROJECT}.scm_brand.orders`) o USING (user_id)
      WHERE NOT c.in_control_group"""
    truth_net = next(iter(client.query(q_truth).result())).truth_net
    if truth_net != rep["truth_net"]:
        sys.exit(f"Truth in the warehouse ({truth_net}) differs from the report ({rep['truth_net']})")
    lines += ["", "| Method (computed in BigQuery) | Purchases credited to the messages |", "|---|---|",
              f"| Click attribution (brand data) | {b['click_attributed']} |",
              f"| Control group (brand data) | {b.get('holdout_estimate')} |",
              f"| Truth (hidden dataset) | {truth_net} |"]
    # 3. Who actually leaves, by hidden fatigue, messaged customers only.
    q = f"""
      SELECT t.message_fatigue > 0.66 AS high_fatigue,
             COUNT(DISTINCT c.user_id) AS customers,
             COUNT(DISTINCT IF(e.event_type = 'Unsubscribed', c.user_id, NULL)) AS unsubscribed
      FROM `{PROJECT}.scm_brand.customers` c
      JOIN `{PROJECT}.scm_truth.agents` t USING (user_id)
      LEFT JOIN `{PROJECT}.scm_brand.events` e USING (user_id)
      WHERE NOT c.in_control_group
      GROUP BY 1 ORDER BY 1"""
    lines += ["", "| High hidden fatigue | Messaged customers | Unsubscribed |", "|---|---|---|"]
    for row in client.query(q).result():
        lines.append(f"| {row.high_fatigue} | {row.customers} | {row.unsubscribed} |")

    summary = "\n".join(lines)
    print(summary)
    import os
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary + "\n")


if __name__ == "__main__":
    main()
