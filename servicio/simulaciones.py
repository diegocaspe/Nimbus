"""Simulaciones de tráfico para el panel: "hora punta", "escaneo" y "cámara lenta".

Corren en un hilo en segundo plano y SIEMPRE usan el servicio SIMULADO
(nunca Open-Meteo), para no gastar su límite de consultas.
  - hora punta:   1000 consultas 80/20 a velocidad real ("rapida": 8 hilos
                  consultan EL MISMO caché a la vez; demuestra que CacheLRU es
                  seguro con concurrencia gracias a su threading.Lock).
  - escaneo:      200 lugares únicos (peor caso de LRU).
  - cámara lenta: 30 consultas 80/20, 1 por segundo, con pausa y reanudación.

Cada modo marca sus eventos con un origen distinto para que el panel sepa
cómo animarlos: "simulacion" (acelerado), "simulacion-lenta" y
"simulacion-paso" (consulta suelta del botón "Siguiente consulta").
"""

import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .lugares_peru import LUGARES_PERU
from .servicio_clima import clave_de

CONSULTAS_HORA_PUNTA = 1000
CONSULTAS_ESCANEO = 200
CONSULTAS_CAMARA_LENTA = 30
SEGUNDOS_CAMARA_LENTA = 1.0          # 1 consulta por segundo
HILOS = 8
VELOCIDADES = ("rapida", "presentacion")
SEGUNDOS_POR_CONSULTA_PRESENTACION = 0.5  # ≈ 2 consultas por segundo

ORIGEN_RAPIDO = "simulacion"
ORIGEN_LENTO = "simulacion-lenta"
ORIGEN_PASO = "simulacion-paso"


class SimulacionEnCurso(Exception):
    """Ya hay una simulación corriendo."""


