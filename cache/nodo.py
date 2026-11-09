"""Nodo de la lista doblemente enlazada y la entrada que guarda el caché."""


class Entrada:
    """Lo que el caché guarda en cada nodo.

    - clave:     la clave del dict (la guardamos para que, al expulsar la cola
                 de la lista, sepamos qué clave borrar del dict en O(1)).
    - valor:     el dato cacheado.
    - expira_en: instante (reloj monotónico, en segundos) en que vence.
    - nombre:    etiqueta legible para el panel (por ejemplo "Lima").
    - usos:      cuántas veces se consultó (1 al insertarse + 1 por acierto).
    """

    __slots__ = ("clave", "valor", "expira_en", "nombre", "usos")

    def __init__(self, clave, valor, expira_en, nombre=""):
        self.clave = clave
        self.valor = valor
        self.expira_en = expira_en
        self.nombre = nombre
        self.usos = 1

    def __repr__(self):
        return f"Entrada({self.clave!r})"


class Nodo:
    """Nodo de la lista doble.

    Atributos (nomenclatura del curso):
      - dato:      lo que guarda el nodo (una Entrada, o None en los centinelas).
      - siguiente: nodo hacia la cola (menos reciente).
      - anterior:  nodo hacia la cabeza (más reciente).
    """

    __slots__ = ("dato", "siguiente", "anterior")

    def __init__(self, dato=None):
        self.dato = dato
        self.siguiente = None
        self.anterior = None

    def __repr__(self):
        return f"Nodo({self.dato!r})"
