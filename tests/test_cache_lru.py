"""Pruebas del CacheLRU: capacidad, expulsión y orden de uso (Hito 1)."""

import pytest

from cache import CacheLRU


def claves(cache):
    return [n["clave"] for n in cache.obtener_estado()]


def test_capacidad_uno():
    c = CacheLRU(1)
    c.guardar("a", 1)
    c.guardar("b", 2)
    assert c.obtener("a") is None
    assert c.obtener("b") == 2
    assert len(c) == 1
    assert c.obtener_estadisticas()["expulsiones"] == 1


def test_clave_repetida_actualiza_y_no_duplica():
    c = CacheLRU(3)
    c.guardar("a", 1)
    c.guardar("b", 2)
    c.guardar("a", 10)
    assert c.obtener("a") == 10
    assert len(c) == 2
    assert claves(c) == ["a", "b"]
    assert c.obtener_estadisticas()["expulsiones"] == 0


def test_cache_lleno_expulsa_la_cola():
    c = CacheLRU(3)
    for k in "abc":
        c.guardar(k, k.upper())
    c.guardar("d", "D")  # "a" es la menos reciente
    assert "a" not in c
    assert claves(c) == ["d", "c", "b"]
    assert c.obtener_estadisticas()["expulsiones"] == 1


def test_leer_cuenta_como_uso():
    c = CacheLRU(3)
    for k in "abc":
        c.guardar(k, k)
    c.obtener("a")       # ahora "b" es la menos reciente
    c.guardar("d", "d")
    assert "b" not in c
    assert "a" in c
    assert claves(c) == ["d", "a", "c"]


def test_eliminar():
    c = CacheLRU(2)
    c.guardar("a", 1)
    assert c.eliminar("a") is True
    assert c.eliminar("a") is False
    assert len(c) == 0


def test_cambiar_capacidad_expulsa_desde_la_cola():
    c = CacheLRU(5)
    for k in "abcde":
        c.guardar(k, k)
    c.cambiar_capacidad(2)
    assert claves(c) == ["e", "d"]
    assert c.obtener_estadisticas()["expulsiones"] == 3
    c.cambiar_capacidad(4)  # crecer no expulsa nada
    c.guardar("f", "f")
    assert claves(c) == ["f", "e", "d"]


@pytest.mark.parametrize("mala", [0, -1, 2.5, "3", True])
def test_capacidad_invalida(mala):
    with pytest.raises(ValueError):
        CacheLRU(mala)


# ----------------------------------------------------------------------
# Hito 2: TTL, métricas y concurrencia
# ----------------------------------------------------------------------
def test_expiracion_por_ttl_sin_dormir(reloj):
    c = CacheLRU(3, ttl_segundos=10, reloj=reloj)
    c.guardar("a", 1)
    reloj.avanzar(9.9)
    assert c.obtener("a") == 1          # todavía vale
    reloj.avanzar(0.1)                  # justo al vencer
    assert c.obtener("a") is None       # se comporta como si no existiera
    assert "a" not in c                 # y se eliminó del dict
    st = c.obtener_estadisticas()
    assert (st["aciertos"], st["fallos"], st["expirados"], st["tamano"]) == (1, 1, 1, 0)


def test_guardar_otra_vez_renueva_el_ttl(reloj):
    c = CacheLRU(3, ttl_segundos=10, reloj=reloj)
    c.guardar("a", 1)
    reloj.avanzar(8)
    c.guardar("a", 2)
    reloj.avanzar(8)                    # 16 s desde el primer guardado, 8 desde el segundo
    assert c.obtener("a") == 2


def test_obtener_estado_muestra_ttl_restante_sin_alterar_metricas(reloj):
    c = CacheLRU(3, ttl_segundos=10, reloj=reloj)
    c.guardar("a", 1)
    reloj.avanzar(4)
    c.guardar("b", 2)
    reloj.avanzar(7)                    # "a" ya venció pero nadie la ha leído
    estado = c.obtener_estado()
    assert [(n["clave"], n["ttl_restante"]) for n in estado] == [("b", 3.0), ("a", 0.0)]
    st = c.obtener_estadisticas()
    assert st["aciertos"] == st["fallos"] == 0


def test_cambiar_ttl_aplica_a_las_nuevas(reloj):
    c = CacheLRU(3, ttl_segundos=10, reloj=reloj)
    c.guardar("vieja", 1)
    c.cambiar_ttl(100)
    c.guardar("nueva", 2)
    reloj.avanzar(50)
    assert c.obtener("vieja") is None
    assert c.obtener("nueva") == 2
    assert c.obtener_estadisticas()["ttl"] == 100


def test_metricas_correctas():
    c = CacheLRU(2)
    c.obtener("x")                      # fallo
    c.guardar("a", 1)
    c.guardar("b", 2)
    c.obtener("a")                      # acierto
    c.obtener("a")                      # acierto
    c.guardar("c", 3)                   # expulsa "b"
    c.obtener("b")                      # fallo
    st = c.obtener_estadisticas()
    assert st["aciertos"] == 2
    assert st["fallos"] == 2
    assert st["tasa_aciertos"] == 50.0
    assert st["expulsiones"] == 1
    assert st["tamano"] == 2
    assert st["capacidad"] == 2


def test_tasa_sin_consultas_es_cero():
    assert CacheLRU(3).obtener_estadisticas()["tasa_aciertos"] == 0.0


def test_vaciar_borra_los_datos_pero_no_las_metricas():
    c = CacheLRU(2)
    c.guardar("a", 1)
    c.obtener("a")
    c.obtener("x")
    c.vaciar()
    assert len(c) == 0
    assert c.obtener_estado() == []
    st = c.obtener_estadisticas()
    assert (st["aciertos"], st["fallos"]) == (1, 1)   # las métricas siguen
    c.guardar("b", 2)                   # sigue funcionando después de vaciar
    assert c.obtener("b") == 2


def test_reiniciar_metricas_no_toca_los_datos(reloj):
    c = CacheLRU(1, ttl_segundos=10, reloj=reloj)
    c.guardar("a", 1)
    c.obtener("a")
    c.obtener("x")
    c.guardar("b", 2)                   # expulsa "a"
    reloj.avanzar(11)
    c.obtener("b")                      # vencida: expirados = 1
    c.guardar("c", 3)
    c.reiniciar_metricas()
    st = c.obtener_estadisticas()
    assert st["aciertos"] == st["fallos"] == st["expulsiones"] == st["expirados"] == 0
    assert (st["tamano"], st["capacidad"], st["ttl"]) == (1, 1, 10)
    assert c.obtener("c") == 3          # el dato sigue guardado


def test_seguro_con_varios_hilos():
    import threading

    c = CacheLRU(16)

    def trabajar(base):
        for i in range(2000):
            k = (base * 7 + i) % 40
            if c.obtener(k) is None:
                c.guardar(k, k)

    hilos = [threading.Thread(target=trabajar, args=(b,)) for b in range(8)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    st = c.obtener_estadisticas()
    assert st["aciertos"] + st["fallos"] == 8 * 2000
    # La lista y el dict siguen siendo coherentes
    estado = c.obtener_estado()
    assert len(estado) == len(c) <= 16
    assert len({n["clave"] for n in estado}) == len(estado)
