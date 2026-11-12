"""Benchmark baseline for opt-outs, independent from the model.

The baseline answers one question: given an agent's hidden fatigue and the
messages it has already received, how likely is a real customer to opt out?
The model's own decisions are then compared against it.

Sources (stated, not observed on this population):
- Email: 0.20% unsubscribe rate per send (Omnisend 2026 email benchmarks).
- Push: 12% of app users say they would disable notifications after one push
  a week (Helplama survey, quoted by GrabOn). Stated intent, so an upper bound.
- KakaoTalk: no public benchmark found. Assumption: same as email, flagged.
"""

BASE_RATE = {
    "email": 0.002,
    "push": 0.12,
    "kakao": 0.002,  # ASSUMPTION, no benchmark found
}


def opt_out_probability(channel: str, fatigue: float, prior_same_channel: int) -> float:
    """Probability of opting out on this message.

    fatigue is 0..1 with a population mean near 0.5, so 2 * fatigue keeps the
    population average on the benchmark. Each earlier message on the same
    channel adds 50% pressure (ASSUMPTION, to be calibrated later).
    """
    p = BASE_RATE[channel] * (2 * fatigue) * (1 + 0.5 * prior_same_channel)
    return min(p, 0.95)


def expected_exit(agent, messages) -> float:
    """Probability that the agent opts out at least once over the sequence."""
    stay, seen = 1.0, {}
    for m in messages:
        n = seen.get(m["channel"], 0)
        stay *= 1 - opt_out_probability(m["channel"], agent.message_fatigue, n)
        seen[m["channel"]] = n + 1
    return 1 - stay
