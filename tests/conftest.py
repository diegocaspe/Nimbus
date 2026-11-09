"""Utilidades compartidas por las pruebas."""

import pytest


class RelojFalso:
    """Reloj controlable: reemplaza a time.monotonic en el caché.

    Permite probar el TTL "adelantando" el tiempo sin dormir de verdad.
    """

    def __init__(self, inicio=1000.0):
        self.ahora = inicio

    def __call__(self):
        return self.ahora

    def avanzar(self, segundos):
        self.ahora += segundos


@pytest.fixture
def reloj():
    return RelojFalso()


CLAVE_PRUEBA = "clave-de-prueba"  # solo para las pruebas; la real va en .env


@pytest.fixture(autouse=True)
def credenciales_de_prueba(monkeypatch):
    """Las pruebas no dependen del .env del equipo: usan su propia clave."""
    monkeypatch.setenv("NIMBUS_ADMIN_USER", "admin")
    monkeypatch.setenv("NIMBUS_ADMIN_PASS", CLAVE_PRUEBA)
    monkeypatch.setenv("NIMBUS_SECRET", "secreto-de-prueba")
