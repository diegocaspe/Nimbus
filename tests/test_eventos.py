"""Pruebas del registro de eventos del caché y de las rutas que lo usan."""

import time

import pytest

from cache import CacheLRU
from servicio.app import crear_app
from servicio.nucleo import Nimbus
from servicio.servicio_clima import ServicioClimaSimulado


def tipos(cache, desde=0):
    return [(e["tipo"], e["clave"]) for e in cache.obtener_eventos(desde)["eventos"]]


def test_eventos_de_cada_operacion(reloj):
    c = CacheLRU(2, ttl_segundos=10, reloj=reloj)
    c.obtener("a", "A")             # fallo
    c.guardar("a", 1, "A")          # insercion
    c.obtener("a")                  # acierto
    c.guardar("a", 2)               # actualizacion
    c.guardar("b", 2, "B")          # insercion
    c.guardar("c", 3, "C")          # expulsion de "a" (cola) + insercion
    reloj.avanzar(11)
    c.obtener("b")                  # expirado + fallo
    c.vaciar()                      # vaciado
    assert tipos(c) == [
        ("fallo", "a"), ("insercion", "a"), ("acierto", "a"), ("actualizacion", "a"),
        ("insercion", "b"), ("expulsion", "a"), ("insercion", "c"),
        ("expirado", "b"), ("fallo", "b"), ("vaciado", None),
    ]


def test_evento_trae_nombre_origen_y_datos_extra():
    c = CacheLRU(3)
    c.guardar("k", 1, "Lima", "simulacion", tiempo_api_ms=312.0)
    c.obtener("k", "Lima", "publico")
    insercion, acierto = c.obtener_eventos(0)["eventos"]
    assert insercion["nombre"] == "Lima" and insercion["origen"] == "simulacion"
    assert insercion["tiempo_api_ms"] == 312.0 and insercion["ttl"] == 60
    assert acierto["usos"] == 2 and acierto["tiempo_ms"] >= 0
    assert acierto["secuencia"] == insercion["secuencia"] + 1


def test_eventos_desde_una_secuencia_y_estado_consistente():
    c = CacheLRU(3)
    c.guardar("a", 1)
    corte = c.ultima_secuencia
    c.guardar("b", 2)
    r = c.obtener_eventos(corte)
    assert [e["clave"] for e in r["eventos"]] == ["b"]
    assert r["ultima"] == corte + 1 and r["perdidos"] is False
    assert [n["clave"] for n in r["estado"]] == ["b", "a"]
    assert c.obtener_eventos()["eventos"] == []  # sin "desde": solo el estado


def test_registro_acotado_y_aviso_de_perdidos():
    c = CacheLRU(2, max_eventos=5)
    for i in range(100):
        c.guardar(i, i)
    r = c.obtener_eventos(0)
    assert r["perdidos"] is True            # los primeros eventos ya se recortaron
    assert 5 <= len(r["eventos"]) < 10       # entre max y 2*max
    assert r["eventos"][-1]["secuencia"] == c.ultima_secuencia
    assert c.obtener_eventos(c.ultima_secuencia - 2)["perdidos"] is False


# ----------------------------------------------------------------------
# Rutas
# ----------------------------------------------------------------------
@pytest.fixture
def admin(tmp_path):
    app = crear_app({
        "TESTING": True, "SECRET_KEY": "pruebas", "CAPACIDAD": 3, "SIN_CONEXION": True,
        "SERVICIO_SIMULADO": ServicioClimaSimulado(latencia_ms=0),
        "SIMULACION_SINCRONA": True, "DIR_BENCHMARK": str(tmp_path),
    })
    cliente = app.test_client()
    cliente.post("/admin/login", json={"usuario": "admin", "clave": "clave-de-prueba"})
    return cliente


def test_ruta_eventos(admin):
    inicio = admin.get("/admin/eventos").get_json()
    assert inicio["eventos"] == [] and inicio["estado"] == []
    admin.get("/clima?lat=-12&lon=-77&nombre=Lima")
    r = admin.get(f"/admin/eventos?desde={inicio['ultima']}").get_json()
    assert [e["tipo"] for e in r["eventos"]] == ["fallo", "insercion"]
    assert r["eventos"][1]["nombre"] == "Lima" and r["eventos"][1]["origen"] == "publico"
    assert r["estado"][0]["usos"] == 1
    assert admin.get("/admin/eventos?desde=abc").status_code == 400


def test_ruta_paso(admin):
    r = admin.post("/admin/paso").get_json()
    assert r["ok"] and r["origen"] in ("api", "cache")
    eventos = admin.get("/admin/eventos?desde=0").get_json()["eventos"]
    assert eventos[-1]["secuencia"] == r["ultima"]
    assert all(e["origen"] == "simulacion-paso" for e in eventos)  # el visor lo anima lento


def test_velocidad_invalida(admin):
    r = admin.post("/admin/simular/hora-punta", json={"velocidad": "turbo"})
    assert r.status_code == 400 and "velocidad" in r.get_json()["error"]


def test_simulacion_presentacion_se_puede_detener():
    n = Nimbus(capacidad=5, sin_conexion=True, servicio_simulado=ServicioClimaSimulado(0))
    n.simulacion.lanzar(n, "escaneo", velocidad="presentacion")
    time.sleep(0.3)
    n.simulacion.detener()
    for _ in range(40):                     # espera como máximo 2 s
        if not n.simulacion.estado()["en_curso"]:
            break
        time.sleep(0.05)
    e = n.simulacion.estado()
    assert e["en_curso"] is False and e["detenida"] is True
    assert 1 <= e["hechas"] < 10            # a ~2 por segundo, no llegó lejos
