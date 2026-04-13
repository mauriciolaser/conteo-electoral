from __future__ import annotations

import unittest

from election_counter.projection import build_projection


class ProjectionTests(unittest.TestCase):
    def test_scenarios_order_for_top_party(self) -> None:
        raw = {
            "metadata": {"actas_pct_global": 40.0, "warnings": []},
            "regions": [
                {
                    "region": "LIMA",
                    "actas_pct": 40.0,
                    "emitidos_actual": 1000,
                    "partidos": [
                        {"nombre": "PARTIDO A", "votos": 500},
                        {"nombre": "PARTIDO B", "votos": 300},
                        {"nombre": "VOTOS EN BLANCO", "votos": 120},
                        {"nombre": "VOTOS NULOS", "votos": 80},
                    ],
                }
            ],
        }
        padron = {"LIMA": 5000}
        proj = build_projection(raw, padron=padron, margin=0.1, top_n=1)
        sc = proj["scenarios"]
        base = {p["nombre"]: p["votos"] for p in sc["base"]["partidos"]}
        cons = {p["nombre"]: p["votos"] for p in sc["conservador"]["partidos"]}
        opt = {p["nombre"]: p["votos"] for p in sc["optimista"]["partidos"]}
        self.assertLessEqual(cons["PARTIDO A"], base["PARTIDO A"])
        self.assertLessEqual(base["PARTIDO A"], opt["PARTIDO A"])

    def test_projection_schema_minimum(self) -> None:
        raw = {"metadata": {"warnings": []}, "regions": []}
        proj = build_projection(raw, padron={}, margin=0.05, top_n=5)
        self.assertIn("metadata", proj)
        self.assertIn("regions", proj)
        self.assertIn("totals", proj)
        self.assertIn("scenarios", proj)


if __name__ == "__main__":
    unittest.main()
