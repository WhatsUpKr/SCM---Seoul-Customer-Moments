# SCM — Seoul Customer Moments

A small fictional Seoul neighbourhood where every resident is an AI agent with hidden traits, life moments that happen at random, and a real martech stack listening to what they do.

**This is a simulation.** No real customer data is collected. Results describe a model built to think with, not proof of business impact.

## Three questions, one world

1. **The silence signal:** which visible signal best predicts a customer's hidden relationship capital?
2. **Moment detection:** can a brand spot a life moment (moving, payday, an exam) early enough to matter, and late enough not to intrude?
3. **The brand tournament:** when every brand personalises with AI, which strategy wins: volume, hyper-personalisation, moments only, or silence first?

## Why agents

With real customers you never know what would have happened without the message. Here every agent carries a hidden ground truth (for example "would buy anyway"), drawn at random and locked before any test. That makes the Silence Test scorable.

## Status

- [ ] **Join 1** — do 30 agents react differently to the same 5 messages? (`join1/run.py`)
- [ ] Join 2 — script → Segment → Amplitude
- [ ] Join 3 — script → BigQuery
- [ ] Join 4 — BigQuery → Hightouch → OneSignal
- [ ] Join 5 — message → agent inbox → reaction

## Run it

```bash
python join1/run.py --dry-run   # free, no API call
```

The live run uses Claude Haiku through the Anthropic API, with a hard cap on calls per run. It authenticates with Workload Identity Federation: GitHub's short-lived identity token is exchanged for a short-lived Anthropic token, scoped to this repository's `main` branch. There is no API key anywhere.
