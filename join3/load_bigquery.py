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
from send_to_amplitude import events_for  # noqa: E402

PROJECT = "scm-seoul"
LOCATION = "EU"


def build_rows(seed=42):
    reactions = json.loads((ROOT / "results" / "join1_live_reactions.json").read_text())
    messages = json.loads((ROOT / "join1" / "messages.json").read_text())
    agents = make_population(len({r["agent"] for r in reactions}), seed)
    run_tag = "w1"  # one canonical id per simulated week

    events = []
    for e in events_for(reactions, agents, messages, run_tag):
        events.append({
            "user_id": e["user_id"], "event_type": e["event_type"],
            "event_time": e["time"] / 1000, "message_id": e["event_properties"]["message_id"],
            "channel": e["event_properties"]["channel"], "insert_id": e["insert_id"],
        })
    customers = [{"user_id": f"scm_{run_tag}_{a.id}", "district": a.district,
                  "age_band": a.age_band, "household": a.household} for a in agents]
    truth = [{"user_id": f"scm_{run_tag}_{a.id}", **{k: v for k, v in asdict(a).items() if k != "id"}}
             for a in agents]
    reaction_truth = [{"user_id": f"scm_{run_tag}_{r['agent']}", "message_id": r["message"],
                       "model_action": r["action"], "annoyance": r.get("annoyance"),
                       "p_exit": r.get("p_exit"), "exited": bool(r.get("exited")),
                       "diary": r.get("diary", "")} for r in reactions]
    return {
        ("scm_brand", "customers"): customers,
        ("scm_brand", "events"): events,
        ("scm_truth", "agents"): truth,
        ("scm_truth", "reactions"): reaction_truth,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    tables = build_rows()

    lines = ["## Join 3: BigQuery load", ""]
    if args.dry_run:
        for (ds, t), rows in tables.items():
            lines.append(f"- {ds}.{t}: {len(rows)} rows (dry run)")
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

    # One join across both worlds, to prove the warehouse can score the brand.
    q = f"""
      SELECT t.message_fatigue > 0.66 AS high_fatigue,
             COUNT(DISTINCT c.user_id) AS customers,
             COUNTIF(e.event_type = 'Unsubscribed') AS unsubscribed
      FROM `{PROJECT}.scm_brand.customers` c
      JOIN `{PROJECT}.scm_truth.agents` t USING (user_id)
      LEFT JOIN `{PROJECT}.scm_brand.events` e USING (user_id)
      GROUP BY 1 ORDER BY 1"""
    lines += ["", "| High hidden fatigue | Customers | Unsubscribed |", "|---|---|---|"]
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
