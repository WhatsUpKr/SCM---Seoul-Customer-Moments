"""Rules of the world that must never break. Run: python -m unittest discover tests"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agents.population import make_population  # noqa: E402
from agents.fatigue import opt_out_probability, SCENARIOS  # noqa: E402
from join1.measure import measure, per_agent  # noqa: E402
from join2.send_to_amplitude import events_for  # noqa: E402

HIDDEN = ("relationship_capital", "message_fatigue", "would_buy_anyway", "price_sensitivity", "annoyance")


class World(unittest.TestCase):
    def test_same_seed_same_people(self):
        self.assertEqual(make_population(30, 42), make_population(30, 42))

    def test_control_group_changes_nobody(self):
        plain, with_holdout = make_population(50, 42), make_population(50, 42, 0.2)
        for a, b in zip(plain, with_holdout):
            self.assertEqual((a.relationship_capital, a.would_buy_anyway, a.district),
                             (b.relationship_capital, b.would_buy_anyway, b.district))
        self.assertTrue(any(b.holdout for b in with_holdout))

    def test_tired_people_leave_more(self):
        for ch in SCENARIOS["conservative"]:
            self.assertLess(opt_out_probability(ch, 0.1, 0), opt_out_probability(ch, 0.9, 0))
            self.assertLess(opt_out_probability(ch, 0.5, 0), opt_out_probability(ch, 0.5, 3))

    def test_hidden_traits_never_reach_the_brand(self):
        agents = make_population(30, 42)
        messages = json.loads((ROOT / "join1" / "messages.json").read_text())
        reactions = [{"agent": a.id, "message": m["id"], "action": "open_and_click",
                      "annoyance": 9, "exited": False} for a in agents for m in messages]
        payload = json.dumps(events_for(reactions, agents, messages, "test"))
        for word in HIDDEN:
            self.assertNotIn(word, payload)

    def test_silence_sells_nothing_extra(self):
        agents = make_population(200, 42, 0.5)
        rep = measure(agents, [], 42)  # nobody reacted to anything
        self.assertEqual(rep["truth_caused"], 0)
        self.assertEqual(rep["click_attributed"], 0)

    def test_page_purchases_match_the_report(self):
        agents = make_population(120, 42, 0.2)
        reactions = [{"agent": a.id, "message": "m1", "action": "open_and_click", "exited": i % 7 == 0}
                     for i, a in enumerate(agents) if not a.holdout and i % 3 == 0]
        rep = measure(agents, reactions, 42)
        rows = [r for r in per_agent(agents, reactions, 42) if not r["holdout"]]
        self.assertEqual(sum(r["treated"] for r in rows), rep["purchases_messaged"])
        self.assertEqual(sum(r["treated"] and r["clicked"] for r in rows), rep["click_attributed"])
        self.assertEqual(sum(r["treated"] and not r["silence"] for r in rows), rep["truth_caused"])
        self.assertEqual(sum(r["silence"] and not r["treated"] for r in rows), rep["truth_destroyed"])


if __name__ == "__main__":
    unittest.main()
