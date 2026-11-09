"""Compara nuestro CacheLRU con functools.lru_cache (solo como referencia).

functools.lru_cache memoriza una función: si se llama con un argumento ya
visto, es un acierto; si no, ejecuta la función (fallo) y guarda el resultado,
expulsando el menos reciente si está lleno. Es exactamente la secuencia
"obtener -> si falla, guardar" que hace nuestro servicio. Si con la misma
secuencia de claves ambos dan los mismos aciertos y fallos, la política LRU
está bien implementada.
"""

import random
from functools import lru_cache

import pytest

from cache import CacheLRU


def simular(capacidad, secuencia):
    # Referencia de la biblioteca estándar
    @lru_cache(maxsize=capacidad)
    def referencia(clave):
        return clave * 2

    # Nuestro caché (TTL enorme: aquí solo se prueba la política LRU)
    nuestro = CacheLRU(capacidad, ttl_segundos=10**9)
    resultados = []
    for clave in secuencia:
        valor = nuestro.obtener(clave)
        acierto = valor is not None
        if not acierto:
            nuestro.guardar(clave, clave * 2)
            valor = clave * 2
        assert valor == referencia(clave)
        resultados.append(acierto)

    info = referencia.cache_info()
    return nuestro.obtener_estadisticas(), info, resultados


@pytest.mark.parametrize("capacidad", [1, 2, 5, 10, 50])
def test_mismos_aciertos_y_fallos_que_lru_cache(capacidad):
    azar = random.Random(42)
    # Tráfico sesgado: pocas claves frecuentes y muchas raras
    secuencia = [int(azar.paretovariate(1.2)) % 80 for _ in range(3000)]
    stats, info, _ = simular(capacidad, secuencia)
    assert stats["aciertos"] == info.hits
    assert stats["fallos"] == info.misses
    assert stats["tamano"] == info.currsize
