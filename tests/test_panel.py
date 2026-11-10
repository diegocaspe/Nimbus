"""Pruebas de lo que usa el panel: cámara lenta, pausa, dinámica, registro,
tiempos con/sin caché, respaldo ante fallas de Open-Meteo y valores por defecto."""

import time

import pytest

from benchmark import benchmark
from servicio import simulaciones
from servicio.app import crear_app
from servicio.nucleo import AVISO_API_CAIDA, Nimbus
from servicio.servicio_clima import (ErrorServicioExterno, ServicioClimaReal,
                                     ServicioClimaSimulado)


class ServicioRealContado:
    """Open-Meteo falso que cuenta cuántas veces lo llaman."""

    def __init__(self):
        self.llamadas = 0

    def consultar(self, lat, lon, nombre=""):
        self.llamadas += 1
        return ServicioClimaSimulado(0).consultar(lat, lon, nombre)

    def buscar(self, texto):
        self.llamadas += 1
        return []


class ServicioReal429:
    """Open-Meteo falso que siempre responde "límite superado"."""

    def consultar(self, lat, lon, nombre=""):
        raise ErrorServicioExterno("Open-Meteo respondió 429: se superó el límite de consultas.")

    def buscar(self, texto):
        raise ErrorServicioExterno("429")


def crear(tmp_path, **extra):
    config = {
        "TESTING": True, "SECRET_KEY": "pruebas", "CAPACIDAD": 10, "SIN_CONEXION": True,
        "SERVICIO_SIMULADO": ServicioClimaSimulado(latencia_ms=0),
        "SIMULACION_SINCRONA": True, "DIR_BENCHMARK": str(tmp_path),
    }
    config.update(extra)
    app = crear_app(config)
    cliente = app.test_client()
    cliente.post("/admin/login", json={"usuario": "admin", "clave": "clave-de-prueba"})
    return app, cliente


@pytest.fixture
def sin_pausas(monkeypatch):
    """La cámara lenta espera 1 s entre consultas: en las pruebas, nada."""
    monkeypatch.setattr(simulaciones, "SEGUNDOS_CAMARA_LENTA", 0)


# ----------------------------------------------------------------------
# Rutas protegidas
# ----------------------------------------------------------------------
def test_rutas_nuevas_piden_login(tmp_path):
    cliente = crear_app({"TESTING": True, "DIR_BENCHMARK": str(tmp_path)}).test_client()
    for metodo, ruta in [("post", "/admin/simular/camara-lenta"), ("post", "/admin/simulacion/pausar"),
                         ("post", "/admin/simulacion/reanudar"), ("post", "/admin/dinamica/iniciar"),
                         ("get", "/admin/dinamica/resumen"), ("post", "/admin/paso"),
                         ("get", "/admin/eventos"), ("post", "/admin/metricas/reiniciar")]:
        assert getattr(cliente, metodo)(ruta).status_code == 401, ruta


# ----------------------------------------------------------------------
# Cámara lenta, pausa y reanudación
# ----------------------------------------------------------------------
def test_camara_lenta_30_consultas_con_su_origen(tmp_path, sin_pausas):
    _, cliente = crear(tmp_path)
    r = cliente.post("/admin/simular/camara-lenta")
    assert r.status_code == 202
    estado = cliente.get("/admin/simulacion/estado").get_json()
    assert estado["tipo"] == "camara_lenta" and estado["hechas"] == estado["total"] == 30
    eventos = cliente.get("/admin/eventos?desde=0").get_json()["eventos"]
    assert eventos and all(e["origen"] == "simulacion-lenta" for e in eventos)


def test_pausar_y_reanudar(monkeypatch):
    monkeypatch.setattr(simulaciones, "SEGUNDOS_CAMARA_LENTA", 0.05)
    n = Nimbus(capacidad=5, sin_conexion=True, servicio_simulado=ServicioClimaSimulado(0))
    n.simulacion.lanzar(n, "camara_lenta")
    time.sleep(0.12)
    pausado = n.simulacion.pausar()
    assert pausado["pausada"] is True
    time.sleep(0.15)                       # deja terminar la consulta que estaba en curso
    hechas = n.simulacion.estado()["hechas"]
    time.sleep(0.3)
    assert n.simulacion.estado()["hechas"] == hechas   # en pausa no avanza
    assert n.simulacion.reanudar()["pausada"] is False
    for _ in range(100):                   # 30 × 0.05 s ≈ 1.5 s como máximo
        if not n.simulacion.estado()["en_curso"]:
            break
        time.sleep(0.05)
    assert n.simulacion.estado()["hechas"] == 30


def test_detener_despierta_una_simulacion_en_pausa(monkeypatch):
    monkeypatch.setattr(simulaciones, "SEGUNDOS_CAMARA_LENTA", 0.05)
    n = Nimbus(capacidad=5, sin_conexion=True, servicio_simulado=ServicioClimaSimulado(0))
    n.simulacion.lanzar(n, "camara_lenta")
    n.simulacion.pausar()
    n.simulacion.detener()
    for _ in range(40):
        if not n.simulacion.estado()["en_curso"]:
            break
        time.sleep(0.05)
    assert n.simulacion.estado()["en_curso"] is False


