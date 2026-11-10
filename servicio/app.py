"""Servicio web Flask de Nimbus (RF-06) + rutas del panel de administrador.

Ejecutar:  python -m servicio.app   y abrir http://127.0.0.1:5000

`crear_app()` es una FÁBRICA: cada llamada crea una app nueva con su propio
estado (caché, registro, simulación) guardado en app.extensions["nimbus"].
No hay variables globales con estado: las pruebas crean apps independientes.
"""

import hmac
import json
import os
import secrets
from functools import wraps
from pathlib import Path

from flask import (Blueprint, Flask, current_app, jsonify, redirect,
                   render_template, request, send_from_directory, session,
                   url_for)
from werkzeug.exceptions import HTTPException

from .nucleo import Nimbus
from .servicio_clima import ErrorServicioExterno
from .simulaciones import SimulacionEnCurso

RAIZ = Path(__file__).resolve().parent.parent
PAGINAS = {"/", "/peru", "/login", "/logout", "/admin"}

rutas = Blueprint("nimbus", __name__)


def cargar_env(ruta=RAIZ / ".env"):
    """Lee un archivo .env (CLAVE=valor por línea) sin librerías extra.

    Las variables que ya existen en el entorno tienen prioridad. El .env no
    se sube a git: ver .env.example.
    """
    if not ruta.exists():
        return
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        os.environ.setdefault(clave.strip(), valor.strip().strip('"').strip("'"))


# ----------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------
def nimbus():
    """El contenedor de estado de la app que atiende la petición actual."""
    return current_app.extensions["nimbus"]


def error(mensaje, codigo=400):
    return jsonify({"ok": False, "error": mensaje}), codigo


def requiere_admin(vista):
    """Protege las rutas /admin/*: sin sesión responde 401 en JSON."""
    @wraps(vista)
    def envoltura(*args, **kwargs):
        if not session.get("admin"):
            return error("Inicia sesión como administrador.", 401)
        return vista(*args, **kwargs)
    return envoltura


def leer_numero(valor, nombre, minimo, maximo, entero=False):
    """Convierte y valida un número recibido; lanza ValueError con un mensaje claro."""
    try:
        if isinstance(valor, bool):
            raise ValueError
        numero = float(valor)
        if entero:
            if numero != int(numero):
                raise ValueError
            numero = int(numero)
    except (TypeError, ValueError):
        tipo = "un entero" if entero else "un número"
        raise ValueError(f"'{nombre}' debe ser {tipo}.") from None
    if not minimo <= numero <= maximo:
        raise ValueError(f"'{nombre}' debe estar entre {minimo} y {maximo}.")
    return numero


def cuerpo_json():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        raise ValueError("Envía un cuerpo JSON (Content-Type: application/json).")
    return datos


# ----------------------------------------------------------------------
# Páginas
# ----------------------------------------------------------------------
@rutas.get("/")
def inicio():
    return render_template("index.html", pagina="inicio")


@rutas.get("/peru")
def peru():
    return render_template("peru.html", pagina="inicio")


@rutas.get("/login")
def login():
    if session.get("admin"):
        return redirect(url_for("nimbus.admin"))
    return render_template("login.html", pagina="admin")


@rutas.get("/logout")
def logout():
    session.pop("admin", None)
    return redirect(url_for("nimbus.login"))


@rutas.get("/admin")
def admin():
    if not session.get("admin"):
        return redirect(url_for("nimbus.login"))
    return render_template("admin.html", pagina="admin")


# ----------------------------------------------------------------------
# Rutas obligatorias (RF-06)
# ----------------------------------------------------------------------
@rutas.get("/clima")
def clima():
    if "lat" not in request.args or "lon" not in request.args:
        return error("Faltan los parámetros 'lat' y 'lon'. Ejemplo: /clima?lat=-12.05&lon=-77.04")
    try:
        lat = leer_numero(request.args["lat"], "lat", -90, 90)
        lon = leer_numero(request.args["lon"], "lon", -180, 180)
    except ValueError as e:
        return error(str(e))
    nombre = request.args.get("nombre", "").strip()
    try:
        return jsonify(nimbus().consultar_clima(lat, lon, nombre))
    except ErrorServicioExterno as e:
        return error(str(e), 502)


@rutas.get("/estadisticas")
def estadisticas():
    return jsonify(nimbus().estadisticas())


