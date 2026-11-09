"""Servicios externos de clima: el real (Open-Meteo) y el simulado (RF-07).

Ambos tienen la MISMA interfaz, así el resto del programa no sabe cuál usa:
    consultar(lat, lon, nombre) -> dict con "nombre", "lat", "lon", "actual", "pronostico"
    buscar(texto)               -> lista de {"nombre", "detalle", "lat", "lon"}
"""

import random
import time
import unicodedata
import zlib
from datetime import date, timedelta

import requests

from .lugares_peru import LUGARES_PERU

URL_PRONOSTICO = "https://api.open-meteo.com/v1/forecast"
URL_GEOCODIFICACION = "https://geocoding-api.open-meteo.com/v1/search"
DIAS_PRONOSTICO = 5


class ErrorServicioExterno(Exception):
    """El servicio de clima no respondió o respondió algo inesperado."""


def clave_de(lat, lon):
    """Clave del caché para unas coordenadas: latitud y longitud con 1 decimal.

    Decisión de diseño: redondeamos a 0.1° (≈ 11 km) para que clics cercanos
    en el mapa (por ejemplo, dos puntos de Lima) compartan la misma entrada
    del caché. Sin redondeo, cada clic sería una clave distinta y la tasa de
    aciertos sería casi 0. A esa escala el clima prácticamente no cambia.
    Se suma 0.0 para que -0.0 se escriba "0.0".
    """
    return f"{round(lat, 1) + 0.0:.1f},{round(lon, 1) + 0.0:.1f}"


def sin_tildes(texto):
    """'Huánuco' -> 'huanuco' (para buscar sin importar tildes ni mayúsculas)."""
    normal = unicodedata.normalize("NFD", texto)
    return "".join(c for c in normal if unicodedata.category(c) != "Mn").lower()


def buscar_local(texto, limite=7):
    """Busca en la lista local de lugares del Perú (no necesita internet)."""
    q = sin_tildes(texto.strip())
    if not q:
        return []
    empiezan, contienen = [], []
    for nombre, detalle, lat, lon in LUGARES_PERU:
        n = sin_tildes(nombre)
        if q in n:
            lugar = {"nombre": nombre, "detalle": detalle, "lat": lat, "lon": lon}
            (empiezan if n.startswith(q) else contienen).append(lugar)
    return (empiezan + contienen)[:limite]


# ----------------------------------------------------------------------
# Servicio real: Open-Meteo
# ----------------------------------------------------------------------
class ServicioClimaReal:
    """Consulta Open-Meteo por internet (gratuito, sin clave)."""

    def __init__(self, timeout_s=8, sesion=None):
        self.timeout_s = timeout_s
        self.sesion = sesion or requests.Session()

    def _pedir(self, url, parametros):
        try:
            resp = self.sesion.get(url, params=parametros, timeout=self.timeout_s)
            if resp.status_code == 429:
                raise ErrorServicioExterno("Open-Meteo respondió 429: se superó el límite de consultas.")
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            raise ErrorServicioExterno(
                "No se pudo contactar a Open-Meteo. Revisa tu conexión o activa el modo sin conexión."
            ) from e

    def consultar(self, lat, lon, nombre=""):
        datos = self._pedir(URL_PRONOSTICO, {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": DIAS_PRONOSTICO + 1,  # hoy + 5 días
            "timezone": "auto",
        })
        try:
            actual = datos["current"]
            diario = datos["daily"]
            pronostico = [
                {
                    "fecha": diario["time"][i],
                    "max": diario["temperature_2m_max"][i],
                    "min": diario["temperature_2m_min"][i],
                    "codigo": diario["weather_code"][i],
                }
                for i in range(1, DIAS_PRONOSTICO + 1)
            ]
            return {
                "nombre": nombre,
                "lat": lat,
                "lon": lon,
                "actual": {
                    "temperatura": actual["temperature_2m"],
                    "sensacion_termica": actual["apparent_temperature"],
                    "humedad": actual["relative_humidity_2m"],
                    "viento_kmh": actual["wind_speed_10m"],
                    "prob_lluvia": diario["precipitation_probability_max"][0] or 0,
                    "codigo": actual["weather_code"],
                },
                "pronostico": pronostico,
            }
        except (KeyError, IndexError, TypeError) as e:
            raise ErrorServicioExterno("Open-Meteo respondió con un formato inesperado.") from e

    def temperaturas(self, puntos):
        """Temperatura actual de varios puntos [(lat, lon), ...] en UNA sola llamada.

        Open-Meteo acepta listas separadas por comas y responde una lista
        (o un objeto si solo hay un punto).
        """
        datos = self._pedir(URL_PRONOSTICO, {
            "latitude": ",".join(f"{lat:.3f}" for lat, _ in puntos),
            "longitude": ",".join(f"{lon:.3f}" for _, lon in puntos),
            "current": "temperature_2m",
            "timezone": "auto",
        })
        if isinstance(datos, dict):
            datos = [datos]
        try:
            return [d["current"]["temperature_2m"] for d in datos]
        except (KeyError, TypeError) as e:
            raise ErrorServicioExterno("Open-Meteo respondió con un formato inesperado.") from e

    def buscar(self, texto, limite=7):
        datos = self._pedir(URL_GEOCODIFICACION, {
            "name": texto, "count": limite, "language": "es", "format": "json",
        })
        resultados = []
        for r in datos.get("results", []) or []:
            partes = [p for p in (r.get("admin1"), r.get("country")) if p]
            resultados.append({
                "nombre": r["name"],
                "detalle": " · ".join(partes),
                "lat": r["latitude"],
                "lon": r["longitude"],
            })
        return resultados


