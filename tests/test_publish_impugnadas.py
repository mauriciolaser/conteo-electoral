from __future__ import annotations

import unittest

from election_counter.publish import _impugnadas_resumen_from_payload


class PublishImpugnadasResumenTests(unittest.TestCase):
    def test_aggregate_impugnadas_and_pendientes_votes(self) -> None:
        payload = {
            "regions": [
                {
                    "region": "LIMA",
                    "ubigeo": "140000",
                    "impugnadas": {
                        "es_lima_departamento": True,
                        "votos_impugnados": 100,
                        "mesas_impugnadas": 0,
                        "votos_pendientes_contar": 50,
                        "fuente_agregado": "jee_totales_onpe",
                    },
                },
                {
                    "region": "CUSCO",
                    "ubigeo": "070000",
                    "impugnadas": {
                        "es_lima_departamento": False,
                        "votos_impugnados": 30,
                        "mesas_impugnadas": 0,
                        "votos_pendientes_contar": 10,
                        "fuente_agregado": "jee_totales_onpe",
                    },
                },
            ]
        }
        out = _impugnadas_resumen_from_payload(payload)
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out["votos_impugnados_total"], 130)
        self.assertEqual(out["votos_impugnados_lima_depto"], 100)
        self.assertEqual(out["votos_impugnados_no_lima"], 30)
        self.assertEqual(out["votos_pendientes_contar_total"], 60)
        self.assertEqual(out["votos_pendientes_contar_lima_depto"], 50)
        self.assertEqual(out["votos_pendientes_contar_no_lima"], 10)
        self.assertEqual(out["fuente_agregado"], "jee_totales_onpe")


if __name__ == "__main__":
    unittest.main()

