from __future__ import annotations

import unittest

from election_counter.onpe_region_extras import (
    impugnadas_summary_from_row,
    jee_summary_from_totales,
    sanchez_leads_vs_renovacion,
)


class OnpeRegionExtrasTests(unittest.TestCase):
    def test_jee_prorrateo_con_total_mesas(self) -> None:
        tot = {
            "totalVotosEmitidos": 1000,
            "enviadasJee": 10,
            "pendientesJee": 5,
            "totalMesas": 100,
        }
        j = jee_summary_from_totales(tot)
        self.assertEqual(j["votos_revision_jne"], 100)
        self.assertEqual(j["votos_pendientes_contar"], 50)
        self.assertEqual(j["prorrateo"], "totalVotosEmitidos_por_acta_sobre_total_mesas")

    def test_jee_sin_total_mesas_usa_env_mas_pen(self) -> None:
        tot = {"totalVotosEmitidos": 1000, "enviadasJee": 2, "pendientesJee": 3}
        j = jee_summary_from_totales(tot)
        self.assertEqual(j["total_mesas_o_actas"], 5)
        self.assertEqual(j["votos_revision_jne"], 400)
        self.assertEqual(j["votos_pendientes_contar"], 600)

    def test_sanchez_leads(self) -> None:
        partidos = [
            {"nombre": "JUNTOS POR EL PERÚ", "votos": 100, "es_blanco_o_nulo": False},
            {"nombre": "RENOVACIÓN POPULAR", "votos": 80, "es_blanco_o_nulo": False},
        ]
        self.assertTrue(sanchez_leads_vs_renovacion(partidos))
        partidos[0]["votos"] = 50
        self.assertFalse(sanchez_leads_vs_renovacion(partidos))

    def test_impugnadas_desde_totales(self) -> None:
        tot = {"mesasImpugnadas": 4, "votosImpugnados": 120}
        imp = impugnadas_summary_from_row(
            region_name="LIMA",
            ubigeo="140000",
            partidos=[],
            tot=tot,
        )
        self.assertTrue(imp["es_lima_departamento"])
        self.assertEqual(imp["mesas_impugnadas"], 4)
        self.assertEqual(imp["votos_impugnados"], 120)
        self.assertEqual(imp["fuente_agregado"], "totales_onpe")


if __name__ == "__main__":
    unittest.main()
