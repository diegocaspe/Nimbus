"""Pruebas de las rutas Flask con el cliente de pruebas y el servicio simulado."""

import json

import pytest

from servicio.app import crear_app
from servicio.servicio_clima import (ErrorServicioExterno,
                                     ServicioClimaSimulado, clave_de)


class ServicioCaido:
    """Servicio 'real' falso que siempre falla (como si no hubiera internet)."""

    def consultar(self, lat, lon, nombre=""):
        raise ErrorServicioExterno("No se pudo contactar a Open-Meteo.")

    def buscar(self, texto):
        raise ErrorServicioExterno("No se pudo contactar a Open-Meteo.")


@pytest.fixture
def app(tmp_path):
    return crear_app({
        "TESTING": True,
        "SECRET_KEY": "pruebas",
        "CAPACIDAD": 3,
        "SIN_CONEXION": True,                              # usa el simulado
        "SERVICIO_SIMULADO": ServicioClimaSimulado(latencia_ms=0),
        "SERVICIO_REAL": ServicioCaido(),                  # nunca sale a internet
        "SIMULACION_SINCRONA": True,
        "DIR_BENCHMARK": str(tmp_path),
    })


@pytest.fixture
def cliente(app):
    return app.test_client()


@pytest.fixture
def admin(cliente):
    r = cliente.post("/admin/login", json={"usuario": "admin", "clave": "clave-de-prueba"})
    assert r.status_code == 200
    return cliente


def test_clave_redondea_a_un_decimal():
    assert clave_de(-12.05, -77.04) == "-12.1,-77.0"
    assert clave_de(-12.04, -77.01) == "-12.0,-77.0"
    assert clave_de(-0.04, 0.02) == "0.0,0.0"


def test_clima_primero_api_luego_cache(cliente):
    r1 = cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima").get_json()
    r2 = cliente.get("/clima?lat=-12.06&lon=-77.03&nombre=Lima").get_json()  # misma clave redondeada
    assert r1["origen"] == "api" and r2["origen"] == "cache"
    assert r1["actual"] == r2["actual"]
    assert len(r1["pronostico"]) == 5
    assert isinstance(r2["tiempo_ms"], (int, float))
    assert r1["nombre"] == "Lima"


def test_clima_valida_parametros(cliente):
    r = cliente.get("/clima?lat=abc&lon=1")
    assert r.status_code == 400 and "lat" in r.get_json()["error"]
    assert cliente.get("/clima").status_code == 400
    assert cliente.get("/clima?lat=100&lon=0").status_code == 400


def test_estadisticas_y_vaciar(cliente):
    cliente.get("/clima?lat=-12&lon=-77&nombre=Lima")
    cliente.get("/clima?lat=-12&lon=-77&nombre=Lima")
    st = cliente.get("/estadisticas").get_json()
    assert st["aciertos"] == 1 and st["fallos"] == 1
    assert st["llamadas_api_evitadas"] == 1
    assert st["nodos"][0]["clave"] == "-12.0,-77.0"
    assert st["nodos"][0]["nombre"] == "Lima"
    assert cliente.post("/vaciar").get_json()["ok"] is True
    st = cliente.get("/estadisticas").get_json()
    assert st["tamano"] == 0 and st["aciertos"] == 0


def test_servicio_real_caido_cambia_al_simulado(app, cliente):
    """Si Open-Meteo falla, la consulta igual responde (con el simulado) y queda el aviso."""
    app.extensions["nimbus"].sin_conexion = False
    r = cliente.get("/clima?lat=-12&lon=-77")
    assert r.status_code == 200 and r.get_json()["origen"] == "api"
    st = cliente.get("/estadisticas").get_json()
    assert st["sin_conexion"] is True and st["tamano"] == 1
    assert st["aviso_api"]["mensaje"] == "API no disponible: usando modo sin conexión"


def test_buscar_sin_conexion(cliente):
    res = cliente.get("/buscar?q=huanu").get_json()["resultados"]
    assert res[0]["nombre"] == "Huánuco"
    assert cliente.get("/buscar?q=a").get_json()["resultados"] == []


