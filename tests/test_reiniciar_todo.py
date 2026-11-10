"""Pruebas del reinicio completo del panel: POST /admin/reiniciar-todo («Vaciar todo»)."""

import json

from cache import CacheLRU
from servicio.app import crear_app
from servicio.servicio_clima import ServicioClimaSimulado

CLAVE = "clave-de-prueba"   # la que fija conftest.py


def crear(tmp_path, **extra):
    config = {
        "TESTING": True, "SECRET_KEY": "pruebas", "CAPACIDAD": 5, "TTL": 120, "SIN_CONEXION": True,
        "SERVICIO_SIMULADO": ServicioClimaSimulado(latencia_ms=0),
        "SIMULACION_SINCRONA": True, "DIR_BENCHMARK": str(tmp_path),
    }
    config.update(extra)
    app = crear_app(config)
    cliente = app.test_client()
    assert cliente.post("/admin/login", json={"usuario": "admin", "clave": CLAVE}).status_code == 200
    return app, cliente


def hacer_consultas(cliente):
    """Dinámica iniciada + consultas del público (aciertos, fallos, expulsiones) + una simulación."""
    cliente.post("/admin/dinamica/iniciar")
    for lat in (-12, -13, -14, -12, -13):
        cliente.get(f"/clima?lat={lat}&lon=-77&nombre=Lugar{lat}")
    assert cliente.post("/admin/simular/hora-punta").status_code == 202
    st = cliente.get("/estadisticas").get_json()
    assert st["tamano"] > 0 and st["aciertos"] > 0 and st["fallos"] > 0 and st["expulsiones"] > 0
    assert cliente.get("/admin/registro").get_json()["consultas"]
    assert cliente.get("/admin/dinamica/resumen").get_json()["consultas"] == 5


def test_reiniciar_todo_pide_login(tmp_path):
    cliente = crear_app({"TESTING": True, "DIR_BENCHMARK": str(tmp_path)}).test_client()
    r = cliente.post("/admin/reiniciar-todo")
    assert r.status_code == 401
    assert r.get_json()["ok"] is False


def test_reiniciar_todo_pone_todo_en_cero_y_conserva_la_configuracion(tmp_path):
    _, cliente = crear(tmp_path)
    cliente.post("/admin/configuracion", json={"capacidad": 4, "ttl": 90, "latencia_ms": 0})
    hacer_consultas(cliente)

    r = cliente.post("/admin/reiniciar-todo")
    assert r.status_code == 200
    cuerpo = r.get_json()
    assert cuerpo["ok"] is True and cuerpo["mensaje"] == "Todo reiniciado."

    # Caché vacío y métricas en cero
    st = cliente.get("/estadisticas").get_json()
    assert st["tamano"] == 0 and st["nodos"] == []
    assert (st["aciertos"], st["fallos"], st["tasa_aciertos"], st["expulsiones"], st["expirados"]) == (0, 0, 0.0, 0, 0)
    assert st["llamadas_api_evitadas"] == 0 and st["soles_ahorrados"] == 0
    c = st["comparacion"]
    assert (c["promedio_cache_ms"], c["promedio_api_ms"], c["veces_mas_rapido"]) == (None, None, None)
    assert (c["ahorrado_ms"], c["respuestas_cache"], c["respuestas_api"]) == (0, 0, 0)

    # Registro de consultas vacío
    assert cliente.get("/admin/registro").get_json()["consultas"] == []

    # Resumen de la sala en cero
    sala = cliente.get("/admin/dinamica/resumen").get_json()
    assert sala["activa"] is False and sala["inicio"] is None
    assert (sala["consultas"], sala["aciertos"], sala["llamadas_api_evitadas"], sala["llamadas_api"]) == (0, 0, 0, 0)
    assert sala["tasa_aciertos"] == 0 and sala["ahorrado_ms"] == 0

    # Eventos de la animación borrados y simulación sin progreso
    ev = cliente.get("/admin/eventos?desde=0").get_json()
    assert ev["eventos"] == [] and ev["ultima"] == 0 and ev["estado"] == []
    sim = cliente.get("/admin/simulacion/estado").get_json()
    assert sim["tipo"] is None and sim["en_curso"] is False and sim["hechas"] == 0

    # La configuración no cambia
    cfg = cliente.get("/admin/configuracion").get_json()
    assert (cfg["capacidad"], cfg["ttl"], cfg["sin_conexion"], cfg["latencia_ms"]) == (4, 90, True, 0)
    assert (st["capacidad"], st["ttl"]) == (4, 90)


