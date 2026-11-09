"""Pruebas de la ListaDoble propia."""

from cache import ListaDoble, Nodo


def armar(*datos):
    """Crea una lista insertando al inicio; devuelve (lista, nodos)."""
    lista = ListaDoble()
    nodos = {}
    for d in datos:
        nodos[d] = Nodo(d)
        lista.insertar_al_inicio(nodos[d])
    return lista, nodos


def test_lista_vacia():
    lista = ListaDoble()
    assert lista.esta_vacia()
    assert len(lista) == 0
    assert lista.a_lista() == []
    assert lista.eliminar_ultimo() is None
    # Los centinelas quedan enlazados entre sí
    assert lista.cabeza.siguiente is lista.cola
    assert lista.cola.anterior is lista.cabeza


def test_insertar_al_inicio_deja_el_ultimo_en_la_cabeza():
    lista, _ = armar("a", "b", "c")
    assert lista.a_lista() == ["c", "b", "a"]
    assert len(lista) == 3
    assert not lista.esta_vacia()


def test_eliminar_del_medio_reenlaza_vecinos():
    lista, n = armar("a", "b", "c")  # c ⇄ b ⇄ a
    lista.eliminar_nodo(n["b"])
    assert lista.a_lista() == ["c", "a"]
    assert n["c"].siguiente is n["a"]
    assert n["a"].anterior is n["c"]
    assert n["b"].siguiente is None and n["b"].anterior is None


def test_eliminar_ultimo_devuelve_el_menos_reciente():
    lista, n = armar("a", "b", "c")
    assert lista.eliminar_ultimo() is n["a"]
    assert lista.a_lista() == ["c", "b"]
    lista.eliminar_ultimo()
    lista.eliminar_ultimo()
    assert lista.esta_vacia()


def test_mover_al_inicio():
    lista, n = armar("a", "b", "c")
    lista.mover_al_inicio(n["a"])
    assert lista.a_lista() == ["a", "c", "b"]
    lista.mover_al_inicio(n["a"])  # ya está en la cabeza: no cambia nada
    assert lista.a_lista() == ["a", "c", "b"]
    assert len(lista) == 3