# ----------------------------------------------------------------------
# Qué servicio usa cada botón (Open-Meteo falso: nunca se sale a internet)
# ----------------------------------------------------------------------
def test_hora_punta_y_escaneo_nunca_usan_open_meteo(tmp_path):
    real = ServicioRealContado()
    app, cliente = crear(tmp_path, SIN_CONEXION=False, SERVICIO_REAL=real)
    assert cliente.post("/admin/simular/hora-punta").status_code == 202
    assert cliente.post("/admin/simular/escaneo").status_code == 202
    assert real.llamadas == 0
    # El público sí usa Open-Meteo (Madrid: ningún tráfico simulado lo consulta, así que no está en el caché)
    cliente.get("/clima?lat=40.42&lon=-3.70&nombre=Madrid")
    assert real.llamadas == 1


def test_siguiente_consulta_usa_open_meteo_real(tmp_path):
    real = ServicioRealContado()
    app, cliente = crear(tmp_path, SIN_CONEXION=False, SERVICIO_REAL=real)
    r = cliente.post("/admin/paso").get_json()
    assert r["ok"] and r["origen"] == "api"      # caché vacío: fallo, va a la API
    assert real.llamadas == 1                    # ...y la API es Open-Meteo (el falso), no el simulado
    assert app.extensions["nimbus"].sin_conexion is False
    eventos = cliente.get("/admin/eventos?desde=0").get_json()["eventos"]
    assert all(e["origen"] == "simulacion-paso" for e in eventos)  # el panel lo sigue animando lento


def test_camara_lenta_usa_open_meteo_real(tmp_path, sin_pausas):
    real = ServicioRealContado()
    app, cliente = crear(tmp_path, SIN_CONEXION=False, SERVICIO_REAL=real)
    assert cliente.post("/admin/simular/camara-lenta").status_code == 202
    estado = cliente.get("/admin/simulacion/estado").get_json()
    assert estado["hechas"] == 30 and estado["error"] is None
    assert real.llamadas == estado["fallos"] > 0  # cada fallo fue una llamada a Open-Meteo


def test_siguiente_consulta_con_open_meteo_caido_usa_el_respaldo(tmp_path):
    app, cliente = crear(tmp_path, SIN_CONEXION=False, SERVICIO_REAL=ServicioReal429())
    r = cliente.post("/admin/paso")
    assert r.status_code == 200 and r.get_json()["origen"] == "api"
    cfg = cliente.get("/admin/configuracion").get_json()
    assert cfg["sin_conexion"] is True and cfg["aviso_api"]["mensaje"] == AVISO_API_CAIDA


# ----------------------------------------------------------------------
# Detener la simulación y vaciar (botón "Vaciar caché" de la fila de simulaciones)
# ----------------------------------------------------------------------
def test_detener_simulacion_en_curso_y_vaciar_deja_el_cache_en_cero(tmp_path, monkeypatch):
    monkeypatch.setattr(simulaciones, "SEGUNDOS_CAMARA_LENTA", 0.05)
    _, cliente = crear(tmp_path, SIMULACION_SINCRONA=False)      # corre de verdad en otro hilo
    assert cliente.post("/admin/simular/camara-lenta").status_code == 202
    time.sleep(0.2)
    r = cliente.post("/admin/simulacion/detener").get_json()
    assert r["ok"] and r["en_curso"] is False and r["detenida"] is True  # ya terminó al responder
    assert r["hechas"] < r["total"]
    assert cliente.post("/vaciar").get_json()["ok"] is True
    time.sleep(0.15)                                             # nada sigue guardando datos
    assert cliente.get("/estadisticas").get_json()["tamano"] == 0
    # Y se puede lanzar otra simulación enseguida
    assert cliente.post("/admin/simular/camara-lenta").status_code == 202
    cliente.post("/admin/simulacion/detener")


def test_detener_pide_login(tmp_path):
    cliente = crear_app({"TESTING": True, "DIR_BENCHMARK": str(tmp_path)}).test_client()
    assert cliente.post("/admin/simulacion/detener").status_code == 401


def test_429_cambia_al_simulado_y_avisa(tmp_path):
    app, cliente = crear(tmp_path, SIN_CONEXION=False, SERVICIO_REAL=ServicioReal429())
    r = cliente.get("/clima?lat=-13.53&lon=-71.97&nombre=Cusco")
    assert r.status_code == 200
    cfg = cliente.get("/admin/configuracion").get_json()
    assert cfg["sin_conexion"] is True
    assert cfg["aviso_api"]["mensaje"] == AVISO_API_CAIDA and "429" in cfg["aviso_api"]["detalle"]
    # Al volver a encender Open-Meteo desde el panel se borra el aviso
    cfg = cliente.post("/admin/configuracion", json={"sin_conexion": False}).get_json()
    assert cfg["sin_conexion"] is False and cfg["aviso_api"] is None