@rutas.post("/vaciar")
def vaciar():
    """Borra solo los datos guardados; las métricas siguen (ver /admin/metricas/reiniciar)."""
    nimbus().vaciar()
    return jsonify({"ok": True, "mensaje": "Caché vaciado."})


@rutas.get("/lugar")
def lugar():
    """Geocodificación inversa: /lugar?lat=..&lon=.. -> {"nombre": "Manaos, Brasil" | null, ...}"""
    if "lat" not in request.args or "lon" not in request.args:
        return error("Faltan los parámetros 'lat' y 'lon'. Ejemplo: /lugar?lat=-3.1&lon=-60.0")
    try:
        lat = leer_numero(request.args["lat"], "lat", -90, 90)
        lon = leer_numero(request.args["lon"], "lon", -180, 180)
    except ValueError as e:
        return error(str(e))
    return jsonify({"nombre": nimbus().nombrar_lugar(lat, lon), "lat": lat, "lon": lon})


# ----------------------------------------------------------------------
# Búsqueda de lugares
# ----------------------------------------------------------------------
@rutas.get("/buscar")
def buscar():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"resultados": []})
    n = nimbus()
    try:
        return jsonify({"resultados": n.buscar(q)})
    except ErrorServicioExterno:
        # Sin internet: respondemos con la lista local para que la búsqueda siga funcionando
        return jsonify({"resultados": n.simulado.buscar(q),
                        "aviso": "Sin conexión con Open-Meteo: se muestran lugares locales."})


MAX_PUNTOS_CALOR = 250


@rutas.get("/calor")
def calor():
    """Mapa de calor: /calor?puntos=lat,lon;lat,lon;... -> {"temperaturas": [...]}"""
    texto = request.args.get("puntos", "").strip()
    if not texto:
        return error("Falta el parámetro 'puntos'. Ejemplo: /calor?puntos=-12.05,-77.04;-13.53,-71.97")
    partes = [p for p in texto.split(";") if p.strip()]
    if len(partes) > MAX_PUNTOS_CALOR:
        return error(f"Máximo {MAX_PUNTOS_CALOR} puntos por consulta.")
    puntos = []
    try:
        for p in partes:
            lat, lon = p.split(",")
            puntos.append((leer_numero(lat, "lat", -90, 90), leer_numero(lon, "lon", -180, 180)))
    except ValueError as e:
        msg = str(e) if str(e).startswith("'") else "Cada punto debe tener la forma lat,lon."
        return error(msg)
    try:
        return jsonify({"temperaturas": nimbus().temperaturas(puntos)})
    except ErrorServicioExterno as e:
        return error(str(e), 502)


# ----------------------------------------------------------------------
# Panel de administrador
# ----------------------------------------------------------------------
@rutas.post("/admin/login")
def admin_login():
    datos = request.get_json(silent=True) or request.form
    usuario = str(datos.get("usuario", ""))
    clave = str(datos.get("clave", ""))
    cfg = current_app.config
    # compare_digest compara en tiempo constante (evita ataques por tiempo)
    ok = (hmac.compare_digest(usuario, cfg["ADMIN_USUARIO"])
          and hmac.compare_digest(clave, cfg["ADMIN_CLAVE"]))
    if not ok:
        return error("Usuario o contraseña incorrectos.", 401)
    session["admin"] = True
    return jsonify({"ok": True})


@rutas.post("/admin/logout")
def admin_logout():
    session.pop("admin", None)
    return jsonify({"ok": True})


@rutas.route("/admin/configuracion", methods=["GET", "POST"])
@requiere_admin
def admin_configuracion():
    n = nimbus()
    if request.method == "GET":
        return jsonify(n.configuracion())
    try:
        datos = cuerpo_json()
        # Validamos TODO antes de aplicar, para no dejar cambios a medias
        cambios = {}
        if "capacidad" in datos:
            cambios["capacidad"] = leer_numero(datos["capacidad"], "capacidad", 1, 1000, entero=True)
        if "ttl" in datos:
            cambios["ttl"] = leer_numero(datos["ttl"], "ttl", 1, 86400)
        if "latencia_ms" in datos:
            cambios["latencia_ms"] = leer_numero(datos["latencia_ms"], "latencia_ms", 0, 5000, entero=True)
        if "sin_conexion" in datos:
            if not isinstance(datos["sin_conexion"], bool):
                raise ValueError("'sin_conexion' debe ser true o false.")
            cambios["sin_conexion"] = datos["sin_conexion"]
        if not cambios:
            raise ValueError("Nada que cambiar: envía capacidad, ttl, sin_conexion o latencia_ms.")
    except ValueError as e:
        return error(str(e))

    if "capacidad" in cambios:
        n.cache.cambiar_capacidad(cambios["capacidad"])
    if "ttl" in cambios:
        n.cache.cambiar_ttl(cambios["ttl"])
    if "latencia_ms" in cambios:
        n.latencia_ms = cambios["latencia_ms"]
    if "sin_conexion" in cambios:
        n.poner_sin_conexion(cambios["sin_conexion"])
    return jsonify({"ok": True, **n.configuracion()})