# ----------------------------------------------------------------------
# Servicio simulado (modo sin conexión, RF-07)
# ----------------------------------------------------------------------
CODIGOS_WMO = [0, 1, 2, 3, 3, 45, 61, 80]


class ServicioClimaSimulado:
    """Inventa un clima coherente y espera `latencia_ms` para imitar la red.

    Los datos dependen solo de la clave (coordenadas redondeadas), así el
    mismo lugar siempre da el mismo clima: parece real y es reproducible.
    """

    def __init__(self, latencia_ms=300):
        self.latencia_ms = latencia_ms

    def _esperar(self):
        if self.latencia_ms > 0:
            time.sleep(self.latencia_ms / 1000)

    def consultar(self, lat, lon, nombre=""):
        self._esperar()
        # Semilla estable a partir de la clave (crc32 no cambia entre ejecuciones)
        azar = random.Random(zlib.crc32(clave_de(lat, lon).encode()))
        # Más calor cerca del ecuador, más frío al alejarse
        temp = 27 - abs(lat) * 0.35 + azar.uniform(-6, 4)
        humedad = azar.randint(38, 90)
        codigo = azar.choice(CODIGOS_WMO)
        lluvioso = codigo >= 51
        hoy = date.today()
        pronostico = []
        for i in range(1, DIAS_PRONOSTICO + 1):
            maxima = temp + azar.uniform(-2, 4)
            pronostico.append({
                "fecha": (hoy + timedelta(days=i)).isoformat(),
                "max": round(maxima, 1),
                "min": round(maxima - azar.uniform(5, 11), 1),
                "codigo": azar.choice(CODIGOS_WMO),
            })
        return {
            "nombre": nombre,
            "lat": lat,
            "lon": lon,
            "actual": {
                "temperatura": round(temp, 1),
                "sensacion_termica": round(temp + (1 if humedad > 70 else -1) * azar.uniform(0, 3), 1),
                "humedad": humedad,
                "viento_kmh": round(azar.uniform(5, 30), 1),
                "prob_lluvia": azar.randint(60, 90) if lluvioso else azar.randint(0, 35),
                "codigo": codigo,
            },
            "pronostico": pronostico,
        }

    def temperaturas(self, puntos):
        """Misma temperatura que daría consultar() en cada punto (una sola espera)."""
        self._esperar()
        return [
            round(27 - abs(lat) * 0.35 + random.Random(zlib.crc32(clave_de(lat, lon).encode())).uniform(-6, 4), 1)
            for lat, lon in puntos
        ]

    def buscar(self, texto, limite=7):
        return buscar_local(texto, limite)
