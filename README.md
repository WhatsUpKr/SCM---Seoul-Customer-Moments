# Seoul Customer Moments

A small fictional Seoul neighbourhood. Every resident is an AI agent with hidden traits. A fictional grocer sends them messages, and a real martech stack records what they do.

**Watch one week:** the replay page is in [`docs/`](docs/index.html) (GitHub Pages: `https://whatsupkr.github.io/SCM---Seoul-Customer-Moments/` once Pages is switched on).

**This is a simulation.** No real customer data. It says nothing about real customers.

## What it is for

In real CRM you never see what would have happened without the message. Here you do: each agent carries a hidden flag, "was going to shop anyway", drawn at random and locked before any message is sent.

So this world is a test bench for **measurement methods**. The truth is known. The question is which method finds it.

First run (30 agents, 5 messages, 12 Nov 2026):

| Method | Purchases credited to the messages |
|---|---|
| Click attribution | 12 |
| The truth | 0 |

Every agent who clicked was already going to shop. Thirty agents is an illustration, not a result: the next run uses 300 agents and a silent control group.

## What is built

- [x] **Join 1** — 30 agents react to 5 messages, each through its own model call (`join1/run.py`)
- [x] **Join 2** — reactions replayed as events: script → Segment → Amplitude (`join2/send_to_amplitude.py`)
- [x] **Measurement check** — clicks vs silent group vs the truth (`join1/measure.py`)
- [x] **Replay page** (`docs/`) and tests (`tests/`)
- [ ] Join 3 — events → BigQuery, SQL models
- [ ] Join 4 — BigQuery → Hightouch → OneSignal
- [ ] Join 5 — message → agent inbox → reaction

## How the world stays fair

- **Hidden traits stay hidden.** Trust, fatigue and "was going to shop anyway" never reach Amplitude. A test fails if they do.
- **The model does not decide who leaves.** It says how annoyed the agent is. Dice anchored on a benchmark decide who actually unsubscribes.
- **Separate dice.** People, the control group and purchases each use their own random stream, so adding a control group changes nobody.
- **Hard caps.** Each run refuses to start above a fixed number of calls. Live runs start by hand only.

## Known limits

- **Built-in answers.** The persona tells the model about the agent's trust and shopping plan, so "loyal agents click more" is true by construction. The world can test a method. It cannot discover customer behaviour.
- **Purchases follow a hand-written rule** (top of `join1/measure.py`).
- **Push opt-out rate is an assumption.** The only public figure found is stated intent (12% after one push a week). Used per message it removed 37% of agents in a week. The default is now a tenth of it, flagged in `agents/fatigue.py`, until an observed rate replaces it.
- **KakaoTalk opt-out rate:** no public benchmark found; set equal to email.
- Population traits are uniform placeholders. Calibration on KOSIS (age, district, household) comes next.

## Run it

```bash
python -m unittest discover tests        # rules of the world, no API call
python join1/run.py --dry-run            # fake reactions, no API call
python join1/measure.py                  # clicks vs truth on the latest run
python viewer/build.py                   # refresh the replay page data
```

Live runs use Claude Haiku from GitHub Actions through Workload Identity Federation: GitHub's short-lived identity token is exchanged for a short-lived Anthropic token, scoped to this repository's `main` branch. There is no API key anywhere.
