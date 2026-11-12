"""Population of fictional customer agents.

Every agent gets hidden traits drawn at random from a fixed seed. The traits
are locked before any message is sent, so the brand can never "see" them:
only the agent's reactions are observable.

Join 1 uses uniform placeholder distributions. The KOSIS-calibrated version
(age, region, household size) replaces them later, with every figure checked
on KOSIS and cited.
"""

import json
import random
from dataclasses import dataclass, asdict

AGE_BANDS = ["20s", "30s", "40s", "50s", "60+"]
HOUSEHOLDS = ["lives alone", "couple", "family with kids", "with parents"]
DISTRICTS = ["Mapo-gu", "Gangnam-gu", "Nowon-gu", "Seongdong-gu", "Gwanak-gu", "Songpa-gu"]
LIFE_MOMENTS = [
    "nothing special this week",
    "just moved to a new apartment",
    "payday was yesterday",
    "preparing for an exam",
    "a friend's wedding next weekend",
    "busy period at work, little free time",
    "recovering from a cold",
]


@dataclass
class Agent:
    id: str
    age_band: str
    household: str
    district: str
    price_sensitivity: float   # 0 = ignores price, 1 = only buys on promo
    relationship_capital: float  # hidden: how much the agent trusts the brand
    message_fatigue: float     # 0 = enjoys messages, 1 = hates being contacted
    would_buy_anyway: bool     # hidden ground truth for the Silence Test
    life_moment: str
    holdout: bool = False      # silent control group: receives no message at all

    def brief(self) -> str:
        """Persona text given to the model. Numbers become plain words."""
        def level(x):
            return "low" if x < 0.34 else "medium" if x < 0.67 else "high"
        if self.message_fatigue > 0.66:
            tolerance = ("very low: your phone is flooded with brand notifications, and you "
                         "routinely unsubscribe from or mute brands that contact you too often")
        elif self.message_fatigue > 0.33:
            tolerance = "medium: a few messages are fine, repeated pushes annoy you"
        else:
            tolerance = "high: you don't mind brand messages"
        return (
            f"You are a fictional resident of {self.district}, Seoul, in your {self.age_band}, "
            f"{self.household}. Price sensitivity: {level(self.price_sensitivity)}. "
            f"Trust in the brand 'Haneul Market': {level(self.relationship_capital)}. "
            f"Tolerance for marketing messages: {tolerance}. "
            f"You {'were already planning' if self.would_buy_anyway else 'had no plan'} "
            f"to shop at Haneul Market this week. This week: {self.life_moment}."
        )


def make_population(n: int, seed: int, holdout_share: float = 0.0) -> list[Agent]:
    rng = random.Random(seed)
    # Separate stream: adding a control group never changes anyone's traits.
    holdout_rng = random.Random(seed + 7)
    agents = []
    for i in range(n):
        capital = rng.random()
        agents.append(Agent(
            id=f"a{i:03d}",
            age_band=rng.choice(AGE_BANDS),
            household=rng.choice(HOUSEHOLDS),
            district=rng.choice(DISTRICTS),
            price_sensitivity=round(rng.random(), 2),
            relationship_capital=round(capital, 2),
            message_fatigue=round(rng.random(), 2),
            # loyal agents are more likely to buy without being pushed
            would_buy_anyway=rng.random() < 0.15 + 0.5 * capital,
            life_moment=rng.choice(LIFE_MOMENTS),
            holdout=holdout_rng.random() < holdout_share,
        ))
    return agents


if __name__ == "__main__":
    print(json.dumps([asdict(a) for a in make_population(3, seed=42)], indent=2))