def test_servicio_real_traduce_429():
    class Respuesta:
        status_code = 429

    class Sesion:
        def get(self, *a, **k):
            return Respuesta()

    with pytest.raises(ErrorServicioExterno, match="429"):
        ServicioClimaReal(sesion=Sesion()).consultar(-12, -77)


# ----------------------------------------------------------------------
# Tiempos: con caché vs. sin caché
# ----------------------------------------------------------------------
def test_comparacion_con_y_sin_cache(tmp_path):
    _, cliente = crear(tmp_path, SERVICIO_SIMULADO=ServicioClimaSimulado(latencia_ms=20))
    c = cliente.get("/estadisticas").get_json()["comparacion"]
    assert c["promedio_api_ms"] is None and c["ahorrado_ms"] == 0
    cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")     # API (~20 ms)
    for _ in range(3):
        cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")  # caché
    c = cliente.get("/estadisticas").get_json()["comparacion"]
    assert c["respuestas_api"] == 1 and c["respuestas_cache"] == 3
    assert c["promedio_api_ms"] >= 20
    assert c["veces_mas_rapido"] > 1
    assert c["ahorrado_ms"] == pytest.approx(3 * c["promedio_api_ms"] - 3 * c["promedio_cache_ms"], abs=1)
    cliente.post("/vaciar")             # vaciar borra los datos, no los tiempos
    assert cliente.get("/estadisticas").get_json()["comparacion"]["respuestas_cache"] == 3
    assert cliente.post("/admin/metricas/reiniciar").get_json()["ok"] is True
    c = cliente.get("/estadisticas").get_json()["comparacion"]
    assert c["respuestas_cache"] == c["respuestas_api"] == 0 and c["ahorrado_ms"] == 0
    assert c["promedio_api_ms"] is None


# ----------------------------------------------------------------------
# Dinámica con el público y registro
# ----------------------------------------------------------------------
def test_dinamica_cuenta_solo_al_publico(tmp_path):
    _, cliente = crear(tmp_path)
    cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")       # antes de iniciar: no cuenta
    assert cliente.get("/admin/dinamica/resumen").get_json()["activa"] is False
    r = cliente.post("/admin/dinamica/iniciar").get_json()
    assert r["ok"] and r["activa"] and r["consultas"] == 0
    cliente.get("/clima?lat=-13.53&lon=-71.97&nombre=Cusco")      # API
    cliente.get("/clima?lat=-13.53&lon=-71.97&nombre=Cusco")      # caché
    cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")       # caché
    cliente.post("/admin/paso")                                    # simulación: no cuenta
    s = cliente.get("/admin/dinamica/resumen").get_json()
    assert (s["consultas"], s["aciertos"], s["llamadas_api_evitadas"], s["llamadas_api"]) == (3, 2, 2, 1)
    assert s["tasa_aciertos"] == pytest.approx(66.7)
    assert s["ahorrado_ms"] >= 0
    # Reiniciar vuelve a cero
    assert cliente.post("/admin/dinamica/iniciar").get_json()["consultas"] == 0


def test_registro_marca_pionera_y_tipo(tmp_path):
    _, cliente = crear(tmp_path)
    cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")
    cliente.get("/clima?lat=-12.05&lon=-77.04&nombre=Lima")
    cliente.post("/admin/paso")
    paso, segunda, primera = cliente.get("/admin/registro").get_json()["consultas"][:3]
    assert primera["pionera"] is True and primera["tipo"] == "publico" and primera["origen"] == "api"
    assert segunda["pionera"] is False and segunda["origen"] == "cache"
    assert paso["tipo"] == "simulacion"


# ----------------------------------------------------------------------
# Valores por defecto y benchmark
# ----------------------------------------------------------------------
def test_capacidad_10_y_ttl_600_por_defecto(tmp_path, monkeypatch):
    monkeypatch.delenv("NIMBUS_CAPACIDAD", raising=False)
    monkeypatch.delenv("NIMBUS_TTL", raising=False)
    app = crear_app({"TESTING": True, "DIR_BENCHMARK": str(tmp_path)})
    st = app.extensions["nimbus"].cache.obtener_estadisticas()
    assert (st["capacidad"], st["ttl"]) == (10, 600)
    assert 10 in benchmark.CAPACIDADES        # coincide con una capacidad del benchmark


def test_benchmark_compara_las_capacidades_y_tamanos_pedidos():
    assert benchmark.CAPACIDADES == [5, 10, 20, 50]
    assert benchmark.TAMANOS_COMPLEJIDAD == [10, 100, 1_000, 10_000, 100_000]
    assert benchmark.OPERACIONES_COMPLEJIDAD == 10_000