@rutas.get("/admin/registro")
@requiere_admin
def admin_registro():
    return jsonify({"consultas": nimbus().registro()})


@rutas.post("/admin/metricas/reiniciar")
@requiere_admin
def admin_metricas_reiniciar():
    """Pone en cero métricas, tiempos con/sin caché y registro; no toca datos ni configuración."""
    nimbus().reiniciar_metricas()
    return jsonify({"ok": True, "mensaje": "Métricas reiniciadas."})


def _lanzar(tipo):
    """Body JSON opcional: {"velocidad": "rapida" | "presentacion"} (por defecto rápida)."""
    n = nimbus()
    datos = request.get_json(silent=True) or {}
    velocidad = datos.get("velocidad", "rapida") if isinstance(datos, dict) else "rapida"
    try:
        estado = n.simulacion.lanzar(n, tipo, velocidad=velocidad,
                                     esperar=current_app.config["SIMULACION_SINCRONA"])
    except SimulacionEnCurso as e:
        return error(str(e), 409)
    except ValueError as e:
        return error(str(e))
    return jsonify({"ok": True, **estado}), 202


@rutas.post("/admin/simulacion/detener")
@requiere_admin
def admin_simulacion_detener():
    """Cancela la simulación en curso y responde cuando su hilo ya terminó."""
    return jsonify({"ok": True, **nimbus().simulacion.detener()})


@rutas.post("/admin/simulacion/pausar")
@requiere_admin
def admin_simulacion_pausar():
    return jsonify({"ok": True, **nimbus().simulacion.pausar()})


@rutas.post("/admin/simulacion/reanudar")
@requiere_admin
def admin_simulacion_reanudar():
    return jsonify({"ok": True, **nimbus().simulacion.reanudar()})


@rutas.get("/admin/eventos")
@requiere_admin
def admin_eventos():
    """Eventos del caché con secuencia > desde, más el estado actual de la lista.

    Sin `desde` solo devuelve el estado (el panel lo usa para empezar).
    """
    desde = request.args.get("desde")
    if desde is not None:
        try:
            desde = int(desde)
        except ValueError:
            return error("'desde' debe ser un número entero de secuencia.")
    return jsonify(nimbus().eventos(desde))


@rutas.post("/admin/paso")
@requiere_admin
def admin_paso():
    """Ejecuta UNA consulta (lugar elegido con 80/20) contra Open-Meteo real."""
    try:
        return jsonify({"ok": True, **nimbus().paso()})
    except ErrorServicioExterno as e:
        return error(str(e), 502)


@rutas.post("/admin/simular/hora-punta")
@requiere_admin
def admin_hora_punta():
    return _lanzar("hora_punta")


@rutas.post("/admin/simular/escaneo")
@requiere_admin
def admin_escaneo():
    return _lanzar("escaneo")


@rutas.post("/admin/simular/camara-lenta")
@requiere_admin
def admin_camara_lenta():
    """30 consultas 80/20 a 1 por segundo (se puede pausar y reanudar)."""
    return _lanzar("camara_lenta")


# ----------------------------------------------------------------------
# Dinámica con el público
# ----------------------------------------------------------------------
@rutas.post("/admin/dinamica/iniciar")
@requiere_admin
def admin_dinamica_iniciar():
    """Pone en cero el "Resumen de la sala" (y las consultas pioneras)."""
    return jsonify({"ok": True, **nimbus().iniciar_dinamica()})


@rutas.get("/admin/dinamica/resumen")
@requiere_admin
def admin_dinamica_resumen():
    """Solo consultas del público desde que se pulsó "Iniciar dinámica"."""
    return jsonify(nimbus().resumen_dinamica())


@rutas.get("/admin/simulacion/estado")
@requiere_admin
def admin_simulacion_estado():
    return jsonify(nimbus().simulacion.estado())


