# Nimbus — notas para Claude Code

Servicio de clima con caché LRU propia (curso Algoritmos y Estructura de Datos II). Backend Python/Flask en `servicio/`, estructuras en `cache/`, frontend en `frontend/`, benchmark en `benchmark/`, pruebas en `tests/`. Los datos vienen de Open-Meteo. El enunciado oficial es `Proyecto_1_Cache_LRU.docx`.

## Restricciones del curso (no romper)
- Prohibido en el mecanismo del caché: `OrderedDict`, `functools.lru_cache`, `cachetools`, `collections.deque`. Solo `dict` nativo + `ListaDoble` propia. `lru_cache` solo dentro de `tests/`.
- Nomenclatura: `Nodo` (dato, siguiente, anterior), `ListaDoble` (cabeza, cola), `CacheLRU`. Métodos en español y snake_case.
- `obtener` y `guardar` deben seguir siendo O(1): nunca recorrer la lista en ellas.
- Sin estado global: todo cuelga de la instancia `Nimbus` en `app.extensions["nimbus"]` (fábrica `crear_app`).

## Convenciones del frontend
- **Sin frameworks ni build:** HTML (Jinja), CSS y JavaScript normales.
- **Idioma:** código, comentarios y textos de la interfaz en español.
- **Colores:** solo mediante las variables CSS de `frontend/static/css/nimbus.css` (`:root` y `:root.dark`). Regla 60-30-10: `--color-acento` SOLO en la región seleccionada, el botón principal, el enlace/pestaña activa y el foco. `--color-cache`, `--color-api` y `--color-error` solo en el punto ● de la etiqueta de origen y en mensajes de error o sin conexión. Única excepción: la franja «Recorrido de la consulta» (`recorrido.js`), donde la bolita y el borde de estado de las cajas usan `--color-cache`/`--color-api`.
- **Animaciones:** discretas, 200–300 ms, solo opacidad y posición.
- **Backend:** toda llamada pasa por `frontend/static/js/api.js` (`NimbusAPI`). Las páginas nunca hacen `fetch` directo.
- **Contrato JSON:** documentado en `README.md`. Si cambia, actualiza `servicio/app.py`, `api.js` y el README juntos.

## Correr
`pip install -r requirements.txt`, luego `python -m servicio.app` (http://127.0.0.1:5000), `python -m pytest` y `python -m benchmark.benchmark`.