def test_tras_reiniciar_todo_nada_reaparece_y_se_vuelve_a_contar_desde_cero(tmp_path):
    _, cliente = crear(tmp_path)
    hacer_consultas(cliente)
    cliente.post("/admin/reiniciar-todo")

    # "Recargar la página": nuevas lecturas siguen en cero
    for _ in range(2):
        assert cliente.get("/estadisticas").get_json()["aciertos"] == 0
        assert cliente.get("/admin/registro").get_json()["consultas"] == []

    # Una consulta nueva va a la API (el caché quedó vacío) y es "pionera" otra vez
    r = cliente.get("/clima?lat=-12&lon=-77&nombre=Lima").get_json()
    assert r["origen"] == "api"
    filas = cliente.get("/admin/registro").get_json()["consultas"]
    assert len(filas) == 1 and filas[0]["pionera"] is True
    st = cliente.get("/estadisticas").get_json()
    assert (st["aciertos"], st["fallos"], st["tamano"]) == (0, 1, 1)
    ev = cliente.get("/admin/eventos?desde=0").get_json()
    assert [e["secuencia"] for e in ev["eventos"]] == [1, 2]   # la secuencia empezó de nuevo


def test_reiniciar_todo_detiene_la_simulacion_en_curso(tmp_path):
    # Cámara lenta real (1 consulta por segundo) corriendo en otro hilo
    _, cliente = crear(tmp_path, SIMULACION_SINCRONA=False)
    assert cliente.post("/admin/simular/camara-lenta").status_code == 202
    assert cliente.get("/admin/simulacion/estado").get_json()["en_curso"] is True

    cliente.post("/admin/reiniciar-todo")
    sim = cliente.get("/admin/simulacion/estado").get_json()
    assert sim["en_curso"] is False and sim["tipo"] is None
    st = cliente.get("/estadisticas").get_json()
    assert st["tamano"] == 0 and st["aciertos"] == 0 and st["fallos"] == 0


def test_reiniciar_todo_no_borra_el_benchmark(tmp_path):
    (tmp_path / "resultados.json").write_text(json.dumps({"escenarios": []}), encoding="utf-8")
    _, cliente = crear(tmp_path)
    cliente.post("/admin/reiniciar-todo")
    assert cliente.get("/admin/benchmark").status_code == 200
    assert (tmp_path / "resultados.json").exists()


def test_reiniciar_metricas_sigue_sin_tocar_los_datos(tmp_path):
    _, cliente = crear(tmp_path)
    cliente.get("/clima?lat=-12&lon=-77&nombre=Lima")
    cliente.post("/admin/metricas/reiniciar")
    assert cliente.get("/estadisticas").get_json()["tamano"] == 1


def test_borrar_eventos_del_cache_no_toca_datos_ni_metricas():
    c = CacheLRU(3)
    c.guardar("a", 1, "A")
    c.obtener("a")
    c.borrar_eventos()
    ev = c.obtener_eventos(0)
    assert ev["eventos"] == [] and ev["ultima"] == 0
    assert len(c) == 1 and c.obtener_estadisticas()["aciertos"] == 1
    # Un panel que se quedó en una secuencia vieja debe resincronizarse
    assert c.obtener_eventos(5)["perdidos"] is True