def elegir_lugar_80_20(azar, lugares=LUGARES_PERU):
    """Un lugar: con 80 % de probabilidad sale del 20 % popular (los primeros)."""
    corte = max(1, len(lugares) // 5)
    populares, resto = lugares[:corte], lugares[corte:]
    return azar.choice(populares if azar.random() < 0.8 else resto)


def trafico_80_20(n, lugares=LUGARES_PERU, semilla=None):
    """n consultas con tráfico 80/20."""
    azar = random.Random(semilla)
    return [elegir_lugar_80_20(azar, lugares) for _ in range(n)]


def trafico_escaneo(n):
    """n lugares únicos (una cuadrícula sobre el Perú), todos con clave distinta.

    Simula a alguien que recorre el mapa punto por punto: cada consulta es
    nueva, así que LRU va expulsando a las ciudades populares aunque luego
    se vuelvan a pedir. Es el peor caso de LRU.
    """
    ocupadas = {clave_de(l[2], l[3]) for l in LUGARES_PERU}
    lugares, i = [], 0
    while len(lugares) < n:
        lat = round(-3.6 - (i // 20) * 0.7, 1)
        lon = round(-81.0 + (i % 20) * 0.6, 1)
        i += 1
        if clave_de(lat, lon) in ocupadas:
            continue
        ocupadas.add(clave_de(lat, lon))
        lugares.append((f"Punto {len(lugares) + 1}", "Escaneo", lat, lon))
    return lugares


class Simulacion:
    """Lanza una simulación y guarda su progreso (consultado por polling)."""

    def __init__(self):
        self._candado = threading.Lock()
        self._detener = threading.Event()  # bandera para cortar la simulación
        self._continuar = threading.Event()  # despejada = en pausa
        self._continuar.set()
        self._estado = self._estado_vacio()

    @staticmethod
    def _estado_vacio(tipo=None, total=0, velocidad="rapida"):
        return {"tipo": tipo, "velocidad": velocidad, "en_curso": False, "detenida": False, "pausada": False,
                "total": total, "hechas": 0, "aciertos": 0, "fallos": 0,
                "segundos": 0.0, "error": None}

    def estado(self):
        with self._candado:
            e = dict(self._estado)
        e["progreso"] = round(e["hechas"] / e["total"] * 100, 1) if e["total"] else 0.0
        return e

    def lanzar(self, nimbus, tipo, velocidad="rapida", semilla=None, esperar=False):
        """Empieza la simulación `tipo` ("hora_punta", "escaneo" o "camara_lenta").

        esperar=True la corre en el mismo hilo (útil en las pruebas).
        """
        if velocidad not in VELOCIDADES:
            raise ValueError("'velocidad' debe ser 'rapida' o 'presentacion'.")
        pausa = SEGUNDOS_POR_CONSULTA_PRESENTACION if velocidad == "presentacion" else 0
        origen = ORIGEN_RAPIDO
        if tipo == "hora_punta":
            lugares = trafico_80_20(CONSULTAS_HORA_PUNTA, semilla=semilla)
        elif tipo == "escaneo":
            lugares = trafico_escaneo(CONSULTAS_ESCANEO)
        elif tipo == "camara_lenta":
            lugares = trafico_80_20(CONSULTAS_CAMARA_LENTA, semilla=semilla)
            pausa, origen, velocidad = SEGUNDOS_CAMARA_LENTA, ORIGEN_LENTO, "lenta"
        else:
            raise ValueError(f"Simulación desconocida: {tipo}")

        with self._candado:
            if self._estado["en_curso"]:
                raise SimulacionEnCurso("Ya hay una simulación en curso.")
            self._estado = self._estado_vacio(tipo, len(lugares), velocidad)
            self._estado["en_curso"] = True
        self._detener.clear()
        self._continuar.set()

        hilo = threading.Thread(target=self._correr, args=(nimbus, lugares, pausa, origen), daemon=True)
        hilo.start()
        if esperar:
            hilo.join()
        return self.estado()

    def pausar(self):
        """Congela la simulación entre una consulta y la siguiente (cámara lenta)."""
        with self._candado:
            if self._estado["en_curso"]:
                self._continuar.clear()
                self._estado["pausada"] = True
        return self.estado()

    def reanudar(self):
        self._continuar.set()
        with self._candado:
            self._estado["pausada"] = False
        return self.estado()

    def detener(self):
        """Pide que la simulación en curso termine (las consultas pendientes se saltan)."""
        self._detener.set()
        self._continuar.set()  # si estaba en pausa, la despierta para que pueda terminar
        with self._candado:
            if self._estado["en_curso"]:
                self._estado["detenida"] = True
        return self.estado()

    def _correr(self, nimbus, lugares, pausa, origen):
        inicio = time.perf_counter()

        def una(lugar):
            while not self._continuar.wait(0.1):  # en pausa: espera sin gastar CPU
                if self._detener.is_set():
                    return
            if self._detener.is_set():
                return
            t0 = time.perf_counter()
            nombre, _, lat, lon = lugar
            # servicio=nimbus.simulado: las simulaciones NUNCA llaman a Open-Meteo
            r = nimbus.consultar_clima(lat, lon, nombre, servicio=nimbus.simulado,
                                       origen_consulta=origen)
            with self._candado:
                self._estado["hechas"] += 1
                self._estado["aciertos" if r["origen"] == "cache" else "fallos"] += 1
                self._estado["segundos"] = round(time.perf_counter() - inicio, 2)
            if pausa:
                # Completa la pausa entre consultas; wait() se corta al instante si piden detener
                self._detener.wait(max(0.0, pausa - (time.perf_counter() - t0)))

        try:
            with ThreadPoolExecutor(max_workers=1 if pausa else HILOS) as grupo:
                list(grupo.map(una, lugares))
        except Exception as e:  # no debería pasar con el servicio simulado
            with self._candado:
                self._estado["error"] = str(e)
        finally:
            with self._candado:
                self._estado["en_curso"] = False
                self._estado["segundos"] = round(time.perf_counter() - inicio, 2)
