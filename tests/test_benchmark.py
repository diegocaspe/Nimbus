"""Pruebas del benchmark (con latencia 0 para que sean rápidas)."""

from benchmark.benchmark import (correr_escenario, lugares_benchmark,
                                 medir_complejidad, trafico_zipf)
from servicio.servicio_clima import ServicioClimaSimulado


def test_trafico_zipf_es_reproducible_y_sesgado():
    lugares = lugares_benchmark()
    a = trafico_zipf(lugares, 1000, semilla=1)
    assert a == trafico_zipf(lugares, 1000, semilla=1)   # misma semilla, misma secuencia
    assert a.count(lugares[0]) > a.count(lugares[-1])    # el primero es el más pedido


def test_mas_capacidad_mas_aciertos_y_menos_api():
    consultas = trafico_zipf(lugares_benchmark(), 1000, semilla=3)
    servicio = ServicioClimaSimulado(latencia_ms=0)
    sin = correr_escenario(consultas, servicio)
    c5 = correr_escenario(consultas, servicio, 5)
    c50 = correr_escenario(consultas, servicio, 50)
    assert sin["llamadas_api"] == 1000 and sin["tasa_aciertos"] == 0
    assert c5["tasa_aciertos"] < c50["tasa_aciertos"]
    assert c50["llamadas_api"] < c5["llamadas_api"] < 1000


def test_medir_complejidad_devuelve_filas():
    filas = medir_complejidad(tamanos=[10, 100], operaciones=200)
    assert [f["tamano"] for f in filas] == [10, 100]
    assert all(f["obtener_us"] > 0 and f["guardar_us"] > 0 for f in filas)