def test_admin_requiere_login(cliente):
    for ruta in ["/admin/registro", "/admin/configuracion", "/admin/simulacion/estado", "/admin/benchmark"]:
        r = cliente.get(ruta)
        assert r.status_code == 401
        assert "error" in r.get_json()
    assert cliente.post("/admin/simular/hora-punta").status_code == 401
    assert cliente.post("/admin/login", json={"usuario": "admin", "clave": "mal"}).status_code == 401


def test_configuracion(admin, app):
    r = admin.post("/admin/configuracion",
                   json={"capacidad": 5, "ttl": 30, "sin_conexion": True, "latencia_ms": 0})
    assert r.status_code == 200
    cfg = r.get_json()
    assert (cfg["capacidad"], cfg["ttl"], cfg["latencia_ms"]) == (5, 30, 0)
    assert app.extensions["nimbus"].cache.obtener_estadisticas()["capacidad"] == 5
    malo = admin.post("/admin/configuracion", json={"capacidad": 0})
    assert malo.status_code == 400 and "capacidad" in malo.get_json()["error"]
    assert admin.post("/admin/configuracion", json={"sin_conexion": "si"}).status_code == 400


def test_registro_guarda_las_ultimas_20(admin):
    for i in range(25):
        admin.get(f"/clima?lat={-5 - i}&lon=-75&nombre=L{i}")
    filas = admin.get("/admin/registro").get_json()["consultas"]
    assert len(filas) == 20
    assert filas[0]["lugar"] == "L24"           # la más nueva primero
    assert set(filas[0]) == {"hora", "lugar", "clave", "origen", "tiempo_ms", "tipo", "pionera"}


def test_simulacion_hora_punta(admin):
    # Capacidad mayor que el grupo popular (10 lugares) para que el caché rinda
    admin.post("/admin/configuracion", json={"capacidad": 12})
    r = admin.post("/admin/simular/hora-punta")
    assert r.status_code == 202
    estado = admin.get("/admin/simulacion/estado").get_json()
    assert estado["en_curso"] is False
    assert estado["hechas"] == estado["total"] == 1000
    assert estado["aciertos"] + estado["fallos"] == 1000
    assert estado["aciertos"] > estado["fallos"]  # tráfico 80/20: el caché ayuda


def test_simulacion_escaneo_expulsa_a_las_populares(admin):
    admin.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")
    admin.post("/admin/simular/escaneo")
    estado = admin.get("/admin/simulacion/estado").get_json()
    assert estado["fallos"] == 200                 # todas las claves son nuevas
    claves = [n["clave"] for n in admin.get("/estadisticas").get_json()["nodos"]]
    assert clave_de(-12.05, -77.04) not in claves  # Lima fue expulsada


def test_benchmark_sin_y_con_resultados(admin, app, tmp_path):
    assert admin.get("/admin/benchmark").status_code == 404
    (tmp_path / "resultados.json").write_text(json.dumps({"escenarios": []}), encoding="utf-8")
    (tmp_path / "latencia.png").write_bytes(b"\x89PNG")
    datos = admin.get("/admin/benchmark").get_json()
    assert "latencia" in datos["graficos"]
    assert admin.get(datos["graficos"]["latencia"]).status_code == 200


def test_ruta_inexistente_responde_json(cliente):
    r = cliente.get("/no-existe")
    assert r.status_code == 404 and "error" in r.get_json()


def test_paginas_cargan(cliente):
    assert cliente.get("/").status_code == 200
    assert cliente.get("/admin").status_code == 302  # sin sesión, al login


def test_calor_devuelve_una_temperatura_por_punto(cliente):
    r = cliente.get("/calor?puntos=-12.05,-77.04;-13.53,-71.97")
    assert r.status_code == 200
    temps = r.get_json()["temperaturas"]
    assert len(temps) == 2
    # Coincide con la temperatura de /clima en el mismo punto
    lima = cliente.get("/clima?lat=-12.05&lon=-77.04").get_json()
    assert temps[0] == lima["actual"]["temperatura"]


def test_calor_valida_puntos(cliente):
    assert cliente.get("/calor").status_code == 400
    assert cliente.get("/calor?puntos=abc").status_code == 400
    assert cliente.get("/calor?puntos=-12,500").status_code == 400
