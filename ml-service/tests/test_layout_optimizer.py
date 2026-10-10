import unittest

from fastapi.testclient import TestClient

import app as service
from layout_optimizer import (
    Item, Opening, Room, Scorer, generate, intersection, opening_zone, rect, relation_cost, wall_distance,
)

ROOM = Room(5.0, 4.0, 2.7)
BEDROOM = [
    Item("bed", "bed", "Queen Bed", 1.6, 2.1, 0.5, mandatory=True),
    Item("nightstand", "nightstand", "Nightstand", 0.5, 0.4, 0.55),
    Item("dresser", "dresser", "Dresser", 1.4, 0.5, 0.8),
    Item("wardrobe", "wardrobe", "Wardrobe", 1.8, 0.6, 2.2),
    Item("desk", "desk", "Writing Desk", 1.2, 0.6, 0.75, mandatory=True),
    Item("chair", "chair", "Desk Chair", 0.5, 0.5, 0.9),
]
OPENINGS = [Opening("door", "south", 0.85, 0.9), Opening("window", "north", 0.75, 1.2)]


def poses_of(layout, items):
    by_id = {f["id"]: f for f in layout["furniture"]}
    return [(by_id[i.id]["x"], by_id[i.id]["z"], by_id[i.id]["rotation"]) for i in items if i.id in by_id]


class LayoutOptimizerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = generate(ROOM, BEDROOM, OPENINGS, seed=7)

    def test_returns_three_valid_layouts_inside_the_room(self):
        layouts = self.result["layouts"]
        self.assertEqual(len(layouts), 3)
        for layout in layouts:
            items = [i for i in BEDROOM if i.id in {f["id"] for f in layout["furniture"]}]
            poses = poses_of(layout, items)
            for item, pose in zip(items, poses):
                x0, z0, x1, z1 = rect(item, pose)
                self.assertGreaterEqual(min(x0, z0), 0)
                self.assertLessEqual(x1, ROOM.width + 1e-6)
                self.assertLessEqual(z1, ROOM.length + 1e-6)
            rects = [rect(item, pose) for item, pose in zip(items, poses)]
            for a in range(len(rects)):
                for b in range(a + 1, len(rects)):
                    self.assertAlmostEqual(intersection(rects[a], rects[b]), 0.0, places=6)

    def test_best_layout_follows_the_core_guidelines(self):
        best = self.result["layouts"][0]
        self.assertEqual(best["omitted"], [])
        poses = dict(zip([i.id for i in BEDROOM], poses_of(best, BEDROOM)))
        items = {i.id: i for i in BEDROOM}
        self.assertLessEqual(wall_distance(items["bed"], poses["bed"], ROOM), 0.2)
        self.assertLessEqual(wall_distance(items["wardrobe"], poses["wardrobe"], ROOM), 0.2)
        self.assertLessEqual(relation_cost(items["nightstand"], poses["nightstand"], items["bed"], poses["bed"],
                                           "beside-head", 0.03), 0.35)
        door_zone = opening_zone(OPENINGS[0], ROOM, OPENINGS[0].width)
        for item in BEDROOM:
            self.assertAlmostEqual(intersection(door_zone, rect(item, poses[item.id])), 0.0, places=6)
        checks = {c["rule"]: c["passed"] for c in best["checks"]}
        self.assertTrue(checks["Walkable path to every item"])
        self.assertGreaterEqual(best["score"], 80)

    def test_layouts_are_meaningfully_different(self):
        first, second = (poses_of(layout, BEDROOM) for layout in self.result["layouts"][:2])
        self.assertNotEqual(first, second)

    def test_scorer_rewards_guidelines_over_a_bad_arrangement(self):
        scorer = Scorer(ROOM, BEDROOM[:2], OPENINGS, 0.3, 0.05)
        good = [(0.05, 0.05, 0), (1.73, 0.05, 0)]          # bed on north wall, nightstand at its head
        bad = [(1.7, 1.0, 0), (4.4, 3.5, 0)]              # bed floating mid-room, nightstand far away
        self.assertLess(scorer.evaluate(good), scorer.evaluate(bad))

    def test_crowded_room_omits_optional_items_but_keeps_required_ones(self):
        tiny = Room(2.6, 2.6, 2.7)
        result = generate(tiny, BEDROOM, [], seed=3, runs=2, iterations=800)
        best = result["layouts"][0]
        kept = {f["id"] for f in best["furniture"]}
        self.assertIn("bed", kept)
        self.assertTrue(best["omitted"])

    def test_measured_obstacles_are_avoided(self):
        pillar = (2.2, 1.6, 2.8, 2.2)
        result = generate(ROOM, BEDROOM[:3], [], seed=5, runs=2, iterations=800, obstacles=(pillar,))
        for layout in result["layouts"]:
            for item, pose in zip(BEDROOM[:3], poses_of(layout, BEDROOM[:3])):
                self.assertAlmostEqual(intersection(rect(item, pose), pillar), 0.0, places=6)

    def test_required_item_too_large_is_rejected(self):
        with self.assertRaises(ValueError):
            generate(Room(1.5, 1.5, 2.5), BEDROOM[:1], [], seed=1, runs=1, iterations=10)


class OptimizeEndpointTests(unittest.TestCase):
    def test_endpoint_returns_explained_layouts_and_validates_input(self):
        client = TestClient(service.app)
        body = {
            "room": {"width": 5, "length": 4, "height": 2.7},
            "items": [{"id": i.id, "type": i.type, "name": i.name, "width": i.width, "length": i.length,
                       "height": i.height, "mandatory": i.mandatory} for i in BEDROOM[:3]],
            "openings": [{"type": "door", "wall": "south", "offset": 0.85, "width": 0.9}],
            "count": 2, "seed": 1,
        }
        response = client.post("/optimize-layout", json=body)
        self.assertEqual(response.status_code, 200)
        layouts = response.json()["layouts"]
        self.assertEqual(len(layouts), 2)
        self.assertTrue(all(c["rule"] and isinstance(c["passed"], bool) for c in layouts[0]["checks"]))
        self.assertEqual(client.post("/optimize-layout", json={**body, "items": []}).status_code, 422)
        bad_wall = {**body, "openings": [{"type": "door", "wall": "up"}]}
        self.assertEqual(client.post("/optimize-layout", json=bad_wall).status_code, 422)


if __name__ == "__main__":
    unittest.main()
