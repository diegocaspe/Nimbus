"""Contenedor de todo el estado del servicio (nada en variables globales).

`crear_app` crea UNA instancia de Nimbus y la guarda en la app de Flask
(app.extensions["nimbus"]). Así cada app (y cada prueba) tiene su propio
caché, registro, simulación y dinámica, independientes entre sí.
"""

import random
import threading
import time
from datetime import datetime, timedelta, timezone

from cache import CacheLRU

from .servicio_clima import (ErrorServicioExterno, ServicioClimaReal,
                             ServicioClimaSimulado, clave_de)
from .simulaciones import ORIGEN_PASO, Simulacion, elegir_lugar_80_20

TAMANO_REGISTRO = 20
AVISO_API_CAIDA = "API no disponible: usando modo sin conexión"

# Lima está en UTC-5 todo el año (el Perú no usa horario de verano). Con un desfase
# fijo no hace falta el paquete tzdata, que Windows no trae para zoneinfo.
ZONA_LIMA = timezone(timedelta(hours=-5), "America/Lima")


def hora_lima():
    """Hora actual en Lima como "HH:MM:SS", sin importar la zona del servidor."""
    return datetime.now(ZONA_LIMA).strftime("%H:%M:%S")


class Nimbus:
    def __init__(self, capacidad=10, ttl_segundos=600, sin_conexion=False,
                 latencia_ms=300, costo_por_llamada=0.01,
                 servicio_real=None, servicio_simulado=None):
        self.cache = CacheLRU(capacidad, ttl_segundos)
        self.real = servicio_real or ServicioClimaReal()
        self.simulado = servicio_simulado or ServicioClimaSimulado(latencia_ms)
        self.sin_conexion = sin_conexion
        self.aviso_api = None   # {"mensaje", "detalle", "hora"} si se cambió solo al simulado
        self.costo_por_llamada = costo_por_llamada  # S/ supuestos por llamada a la API
        self.simulacion = Simulacion()
        self._registro = []
        self._candado_registro = threading.Lock()
        self._azar = random.Random()  # para el modo paso a paso
        # Tiempos de respuesta (tarjeta "con caché vs. sin caché") y dinámica con el público
        self._candado_metricas = threading.Lock()
        self._reiniciar_tiempos()
        self._lugares_vistos = set()  # claves ya consultadas: la primera vez es "pionera"
        self._dinamica = self._dinamica_vacia(activa=False)

    # ------------------------------------------------------------------
    # Servicio externo con respaldo automático
    # ------------------------------------------------------------------
    def servicio_activo(self):
        """El servicio simulado si está el modo sin conexión; si no, Open-Meteo."""
        return self.simulado if self.sin_conexion else self.real

    def _activar_respaldo(self, motivo):
        """Open-Meteo falló (sin internet, 429 por límite, 5xx…): todo pasa al simulado.

        El panel muestra el aviso hasta que el administrador vuelva a apagar
        el modo sin conexión.
        """
        self.sin_conexion = True
        self.aviso_api = {"mensaje": AVISO_API_CAIDA, "detalle": motivo,
                          "hora": hora_lima()}

    def _con_respaldo(self, operacion):
        """Llama `operacion(servicio)` con el servicio activo; si Open-Meteo falla, reintenta con el simulado."""
        servicio = self.servicio_activo()
        try:
            return operacion(servicio)
        except ErrorServicioExterno as e:
            if servicio is self.simulado:
                raise
            self._activar_respaldo(str(e))
            return operacion(self.simulado)

    # ------------------------------------------------------------------
    # Consultas
    # ------------------------------------------------------------------
    def consultar_clima(self, lat, lon, nombre="", servicio=None, origen_consulta="publico"):
        """Patrón cache-aside: primero el caché; si falla, la API y se guarda.

        Devuelve el clima con "origen" ("cache" o "api") y "tiempo_ms".
        `servicio` fuerza un servicio (las simulaciones pasan SIEMPRE el
        simulado: nunca llegan a Open-Meteo). Sin `servicio`, si Open-Meteo
        falla se cambia solo al simulado (ver _activar_respaldo).
        `origen_consulta` ("publico", "simulacion", "simulacion-lenta",
        "simulacion-paso") va a los eventos del caché y al registro.
        """
        inicio = time.perf_counter()
        clave = clave_de(lat, lon)
        etiqueta = nombre or clave
        datos = self.cache.obtener(clave, etiqueta, origen_consulta)
        if datos is not None:
            origen = "cache"
        else:
            t_api = time.perf_counter()
            if servicio is not None:
                datos = servicio.consultar(lat, lon, nombre)
            else:
                datos = self._con_respaldo(lambda s: s.consultar(lat, lon, nombre))
            tiempo_api_ms = round((time.perf_counter() - t_api) * 1000, 1)
            self.cache.guardar(clave, datos, etiqueta, origen_consulta, tiempo_api_ms)
            origen = "api"
        tiempo_ms = round((time.perf_counter() - inicio) * 1000, 2)

        respuesta = dict(datos)
        respuesta["nombre"] = nombre or datos.get("nombre") or clave
        respuesta.update({"clave": clave, "origen": origen, "tiempo_ms": tiempo_ms})
        self._medir(origen, tiempo_ms, origen_consulta)
        self._anotar(respuesta["nombre"], clave, origen, tiempo_ms, origen_consulta)
        return respuesta

    def paso(self):
        """Modo paso a paso: UNA consulta (lugar elegido con 80/20) a Open-Meteo REAL.

        Sin `servicio`: usa el servicio activo con respaldo, igual que el público.
        Si Open-Meteo falla o responde 429, pasa solo al simulado y deja el aviso.
        """
        nombre, _, lat, lon = elegir_lugar_80_20(self._azar)
        r = self.consultar_clima(lat, lon, nombre, origen_consulta=ORIGEN_PASO)
        return {"nombre": r["nombre"], "clave": r["clave"], "origen": r["origen"],
                "tiempo_ms": r["tiempo_ms"], "ultima": self.cache.ultima_secuencia}

    def eventos(self, desde=None):
        """Eventos del caché posteriores a `desde` + estado de la lista."""
        return self.cache.obtener_eventos(desde)

    def buscar(self, texto):
        return self._con_respaldo(lambda s: s.buscar(texto))

    def temperaturas(self, puntos):
        """Temperatura actual de muchos puntos (mapa de calor del Perú).

        No pasa por el caché LRU: es una sola llamada agrupada y no debe
        expulsar las consultas de clima que sí se cachean.
        """
        return self._con_respaldo(lambda s: s.temperaturas(puntos))

    def nombrar_lugar(self, lat, lon):
        """Nombre del lugar en (lat, lon) por geocodificación inversa, o None.

        No pasa por el caché LRU. Si el servicio real falla, se usa la lista
        local, pero el sistema NO pasa al modo sin conexión: el nombre viene de
        otro proveedor (Nominatim) y su falla no dice nada de Open-Meteo.
        """
        if not self.sin_conexion:
            nombrar = getattr(self.real, "nombrar", None)
            if nombrar is not None:
                try:
                    return nombrar(lat, lon)
                except ErrorServicioExterno:
                    pass
        return self.simulado.nombrar(lat, lon)

    def vaciar(self):
        """Borra SOLO los datos guardados en el caché. Métricas y registro no cambian."""
        self.cache.vaciar()

    def reiniciar_metricas(self):
        """Pone en cero las métricas, los tiempos con/sin caché y el registro.

        No toca los datos guardados ni la configuración (capacidad, TTL, modo…).
        """
        self.cache.reiniciar_metricas()
        with self._candado_metricas:
            self._reiniciar_tiempos()
            self._lugares_vistos = set()
        with self._candado_registro:
            self._registro = []

    # ------------------------------------------------------------------
    # Configuración
    # ------------------------------------------------------------------
    @property
    def latencia_ms(self):
        return self.simulado.latencia_ms

    @latencia_ms.setter
    def latencia_ms(self, valor):
        self.simulado.latencia_ms = valor

    def poner_sin_conexion(self, valor):
        """El administrador cambia el modo; al volver a Open-Meteo se borra el aviso."""
        self.sin_conexion = valor
        if not valor:
            self.aviso_api = None

    def configuracion(self):
        stats = self.cache.obtener_estadisticas()
        return {
            "capacidad": stats["capacidad"],
            "ttl": stats["ttl"],
            "sin_conexion": self.sin_conexion,
            "latencia_ms": self.latencia_ms,
            "aviso_api": self.aviso_api,
        }

    # ------------------------------------------------------------------
    # Tiempos: con caché vs. sin caché
    # ------------------------------------------------------------------
    def _reiniciar_tiempos(self):
        self._n_cache = 0
        self._ms_cache = 0.0   # tiempo real gastado en responder aciertos
        self._n_api = 0
        self._ms_api = 0.0     # tiempo gastado en las respuestas que fueron a la API

    def _medir(self, origen, tiempo_ms, origen_consulta):
        with self._candado_metricas:
            if origen == "cache":
                self._n_cache += 1
                self._ms_cache += tiempo_ms
            else:
                self._n_api += 1
                self._ms_api += tiempo_ms
            d = self._dinamica
            if d["activa"] and origen_consulta == "publico":
                d["consultas"] += 1
                if origen == "cache":
                    d["aciertos"] += 1
                    d["ms_cache"] += tiempo_ms

    def comparacion(self):
        """Promedios de respuesta desde caché y desde la API, y lo que ahorró el caché.

        veces_mas_rapido = promedio API ÷ promedio caché.
        ahorrado_ms = aciertos × promedio API − tiempo real gastado en aciertos
        (lo que habrían tardado esos aciertos si cada uno hubiera ido a la API).
        """
        with self._candado_metricas:
            prom_cache = self._ms_cache / self._n_cache if self._n_cache else None
            prom_api = self._ms_api / self._n_api if self._n_api else None
            veces = prom_api / prom_cache if prom_cache and prom_api else None
            ahorrado = (self._n_cache * prom_api - self._ms_cache) if prom_api is not None else 0.0
            return {
                "promedio_cache_ms": round(prom_cache, 3) if prom_cache is not None else None,
                "promedio_api_ms": round(prom_api, 1) if prom_api is not None else None,
                "veces_mas_rapido": round(veces, 1) if veces is not None else None,
                "ahorrado_ms": round(max(0.0, ahorrado), 1),
                "respuestas_cache": self._n_cache,
                "respuestas_api": self._n_api,
            }

    # ------------------------------------------------------------------
    # Dinámica con el público
    # ------------------------------------------------------------------
    @staticmethod
    def _dinamica_vacia(activa=True):
        return {"activa": activa, "inicio": hora_lima() if activa else None,
                "consultas": 0, "aciertos": 0, "ms_cache": 0.0}

    def iniciar_dinamica(self):
        """Pone en cero el "Resumen de la sala" y los lugares pioneros."""
        with self._candado_metricas:
            self._dinamica = self._dinamica_vacia()
            self._lugares_vistos = set()
        return self.resumen_dinamica()

    def resumen_dinamica(self):
        """Solo consultas del PÚBLICO desde "Iniciar dinámica" (las simulaciones no cuentan)."""
        prom_api = self.comparacion()["promedio_api_ms"]
        with self._candado_metricas:
            d = dict(self._dinamica)
        ahorrado = (d["aciertos"] * prom_api - d["ms_cache"]) if prom_api is not None else 0.0
        return {
            "activa": d["activa"],
            "inicio": d["inicio"],
            "consultas": d["consultas"],
            "aciertos": d["aciertos"],
            "llamadas_api_evitadas": d["aciertos"],
            "llamadas_api": d["consultas"] - d["aciertos"],
            "tasa_aciertos": round(d["aciertos"] / d["consultas"] * 100, 1) if d["consultas"] else 0.0,
            "ahorrado_ms": round(max(0.0, ahorrado), 1),
        }

    # ------------------------------------------------------------------
    # Estadísticas y registro
    # ------------------------------------------------------------------
    def estadisticas(self):
        """Métricas del caché + datos derivados + nodos de cabeza a cola."""
        stats = self.cache.obtener_estadisticas()
        # Cada acierto es una llamada a la API que no hubo que hacer
        stats["llamadas_api_evitadas"] = stats["aciertos"]
        stats["soles_ahorrados"] = round(stats["aciertos"] * self.costo_por_llamada, 2)
        stats["costo_por_llamada"] = self.costo_por_llamada
        stats["sin_conexion"] = self.sin_conexion
        stats["aviso_api"] = self.aviso_api
        stats["latencia_ms"] = self.latencia_ms
        stats["comparacion"] = self.comparacion()
        stats["nodos"] = self.cache.obtener_estado()
        return stats

    def _anotar(self, lugar, clave, origen, tiempo_ms, origen_consulta):
        with self._candado_metricas:
            pionera = origen == "api" and clave not in self._lugares_vistos
            self._lugares_vistos.add(clave)
        fila = {
            "hora": hora_lima(),
            "lugar": lugar,
            "clave": clave,
            "origen": origen,
            "tiempo_ms": tiempo_ms,
            "tipo": "publico" if origen_consulta == "publico" else "simulacion",
            "pionera": pionera,   # primera consulta de este lugar: la que fue a la API
        }
        with self._candado_registro:
            self._registro.append(fila)
            if len(self._registro) > TAMANO_REGISTRO:
                del self._registro[0]

    def registro(self):
        """Últimas consultas, de la más nueva a la más antigua."""
        with self._candado_registro:
            return list(reversed(self._registro))
