"""Caché LRU (Least Recently Used) con expiración por tiempo (TTL).

Estructura compuesta:
  - self._mapa: dict clave -> Nodo. Encuentra el nodo de una clave en O(1)
    promedio (tabla hash).
  - self._lista: ListaDoble con el orden de uso. Cabeza = más reciente,
    cola = menos reciente. Mover o quitar un nodo es O(1) porque el dict
    ya nos dio el nodo y la lista doble no necesita recorrerse.

Juntas logran obtener y guardar en O(1) promedio, sin importar la capacidad.

Además lleva un REGISTRO DE EVENTOS (acierto, fallo, inserción, expulsión…)
para que el panel pueda reproducir con animaciones lo que pasó. Anotar un
evento es O(1) amortizado, así que no cambia la complejidad de nada.
"""

import bisect
import threading
import time

from .lista_doble import ListaDoble
from .nodo import Entrada, Nodo

MAX_EVENTOS = 500


class CacheLRU:
    def __init__(self, capacidad, ttl_segundos=60, reloj=time.monotonic, max_eventos=MAX_EVENTOS):
        """Crea el caché vacío. O(1).

        capacidad:    máximo de entradas (RF-01). Debe ser >= 1.
        ttl_segundos: tiempo de vida de cada entrada (RF-04).
        reloj:        función que devuelve "ahora" en segundos. Por defecto
                      time.monotonic (no retrocede si cambia la hora del
                      sistema). Las pruebas inyectan un reloj falso para
                      simular el paso del tiempo sin dormir.
        max_eventos:  cuántos eventos recientes se conservan como mínimo.
        """
        self._validar_capacidad(capacidad)
        self._validar_ttl(ttl_segundos)
        self._capacidad = int(capacidad)
        self._ttl = float(ttl_segundos)
        self._reloj = reloj
        self._mapa = {}             # clave -> Nodo
        self._lista = ListaDoble()  # orden de uso
        # Flask atiende peticiones en varios hilos (y las simulaciones corren
        # en otro). Sin candado, dos hilos podrían reenlazar nodos a la vez y
        # romper la lista. Cada operación pública toma el candado.
        self._candado = threading.Lock()
        self._max_eventos = max_eventos
        self._eventos = []          # lista simple, ordenada por secuencia
        self._secuencia = 0         # número del último evento anotado
        self._reiniciar_metricas()

    # ------------------------------------------------------------------
    # Operaciones principales
    # ------------------------------------------------------------------
    def obtener(self, clave, nombre="", origen="publico"):
        """Devuelve el valor de `clave` o None si no está (o venció).

        O(1) promedio:
          - buscar en el dict: O(1) promedio (hash).
          - si venció: eliminar_nodo + borrar del dict: O(1).
          - si es válida: mover_al_inicio: O(1).
        Leer cuenta como usar (RF-03), por eso el nodo pasa a la cabeza.
        La expiración es "perezosa": solo se revisa aquí, al leer.
        `nombre` y `origen` solo sirven para el registro de eventos.
        """
        inicio = time.perf_counter()
        with self._candado:
            nodo = self._mapa.get(clave)
            if nodo is None:
                self._fallos += 1
                self._anotar("fallo", clave, nombre, origen)
                return None
            entrada = nodo.dato
            if self._vencio(entrada):
                # Una entrada vencida se comporta como si no existiera (RF-04).
                self._quitar(nodo)
                self._fallos += 1
                self._expirados += 1
                self._anotar("expirado", clave, entrada.nombre or nombre, origen)
                self._anotar("fallo", clave, nombre or entrada.nombre, origen)
                return None
            self._lista.mover_al_inicio(nodo)
            self._aciertos += 1
            entrada.usos += 1
            self._anotar("acierto", clave, entrada.nombre or nombre, origen, usos=entrada.usos,
                         tiempo_ms=round((time.perf_counter() - inicio) * 1000, 4))
            return entrada.valor

    def guardar(self, clave, valor, nombre="", origen="publico", tiempo_api_ms=None):
        """Guarda o actualiza `clave` y la deja como la más reciente.

        O(1) promedio:
          - Si ya existe: se actualiza el valor, se renueva el TTL y se mueve
            a la cabeza (no se duplica).
          - Si es nueva y el caché está lleno: se expulsa el nodo de la cola
            (el menos recientemente usado, RF-03) y su clave del dict.
          - Se crea el nodo y se inserta al inicio.
        Todo son accesos al dict y reenlaces de punteros: O(1).
        `tiempo_api_ms` (cuánto tardó la API) solo va al registro de eventos.
        """
        with self._candado:
            expira_en = self._reloj() + self._ttl
            nodo = self._mapa.get(clave)
            if nodo is not None:
                entrada = nodo.dato
                entrada.valor = valor
                entrada.expira_en = expira_en
                if nombre:
                    entrada.nombre = nombre
                self._lista.mover_al_inicio(nodo)
                self._anotar("actualizacion", clave, entrada.nombre, origen, ttl=self._ttl)
                return
            if len(self._mapa) >= self._capacidad:
                self._expulsar_cola(origen)
            nodo = Nodo(Entrada(clave, valor, expira_en, nombre))
            self._lista.insertar_al_inicio(nodo)
            self._mapa[clave] = nodo
            self._anotar("insercion", clave, nombre, origen, ttl=self._ttl, tiempo_api_ms=tiempo_api_ms)

    def eliminar(self, clave):
        """Borra `clave` si existe. Devuelve True si la borró. O(1) promedio."""
        with self._candado:
            nodo = self._mapa.get(clave)
            if nodo is None:
                return False
            self._quitar(nodo)
            self._anotar("eliminacion", clave, nodo.dato.nombre, "admin")
            return True

    def vaciar(self):
        """Borra todas las entradas guardadas. Las métricas NO cambian.

        O(1) para nosotros: creamos un dict y una lista nuevos; los nodos
        viejos los libera el recolector de basura de Python. El registro de
        eventos NO se borra: el panel necesita ver el evento "vaciado".
        Para poner los contadores en cero está reiniciar_metricas().
        """
        with self._candado:
            self._mapa = {}
            self._lista = ListaDoble()
            self._anotar("vaciado", None, "", "admin")

    def reiniciar_metricas(self):
        """Pone en cero aciertos, fallos, expulsiones y expirados. O(1).

        No toca los datos guardados ni la configuración.
        """
        with self._candado:
            self._reiniciar_metricas()

    def borrar_eventos(self):
        """Borra el registro de eventos y vuelve la secuencia a 0. O(1).

        Lo usa el reinicio completo del panel ("Vaciar todo"). Un panel que
        pida eventos con un `desde` mayor que la nueva secuencia recibe
        "perdidos" = True y se resincroniza con el estado (vacío).
        No toca los datos, las métricas ni la configuración.
        """
        with self._candado:
            self._eventos = []
            self._secuencia = 0

    # ------------------------------------------------------------------
    # Configuración
    # ------------------------------------------------------------------
    def cambiar_capacidad(self, nueva):
        """Cambia la capacidad; si sobran entradas, expulsa desde la cola.

        O(k), donde k = entradas que sobran (cada expulsión es O(1)).
        Si la capacidad crece, es O(1).
        """
        self._validar_capacidad(nueva)
        with self._candado:
            self._capacidad = int(nueva)
            while len(self._mapa) > self._capacidad:
                self._expulsar_cola("admin")

    def cambiar_ttl(self, nuevo):
        """Cambia el TTL para las entradas que se guarden desde ahora. O(1).

        Las entradas existentes conservan su vencimiento original (así no hay
        que recorrer la lista).
        """
        self._validar_ttl(nuevo)
        with self._candado:
            self._ttl = float(nuevo)

    # ------------------------------------------------------------------
    # Métricas, visualización y eventos
    # ------------------------------------------------------------------
    def obtener_estadisticas(self):
        """Métricas del caché (RF-05). O(1): son contadores ya calculados."""
        with self._candado:
            consultas = self._aciertos + self._fallos
            tasa = (self._aciertos / consultas * 100) if consultas else 0.0
            return {
                "aciertos": self._aciertos,
                "fallos": self._fallos,
                "tasa_aciertos": round(tasa, 1),
                "expulsiones": self._expulsiones,
                "expirados": self._expirados,
                "tamano": len(self._mapa),
                "capacidad": self._capacidad,
                "ttl": self._ttl,
            }

    def obtener_estado(self):
        """Nodos de cabeza a cola con su TTL restante (para el panel).

        O(n): recorre la lista con a_lista(). No cuenta aciertos ni fallos y
        no mueve nodos, así mirar el panel no altera el caché. Una entrada
        vencida que aún no se ha leído aparece con ttl_restante = 0.
        """
        with self._candado:
            return self._estado()

    def obtener_eventos(self, desde=None):
        """Eventos posteriores a la secuencia `desde` + el estado actual.

        Ambos se leen con el MISMO candado, así el estado corresponde
        exactamente a "después del último evento devuelto".
          - desde=None: no devuelve eventos, solo el estado (para empezar).
          - "perdidos" = True si el panel pidió eventos que ya se recortaron
            (se quedó muy atrás): entonces debe resincronizarse con el estado.
        O(log m + k): búsqueda binaria en el registro (m eventos, ordenados
        por secuencia) y copia de los k nuevos; más O(n) del estado.
        """
        with self._candado:
            if desde is None:
                eventos, perdidos = [], False
            else:
                primera = self._eventos[0]["secuencia"] if self._eventos else self._secuencia + 1
                perdidos = desde < primera - 1 or desde > self._secuencia
                i = bisect.bisect_right(self._eventos, desde, key=lambda e: e["secuencia"])
                eventos = self._eventos[i:]
            return {
                "eventos": eventos,
                "ultima": self._secuencia,
                "perdidos": perdidos,
                "capacidad": self._capacidad,
                "ttl": self._ttl,
                "estado": self._estado(),
            }

    @property
    def ultima_secuencia(self):
        with self._candado:
            return self._secuencia

    def __len__(self):
        return len(self._mapa)

    def __contains__(self, clave):
        """True si la clave está guardada (aunque haya vencido). No cuenta métricas."""
        return clave in self._mapa

    # ------------------------------------------------------------------
    # Auxiliares privados (se llaman con el candado ya tomado)
    # ------------------------------------------------------------------
    def _estado(self):
        ahora = self._reloj()
        return [
            {
                "clave": e.clave,
                "nombre": e.nombre or e.clave,
                "usos": e.usos,
                "ttl_restante": round(max(0.0, e.expira_en - ahora), 1),
            }
            for e in self._lista.a_lista()
        ]

    def _anotar(self, tipo, clave, nombre, origen, **extra):
        """Agrega un evento al registro. O(1) amortizado.

        No usamos deque: es una lista simple. Para no borrar el primer
        elemento en cada operación (eso sería O(m)), dejamos crecer la lista
        hasta 2 * max_eventos y entonces borramos de una vez la mitad vieja.
        Ese borrado cuesta O(max_eventos) pero ocurre solo cada max_eventos
        operaciones, así que repartido sale O(1) por operación (amortizado).
        """
        self._secuencia += 1
        evento = {
            "secuencia": self._secuencia,
            "tipo": tipo,
            "clave": clave,
            "nombre": nombre or (clave or ""),
            "origen": origen,
            "hora": time.time(),
        }
        evento.update(extra)
        self._eventos.append(evento)
        if len(self._eventos) >= 2 * self._max_eventos:
            del self._eventos[:-self._max_eventos]

    def _vencio(self, entrada):
        """O(1): compara el reloj con el vencimiento guardado."""
        return self._reloj() >= entrada.expira_en

    def _quitar(self, nodo):
        """Quita un nodo de la lista y su clave del dict. O(1)."""
        self._lista.eliminar_nodo(nodo)
        del self._mapa[nodo.dato.clave]

    def _expulsar_cola(self, origen):
        """Expulsa el menos recientemente usado (RF-03). O(1)."""
        nodo = self._lista.eliminar_ultimo()
        if nodo is not None:
            del self._mapa[nodo.dato.clave]
            self._expulsiones += 1
            self._anotar("expulsion", nodo.dato.clave, nodo.dato.nombre, origen)

    def _reiniciar_metricas(self):
        self._aciertos = 0
        self._fallos = 0
        self._expulsiones = 0
        self._expirados = 0

    @staticmethod
    def _validar_capacidad(capacidad):
        if not isinstance(capacidad, int) or isinstance(capacidad, bool) or capacidad < 1:
            raise ValueError("La capacidad debe ser un entero mayor o igual a 1.")

    @staticmethod
    def _validar_ttl(ttl):
        if not isinstance(ttl, (int, float)) or isinstance(ttl, bool) or ttl <= 0:
            raise ValueError("El TTL debe ser un número de segundos mayor que 0.")
