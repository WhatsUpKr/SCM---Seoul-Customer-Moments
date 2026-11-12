"""Join 2: replay the agents' reactions as real events in Amplitude.

What the brand can see goes to Amplitude: who received what, who opened,
clicked or unsubscribed, plus observable profile fields (district, age band,
household). What the brand cannot see stays out: relationship capital,
fatigue, "would buy anyway" and the model's annoyance score. That split is
the whole point of question 1: which visible signal predicts the hidden one?

Usage:
  python join2/send_to_amplitude.py --dry-run   # print the payload, send nothing
  AMPLITUDE_API_KEY=... python join2/send_to_amplitude.py
"""

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402

ENDPOINT = "https://api.eu.amplitude.com/2/httpapi"  # EU data region
MAX_EVENTS = 2000  # hard cap per run, far below the free plan's monthly volume

# One simulated week, Monday 09:00 Seoul time, one message per day.
WEEK_START = datetime(2026, 11, 9, 0, 0, tzinfo=timezone.utc)
DAY_OFFSET = {"m1_promo": 0, "m2_reminder": 1, "m3_moment": 2, "m4_content": 3, "m5_third_push": 4}


def events_for(reactions, agents, messages, run_tag):
    by_agent = {a.id: a for a in agents}
    by_msg = {m["id"]: m for m in messages}
    events = []
    for i, r in enumerate(reactions):
        if r["action"] in ("not_sent", "error", "invalid"):
            continue
        a, m = by_agent[r["agent"]], by_msg[r["message"]]
        t0 = WEEK_START + timedelta(days=DAY_OFFSET[m["id"]])
        base = {
            "user_id": f"scm_{run_tag}_{a.id}",
            "user_properties": {  # observable profile only
                "district": a.district, "age_band": a.age_band, "household": a.household,
                "simulation": True,
            },
            "event_properties": {"message_id": m["id"], "channel": m["channel"]},
            "platform": "SCM simulation",
        }

        def ev(kind, minutes):
            return {**base, "event_type": kind,
                    "time": int((t0 + timedelta(minutes=minutes)).timestamp() * 1000),
                    "insert_id": f"{run_tag}-{i}-{kind}"}

        events.append(ev("Message Delivered", 0))
        if r["action"] in ("open_only", "open_and_click"):
            events.append(ev("Message Opened", 7))
        if r["action"] == "open_and_click":
            events.append(ev("Message Clicked", 8))
        if r.get("exited"):
            events.append(ev("Unsubscribed", 9))
    return events


def send(api_key, events):
    sent = 0
    for start in range(0, len(events), 500):  # API limit: batches of a few hundred
        batch = events[start:start + 500]
        req = urllib.request.Request(
            ENDPOINT, data=json.dumps({"api_key": api_key, "events": batch}).encode(),
            headers={"Content-Type": "application/json", "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.load(resp)
        sent += body.get("events_ingested", 0)
    return sent


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    path = ROOT / "results" / "join1_live_reactions.json"
    if not path.exists():
        path = ROOT / "results" / "join1_dry_reactions.json"
    reactions = json.loads(path.read_text())
    messages = json.loads((ROOT / "join1" / "messages.json").read_text())
    agents = make_population(len({r["agent"] for r in reactions}), args.seed)
    run_tag = os.environ.get("GITHUB_RUN_ID", "local")[-6:]

    events = events_for(reactions, agents, messages, run_tag)
    if len(events) > MAX_EVENTS:
        sys.exit(f"Refused: {len(events)} events is above the cap of {MAX_EVENTS}.")

    counts = {}
    for e in events:
        counts[e["event_type"]] = counts.get(e["event_type"], 0) + 1
    summary = f"## Join 2: {len(events)} events from {path.name}\n\n" + \
        "\n".join(f"- {k}: {v}" for k, v in counts.items())

    if args.dry_run:
        print(summary)
        print(json.dumps(events[:3], indent=1))
        return
    key = os.environ.get("AMPLITUDE_API_KEY")
    if not key:
        sys.exit("AMPLITUDE_API_KEY is missing. Use --dry-run to test without it.")
    ingested = send(key, events)
    summary += f"\n\nAmplitude accepted **{ingested}** events (EU region)."
    print(summary)
    if ingested != len(events):
        sys.exit(f"Mismatch: sent {len(events)}, Amplitude accepted {ingested}.")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(summary + "\n")


if __name__ == "__main__":
    main()
