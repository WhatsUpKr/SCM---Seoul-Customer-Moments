"""The replay page's data and its one-file bundle. Run: python -m unittest discover tests"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from viewer.build import build  # noqa: E402
from viewer.bundle import bundle  # noqa: E402


class Viewer(unittest.TestCase):
    def test_page_data_has_what_the_page_reads(self):
        data = build("live")
        for key in ("run", "agents", "messages", "reactions", "outcomes", "measure", "rule", "checks"):
            self.assertIn(key, data)
        self.assertEqual(set(data["outcomes"]), {a["id"] for a in data["agents"]})
        self.assertTrue(all("annoyance" in r and "diary" in r for r in data["reactions"]))
        buyers = sum(v[1] for a, v in data["outcomes"].items())
        self.assertEqual(buyers, data["measure"]["purchases_messaged"])

    def test_bundle_is_one_self_contained_file(self):
        html = bundle()
        self.assertNotIn('src="js/', html)
        self.assertNotIn('href="styles.css"', html)
        self.assertNotRegex(html, r"(?m)^\s*(import|export)\s")
        self.assertIn('"agents"', html)


if __name__ == "__main__":
    unittest.main()