@rutas.get("/admin/benchmark")
@requiere_admin
def admin_benchmark():
    carpeta = Path(current_app.config["DIR_BENCHMARK"])
    archivo = carpeta / "resultados.json"
    if not archivo.exists():
        return error("Aún no hay resultados. Ejecuta: python -m benchmark.benchmark", 404)
    datos = json.loads(archivo.read_text(encoding="utf-8"))
    datos["graficos"] = {
        p.stem: url_for("nimbus.admin_benchmark_imagen", nombre=p.name)
        for p in sorted(carpeta.glob("*.png"))
    }
    return jsonify(datos)


@rutas.get("/admin/benchmark/imagen/<path:nombre>")
@requiere_admin
def admin_benchmark_imagen(nombre):
    # send_from_directory impide salir de la carpeta (../)
    return send_from_directory(current_app.config["DIR_BENCHMARK"], nombre)


# ----------------------------------------------------------------------
# Fábrica
# ----------------------------------------------------------------------
def crear_app(config=None):
    """Crea y configura una app Flask nueva con su propio estado."""
    app = Flask(
        __name__,
        template_folder=str(RAIZ / "frontend" / "templates"),
        static_folder=str(RAIZ / "frontend" / "static"),
    )
    cargar_env()
    app.config.update(
        # Sin credenciales en el código: vienen del entorno o del .env. Si faltan,
        # se generan al azar (la clave del administrador se muestra al arrancar).
        SECRET_KEY=os.environ.get("NIMBUS_SECRET") or secrets.token_hex(32),
        ADMIN_USUARIO=os.environ.get("NIMBUS_ADMIN_USER", "admin"),
        ADMIN_CLAVE=os.environ.get("NIMBUS_ADMIN_PASS") or secrets.token_urlsafe(12),
        CAPACIDAD=int(os.environ.get("NIMBUS_CAPACIDAD", 10)),   # = una capacidad del benchmark
        TTL=float(os.environ.get("NIMBUS_TTL", 600)),
        SIN_CONEXION=os.environ.get("NIMBUS_SIN_CONEXION", "0") == "1",
        LATENCIA_MS=int(os.environ.get("NIMBUS_LATENCIA_MS", 300)),
        COSTO_POR_LLAMADA=0.01,  # S/ supuestos por llamada a la API
        DIR_BENCHMARK=str(RAIZ / "benchmark" / "resultados"),
        SIMULACION_SINCRONA=False,  # True en pruebas: la simulación termina antes de responder
        SERVICIO_REAL=None,         # las pruebas pueden inyectar servicios falsos
        SERVICIO_SIMULADO=None,
    )
    if config:
        app.config.update(config)

    app.extensions["nimbus"] = Nimbus(
        capacidad=app.config["CAPACIDAD"],
        ttl_segundos=app.config["TTL"],
        sin_conexion=app.config["SIN_CONEXION"],
        latencia_ms=app.config["LATENCIA_MS"],
        costo_por_llamada=app.config["COSTO_POR_LLAMADA"],
        servicio_real=app.config["SERVICIO_REAL"],
        servicio_simulado=app.config["SERVICIO_SIMULADO"],
    )
    app.register_blueprint(rutas)

    @app.errorhandler(HTTPException)
    def error_http(e):
        # Las páginas muestran el error normal; las rutas de datos, JSON
        if request.path in PAGINAS or request.path.startswith("/static/"):
            return e
        return error(e.description, e.code)

    return app


if __name__ == "__main__":
    cargar_env()
    # Con debug=True Flask arranca dos procesos (el recargador y el servidor). Las claves
    # que falten se generan UNA vez aquí y pasan al otro proceso por el entorno.
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        os.environ.setdefault("NIMBUS_SECRET", secrets.token_hex(32))
        if not os.environ.get("NIMBUS_ADMIN_PASS"):
            os.environ["NIMBUS_ADMIN_PASS"] = secrets.token_urlsafe(12)
            print(f"\n  Sin NIMBUS_ADMIN_PASS: clave temporal del administrador -> "
                  f"usuario {os.environ.get('NIMBUS_ADMIN_USER', 'admin')}, clave {os.environ['NIMBUS_ADMIN_PASS']}\n"
                  f"  (para fijarla, copia .env.example a .env)\n")
    # threaded=True (por defecto) atiende varias peticiones a la vez
    crear_app().run(debug=True)
