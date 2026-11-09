"""Lista doblemente enlazada propia (sin deque ni OrderedDict).

Usamos DOS NODOS CENTINELA: `cabeza` y `cola` son nodos vacíos que nunca
se borran. Los nodos reales viven entre ellos:

    cabeza ⇄ [más reciente] ⇄ ... ⇄ [menos reciente] ⇄ cola

Ventaja: insertar o eliminar nunca tiene que preguntar "¿es el primero?",
"¿es el último?" o "¿la lista está vacía?", porque siempre hay un nodo a
cada lado. Así cada operación es un número fijo de asignaciones: O(1).
"""

from .nodo import Nodo


class ListaDoble:
    def __init__(self):
        """Crea la lista vacía: cabeza ⇄ cola. O(1)."""
        self.cabeza = Nodo()  # centinela del lado MÁS reciente
        self.cola = Nodo()    # centinela del lado MENOS reciente
        self.cabeza.siguiente = self.cola
        self.cola.anterior = self.cabeza
        self.tamano = 0

    def esta_vacia(self):
        """True si no hay nodos reales. O(1): solo mira un enlace."""
        return self.cabeza.siguiente is self.cola

    def insertar_al_inicio(self, nodo):
        """Pone `nodo` justo después de la cabeza (posición más reciente).

        O(1): solo se reasignan 4 enlaces, sin importar el tamaño de la lista.
        """
        primero = self.cabeza.siguiente
        nodo.anterior = self.cabeza
        nodo.siguiente = primero
        primero.anterior = nodo
        self.cabeza.siguiente = nodo
        self.tamano += 1

    def eliminar_nodo(self, nodo):
        """Desengancha `nodo` de la lista (puede estar en cualquier posición).

        O(1): como el nodo conoce a su anterior y a su siguiente, basta con
        unirlos entre sí. Esta es la razón de usar lista DOBLE: con una lista
        simple habría que recorrerla para encontrar el anterior (O(n)).
        """
        nodo.anterior.siguiente = nodo.siguiente
        nodo.siguiente.anterior = nodo.anterior
        nodo.anterior = None
        nodo.siguiente = None
        self.tamano -= 1
        return nodo

    def eliminar_ultimo(self):
        """Quita y devuelve el nodo menos reciente (el de antes de la cola).

        O(1): `cola.anterior` es acceso directo. Devuelve None si está vacía.
        """
        if self.esta_vacia():
            return None
        return self.eliminar_nodo(self.cola.anterior)

    def mover_al_inicio(self, nodo):
        """Lleva un nodo que ya está en la lista a la posición más reciente.

        O(1): es eliminar_nodo + insertar_al_inicio, ambas O(1).
        """
        self.eliminar_nodo(nodo)
        self.insertar_al_inicio(nodo)

    def a_lista(self):
        """Devuelve los datos de cabeza a cola en una lista de Python.

        O(n): recorre todos los nodos. SOLO se usa para mostrar el estado
        (panel y pruebas); nunca dentro de obtener/guardar del caché.
        """
        datos = []
        actual = self.cabeza.siguiente
        while actual is not self.cola:
            datos.append(actual.dato)
            actual = actual.siguiente
        return datos

    def __len__(self):
        """Cantidad de nodos reales. O(1): se lleva un contador."""
        return self.tamano
