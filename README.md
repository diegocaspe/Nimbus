# Nimbus: servicio de clima con caché LRU

Proyecto Integrador N.° 1 de Algoritmos y Estructura de Datos II. Nimbus es un servicio web en Flask que consulta el clima en [Open-Meteo](https://open-meteo.com/). Delante del servicio hay una **caché LRU propia**: un `dict` más una lista doblemente enlazada hecha por el equipo, con expiración por TTL, métricas, modo sin conexión, panel de administrador y benchmark.

## Estructura

```
cache/                  estructuras de datos (sin OrderedDict, deque ni lru_cache)
  nodo.py               Nodo (dato, siguiente, anterior) y Entrada (clave, valor, expira_en)
  lista_doble.py        ListaDoble (cabeza, cola) con nodos centinela
  cache_lru.py          CacheLRU: dict clave→Nodo + ListaDoble + threading.Lock
servicio/
  app.py                crear_app(): fábrica Flask, páginas y rutas JSON
  nucleo.py             Nimbus: contenedor del estado (caché, servicios, registro, simulación)
  servicio_clima.py     ServicioClimaReal (Open-Meteo), ServicioClimaSimulado y clave_de()
  simulaciones.py       simulaciones "hora punta" (80/20) y "escaneo" en segundo plano
  lugares_peru.py       lugares del Perú con coordenadas (búsqueda sin internet)
frontend/
  templates/            páginas Jinja: globo, mapa del Perú, login y panel
  static/               CSS, JS (api.js es el único que habla con Flask; visor_lista.js anima la lista; recorrido.js anima el viaje Usuario → Caché → API), imágenes y GeoJSON
benchmark/
  benchmark.py          python -m benchmark.benchmark
  resultados/           latencia.png, tasa_aciertos.png, complejidad.png, resultados.json
tests/                  pruebas pytest (78 casos)
herramientas/           convertir_paises.py (datos del globo) y convertir_peru.py (límites INEI del Perú)
informe.pdf             informe técnico (lo entrega el equipo)
```

## Instalación

Requisito: Python 3.11 o superior.

```bash
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

## Configuración (credenciales)

Las credenciales **no están en el código**. Se leen de variables de entorno o de un archivo `.env` en la raíz del proyecto, que no se sube a git. Para crearlo:

```bash
# Windows:      copy .env.example .env
# macOS/Linux:  cp .env.example .env
```

Luego edita `.env` y pon tu contraseña de administrador (`NIMBUS_ADMIN_PASS`) y una clave larga y aleatoria para la cookie de sesión (`NIMBUS_SECRET`). Para generar una:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Si no hay `.env` ni variables, el servidor arranca igual: genera una contraseña temporal del administrador y la muestra en la consola.

## Ejecutar el servidor

```bash
python -m servicio.app
```

Abre **http://127.0.0.1:5000**. Flask sirve el frontend, así que no hace falta CORS.

- `/` muestra el globo. Haz clic en un lugar o búscalo para ver su clima. La tarjeta indica **● Caché · X ms** o **● API · X ms**.
- `/peru` muestra el Perú sobre el mismo globo 3D (al pulsar **Bloquear en Perú** el globo viaja hasta el país y el resto del mundo se apaga). La rueda acerca hacia el cursor y el detalle cambia solo: departamentos → provincias → distritos. El botón **Mapa de calor** colorea cada zona por su temperatura actual.
- `/admin` es el panel del caché y pide iniciar sesión.

### Variables de entorno (en `.env` o en el sistema)

| Variable | Por defecto | Qué hace |
|---|---|---|
| `NIMBUS_ADMIN_USER` | `admin` | Usuario del administrador |
| `NIMBUS_ADMIN_PASS` | aleatoria, se muestra al arrancar | Contraseña del administrador |
| `NIMBUS_SECRET` | aleatoria en cada arranque | Clave para firmar la cookie de sesión. Si no la fijas, las sesiones se cierran al reiniciar el servidor |
| `NIMBUS_CAPACIDAD` | `10` | Capacidad inicial del caché (coincide con una capacidad del benchmark) |
| `NIMBUS_TTL` | `600` | TTL inicial, en segundos |
| `NIMBUS_SIN_CONEXION` | `0` | Si vale `1`, arranca con el servicio simulado (sin internet) |
| `NIMBUS_LATENCIA_MS` | `300` | Latencia del servicio simulado, en ms |

Ejemplo sin internet (PowerShell): `$env:NIMBUS_SIN_CONEXION="1"; python -m servicio.app`

## Pruebas

```bash
python -m pytest            # o: python -m pytest -v
```

Las pruebas cubren:

- capacidad 1, clave repetida, caché lleno (se expulsa la cola correcta) y la lectura que reordena la lista;
- expiración por TTL con un reloj inyectado (no se duerme de verdad), métricas, `vaciar`, `cambiar_capacidad` y `cambiar_ttl`;
- `ListaDoble`: insertar, eliminar del medio, eliminar el último y lista vacía;
- comparación contra `functools.lru_cache` con la misma secuencia de operaciones;
- concurrencia con 8 hilos;
- todas las rutas Flask con el servicio simulado;
- el panel: cámara lenta con pausa y reanudación, qué servicio usa cada botón (con un Open-Meteo falso, sin internet), detener una simulación en curso y vaciar, el cambio automático al simulado ante un 429, la tarjeta «con caché vs. sin caché», la dinámica con el público y las consultas «pioneras»;
- el benchmark.

Las pruebas usan su propia clave de administrador (`tests/conftest.py`) y no dependen de tu `.env`.

## Benchmark (RF-08)

```bash
python -m benchmark.benchmark                       # 1000 consultas, latencia simulada de 20 ms
python -m benchmark.benchmark --consultas 2000 --latencia-ms 50
```

El script genera 1000 consultas con distribución Zipf (s = 1.1) sobre 100 lugares, con semilla fija. Compara **sin caché** contra **CacheLRU con capacidades 5, 10, 20 y 50**, siempre con el servicio simulado. Mide tiempo total, latencia promedio, tasa de aciertos y llamadas a la API. Además, mide el tiempo promedio de `obtener` y `guardar` (en microsegundos) con cachés de 10, 100, 1 000, 10 000 y 100 000 elementos, con 10 000 operaciones por tamaño: la línea sale plana, que es la prueba de O(1). El panel muestra los tres gráficos en la pestaña Benchmark, cada uno con una frase de interpretación.

Los resultados quedan en `benchmark/resultados/`: tres gráficos PNG y `resultados.json`. El panel los muestra en la pestaña **Benchmark**.

Se usan 20 ms de latencia en lugar de los 300 ms "reales" para que el escenario sin caché no tarde 5 minutos. Las proporciones entre escenarios no cambian.

## Rutas y ejemplos con curl

Todas las respuestas son JSON. Los errores tienen la forma `{"ok": false, "error": "mensaje claro"}` y usan los códigos 400, 401, 404, 409 o 502.

### Obligatorias (RF-06)

```bash
# Clima de un lugar. "origen" dice si vino del caché o de la API.
curl "http://127.0.0.1:5000/clima?lat=-12.05&lon=-77.04&nombre=Lima"

# Métricas del caché y estado de la lista (de cabeza a cola)
curl http://127.0.0.1:5000/estadisticas

# Vaciar el caché: borra SOLO los datos guardados (las métricas siguen; ver /admin/metricas/reiniciar)
curl -X POST http://127.0.0.1:5000/vaciar
```

Respuesta de `/clima`:

```json
{
  "nombre": "Lima", "lat": -12.05, "lon": -77.04, "clave": "-12.1,-77.0",
  "actual": { "temperatura": 19.4, "sensacion_termica": 18.9, "humedad": 78,
              "viento_kmh": 12.3, "prob_lluvia": 10, "codigo": 3 },
  "pronostico": [ { "fecha": "2026-11-09", "max": 21.0, "min": 16.2, "codigo": 2 } ],
  "origen": "cache",
  "tiempo_ms": 0.04
}
```

- `codigo` es el *weather code* WMO de Open-Meteo.
- `pronostico` trae los próximos 5 días.
- Si Open-Meteo no responde o devuelve **429** (límite superado), Nimbus cambia solo al servicio simulado, responde igual y el panel muestra «API no disponible: usando modo sin conexión». El aviso se borra cuando el administrador apaga el modo sin conexión.

Respuesta de `/estadisticas`:

```json
{
  "aciertos": 120, "fallos": 40, "tasa_aciertos": 75.0, "expulsiones": 12, "expirados": 3,
  "tamano": 10, "capacidad": 10, "ttl": 600.0,
  "llamadas_api_evitadas": 120, "soles_ahorrados": 1.2, "costo_por_llamada": 0.01,
  "sin_conexion": false, "latencia_ms": 300, "aviso_api": null,
  "comparacion": { "promedio_cache_ms": 0.02, "promedio_api_ms": 302.4, "veces_mas_rapido": 15120.0,
                   "ahorrado_ms": 36284.3, "respuestas_cache": 120, "respuestas_api": 40 },
  "nodos": [ { "clave": "-12.1,-77.0", "nombre": "Lima", "usos": 3, "ttl_restante": 542.5 } ]
}
```

- `comparacion` alimenta la tarjeta «Con caché vs. sin caché»: `veces_mas_rapido` = promedio API ÷ promedio caché; `ahorrado_ms` = aciertos × promedio API − tiempo real gastado en aciertos. `/vaciar` no lo cambia; `/admin/metricas/reiniciar` lo pone en cero.
- `soles_ahorrados` es un **estimado**: supone S/ 0.01 por llamada evitada, aunque Open-Meteo es gratuita.
- `aviso_api` es `null` o `{"mensaje": "API no disponible: usando modo sin conexión", "detalle": "...", "hora": "14:02:11"}`.
- Todas las horas que devuelve el backend (`aviso_api.hora`, `hora` del registro, `inicio` de la dinámica) están en **hora de Lima** (America/Lima, UTC-5), sin importar la zona del servidor.

### Mapa de calor

```bash
# Temperatura actual de varios puntos "lat,lon" separados por ";" (máximo 250)
curl "http://127.0.0.1:5000/calor?puntos=-12.05,-77.04;-15.84,-70.02"
```

```json
{ "temperaturas": [22.9, 7.5] }
```

- Hace **una sola** llamada a Open-Meteo con todos los puntos (o usa el servicio simulado en modo sin conexión).
- No pasa por el caché LRU: el mapa pide 222 puntos a la vez (25 departamentos + 197 provincias) y llenaría el caché, expulsando las consultas de `/clima`.
- Errores: **400** si falta `puntos` o alguno no es `lat,lon` válido. Si Open-Meteo falla, cambia solo al simulado (igual que `/clima`).

### Búsqueda

```bash
curl "http://127.0.0.1:5000/buscar?q=arequipa"
# {"resultados": [{"nombre": "Arequipa", "detalle": "...", "lat": -16.4, "lon": -71.54}]}
```

En modo real usa la geocodificación de Open-Meteo. En modo sin conexión, o si no hay internet, busca en la lista local de lugares del Perú.

### Nombre de un punto del mapa (geocodificación inversa)

```bash
curl "http://127.0.0.1:5000/lugar?lat=-3.1&lon=-60.0"
# {"nombre": "Manaos, Brasil", "lat": -3.1, "lon": -60.0}
```

- Open-Meteo no tiene geocodificación inversa: en modo real se usa [Nominatim](https://nominatim.org/) (OpenStreetMap), con un User-Agent propio, máximo 1 consulta por segundo y los nombres ya pedidos guardados en un `dict` aparte (no es el caché LRU).
- En modo sin conexión, o si Nominatim falla, devuelve el lugar de la lista local más cercano (dentro de 30 km). Una falla de Nominatim **no** activa el modo sin conexión.
- `nombre` es `null` si no hay nombre (por ejemplo, en el mar). El globo muestra entonces el país o, si tampoco hay, «Lugar en -14.9, -101.7».
- Errores: **400** si falta `lat`/`lon` o están fuera de rango.

### Administrador

Todas las rutas `/admin/*` requieren sesión; sin sesión responden 401. Con curl, guarda la cookie de sesión con `-c` y envíala con `-b`:

```bash
curl -c sesion.txt -X POST -H "Content-Type: application/json" \
     -d '{"usuario":"admin","clave":"TU_CLAVE"}' http://127.0.0.1:5000/admin/login

# Ver o cambiar la configuración (cualquier combinación de campos)
curl -b sesion.txt http://127.0.0.1:5000/admin/configuracion
curl -b sesion.txt -X POST -H "Content-Type: application/json" \
     -d '{"capacidad": 10, "ttl": 120, "sin_conexion": true, "latencia_ms": 300}' \
     http://127.0.0.1:5000/admin/configuracion

# Poner en cero aciertos, fallos, expulsiones, expirados, tiempos con/sin caché y el registro.
# No toca los datos guardados ni la configuración.
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/metricas/reiniciar

# Últimas 20 consultas: hora (de Lima), lugar, clave, origen ("cache"/"api"), tiempo_ms,
# tipo ("publico"/"simulacion") y pionera (true = primera consulta de ese lugar, fue a la API)
curl -b sesion.txt http://127.0.0.1:5000/admin/registro

# Simulaciones en segundo plano (responden 202; 409 si ya hay una en curso).
# Hora punta y escaneo usan el servicio SIMULADO (no superan el límite de Open-Meteo, 600 por minuto).
# Cámara lenta consulta Open-Meteo REAL (30 consultas a 1 por segundo), con respaldo automático.
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simular/hora-punta     # 1000 consultas 80/20, 8 hilos
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simular/escaneo        # 200 lugares únicos
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simular/camara-lenta   # 30 consultas 80/20, 1 por segundo
curl -b sesion.txt http://127.0.0.1:5000/admin/simulacion/estado
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simulacion/pausar
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simulacion/reanudar
# Cancela la simulación en curso y responde cuando su hilo ya terminó (máximo 3 s):
# así ninguna consulta en vuelo guarda datos después de un /vaciar.
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/simulacion/detener

# Dinámica con el público: pone en cero el "Resumen de la sala" / lo consulta
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/dinamica/iniciar
curl -b sesion.txt http://127.0.0.1:5000/admin/dinamica/resumen

# Registro de eventos del caché (para la animación del panel)
curl -b sesion.txt "http://127.0.0.1:5000/admin/eventos"            # solo estado + "ultima"
curl -b sesion.txt "http://127.0.0.1:5000/admin/eventos?desde=120"  # eventos con secuencia > 120

# Modo paso a paso: UNA consulta (lugar elegido con 80/20) a Open-Meteo REAL.
# Si Open-Meteo falla o responde 429, pasa solo al simulado y deja el aviso (502 solo si fallan los dos).
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/paso

# Resultados del benchmark y URLs de los gráficos
curl -b sesion.txt http://127.0.0.1:5000/admin/benchmark

# Cerrar sesión
curl -b sesion.txt -X POST http://127.0.0.1:5000/admin/logout
```

En Windows con PowerShell, usa `curl.exe` en lugar de `curl`.

Respuesta de `/admin/dinamica/resumen` (solo consultas del **público** desde «Iniciar dinámica»; las simulaciones no cuentan):

```json
{ "activa": true, "inicio": "10:15:02", "consultas": 42, "aciertos": 31, "llamadas_api_evitadas": 31,
  "llamadas_api": 11, "tasa_aciertos": 73.8, "ahorrado_ms": 9374.2 }
```

Respuesta de `/admin/eventos?desde=N`:

```json
{
  "eventos": [
    { "secuencia": 121, "tipo": "fallo", "clave": "-18.0,-70.2", "nombre": "Tacna", "origen": "publico", "hora": 1762620000.1 },
    { "secuencia": 122, "tipo": "expulsion", "clave": "-5.2,-80.6", "nombre": "Piura", "origen": "publico", "hora": 1762620000.4 },
    { "secuencia": 123, "tipo": "insercion", "clave": "-18.0,-70.2", "nombre": "Tacna", "origen": "publico",
      "hora": 1762620000.4, "ttl": 600.0, "tiempo_api_ms": 312.0 }
  ],
  "ultima": 123, "perdidos": false, "capacidad": 10, "ttl": 600.0,
  "estado": [ { "clave": "-18.0,-70.2", "nombre": "Tacna", "usos": 1, "ttl_restante": 600.0 } ]
}
```

Hay 8 tipos de evento:

- `acierto`: trae además `usos` y `tiempo_ms`.
- `fallo`.
- `insercion`: trae además `ttl` y `tiempo_api_ms`.
- `actualizacion`.
- `expulsion`.
- `expirado`.
- `eliminacion`.
- `vaciado`.

`origen` puede ser `publico`, `admin`, `simulacion` (hora punta y escaneo), `simulacion-lenta` (cámara lenta) o `simulacion-paso` (botón «Siguiente consulta»). El panel usa `origen` para elegir cómo animar cada evento. Si `perdidos` es `true`, el panel se atrasó más de lo que guarda el registro y debe copiar `estado` tal cual.

## Diseño

### Por qué `dict` + lista doble da O(1)

```
dict:   "-12.1,-77.0" ─┐   "-16.4,-71.5" ─┐
                       ▼                  ▼
lista:  [cabeza] ⇄ [Lima] ⇄ ... ⇄ [Arequipa] ⇄ [cola]
        más reciente                menos reciente
```

| Operación | Complejidad | Por qué |
|---|---|---|
| `obtener(clave)` | O(1) promedio | El `dict` encuentra el nodo con un hash. Moverlo a la cabeza solo reasigna 4 enlaces, porque el nodo conoce a su anterior y a su siguiente. |
| `guardar(clave, valor)` | O(1) promedio | Busca en el `dict`. Si el caché está lleno, quita `cola.anterior` (acceso directo) y su clave del `dict`. Luego inserta el nodo nuevo al inicio. |
| `eliminar(clave)` | O(1) promedio | Busca en el `dict` y desengancha el nodo. |
| `vaciar()` | O(1) | Crea un `dict` y una lista nuevos. No cambia las métricas. |
| `reiniciar_metricas()` | O(1) | Pone cuatro contadores en cero. No toca los datos. |
| `cambiar_capacidad(n)` | O(k) | k es la cantidad de entradas que sobran; cada expulsión es O(1). |
| `obtener_estadisticas()` | O(1) | Son contadores. |
| `obtener_estado()` | O(n) | Recorre la lista. Solo se usa para mostrar el panel, nunca dentro de `obtener` ni `guardar`. |

Con una lista simple, quitar un nodo del medio obligaría a recorrerla para encontrar su anterior, que es O(n). Por eso la lista es doble. Los **nodos centinela** (`cabeza` y `cola` vacíos) evitan los casos especiales de lista vacía, primer nodo y último nodo.

### Otras decisiones

- **TTL perezoso.** El vencimiento se revisa al leer, con `time.monotonic()` (no retrocede si cambia la hora del sistema). Una entrada vencida se borra, cuenta como fallo y como expirada. Las pruebas inyectan un reloj falso.
- **Clave del caché.** La latitud y la longitud se redondean a 1 decimal (por ejemplo, `-12.1,-77.0`), que equivale a unos 11 km. Así los clics cercanos en el mapa comparten la misma entrada; a esa escala el clima prácticamente no cambia. Sin redondeo, cada clic sería una clave nueva y la tasa de aciertos sería casi 0.
- **Sin estado global.** `crear_app()` crea una instancia de `Nimbus` y la guarda en `app.extensions["nimbus"]`. Cada app, y cada prueba, tiene su propio caché.
- **Concurrencia.** Flask atiende peticiones en varios hilos y las simulaciones usan 8 hilos sobre el mismo caché. `CacheLRU` protege cada operación con un `threading.Lock`. Dos fallos simultáneos de la misma clave pueden llamar dos veces a la API; el segundo `guardar` solo actualiza el valor, sin duplicar.
- **Modo sin conexión (RF-07).** `ServicioClimaSimulado` tiene la misma interfaz que el real. Devuelve datos coherentes y deterministas por clave y espera una latencia configurable desde el panel.
- **Registro de eventos.** `CacheLRU` anota cada operación en una lista simple, sin `deque`. Para no borrar el primer elemento en cada operación, la lista crece hasta 1000 eventos y entonces se borran de una vez los 500 más viejos: el costo amortizado es O(1). Los eventos y el estado se leen con el mismo candado, así el estado corresponde exactamente al último evento devuelto. La posición de un nodo ("estaba en la posición 5") la calcula el panel con su copia de la lista; el caché no la calcula, porque eso haría O(n) a `obtener`.
- **Visualización: la velocidad del caché y la de la animación están separadas.** El panel pide `/admin/eventos` cada 250 ms, mete los eventos en una cola de reproducción y los aplica sobre una copia de la lista (mismos eventos en el mismo orden = misma lista que el servidor). La lista se dibuja **siempre en una sola fila**, cabeza a la izquierda; si no caben, los nodos se achican. Hay cuatro modos, según el `origen` del evento:
  - **Paso a paso** («Siguiente consulta», `simulacion-paso`): una consulta animada en unos 2 s. En un acierto se resalta la fila del índice (dict), el nodo brilla en verde y se desliza a la cabeza. En un fallo aparece «no está» en el índice y el nodo nuevo entra por la cabeza con borde naranja. En una expulsión la cola se marca en rojo, se mantiene 1 s y sale. Si venció el TTL, el nodo se apaga y sale. El narrador lo explica en una frase y siempre dice «Nodos recorridos: 0».
  - **Cámara lenta** (`simulacion-lenta`): 30 consultas 80/20 a 1 por segundo, con la misma animación más corta (unos 800 ms por evento). Se puede pausar y reanudar: la pausa detiene el hilo de la simulación en el servidor.
  - **Hora punta / escaneo** (`simulacion`): 1000 consultas a velocidad real. No se anima cada evento: la fila se redibuja cada 300 ms con transiciones de posición, cada nodo muestra «consultado N veces» y brilla al recibir un acierto (máximo una vez cada 300 ms), y un gráfico muestra la tasa de aciertos en vivo. El indicador «Acelerado ×N» compara las consultas por segundo con la cámara lenta (1 por segundo). Al terminar aparecen el resumen («1000 consultas · 57 % aciertos · 172 s ahorrados») y el botón «Repetir las últimas 10 en cámara lenta», que vuelve a animar esas consultas desde una foto de la lista tomada antes de cada evento.
  - **Público** (`publico`): las consultas reales se animan de una en una; si se acumulan más de 15, se reproducen al doble de velocidad y el indicador muestra «×2».
- **Simulaciones.** "Hora punta" envía 1000 consultas, el 80 % de ellas al 20 % de los lugares. "Escaneo" consulta 200 lugares únicos: es el peor caso de LRU, porque expulsa a las ciudades populares aunque vuelvan a pedirse. "Cámara lenta" envía 30 consultas 80/20 a 1 por segundo.

  | Botón | Servicio |
  |---|---|
  | «Siguiente consulta» | Open-Meteo real |
  | «Simular en cámara lenta» | Open-Meteo real |
  | «Simular hora punta» | servicio simulado (no supera el límite de 600 consultas por minuto) |
  | «Simular escaneo» | servicio simulado |
  | Consultas del público | Open-Meteo real |

  En modo normal, «Open-Meteo real» pasa al simulado solo si Open-Meteo falla o responde 429 (o si el administrador activa el modo sin conexión); el panel lo indica con el aviso de arriba. La tercera caja del «Recorrido de la consulta» siempre dice «Open-Meteo (API)»; en hora punta y escaneo no se anima, solo se muestran los contadores.
- **«Vaciar caché» en la fila de simulaciones.** En un clic: la lista y el recorrido se limpian al instante en el navegador (se corta la animación en curso y se vacía la cola de reproducción), luego `POST /admin/simulacion/detener` cancela la simulación y espera a su hilo, y `POST /vaciar` borra los datos. El panel ignora las respuestas del sondeo que lleguen mientras tanto y, al terminar, copia el estado real (vacío). El botón «Vaciar caché» de Configuración sigue haciendo solo `POST /vaciar`.
- **Respaldo ante fallas de Open-Meteo.** Si una consulta real falla o recibe 429, `Nimbus` pasa solo al servicio simulado, responde igual y deja un aviso que el panel muestra arriba.
- **Dinámica con el público.** «Iniciar dinámica» pone en cero el «Resumen de la sala», que cuenta solo las consultas del público (no las simuladas) y se puede ver a pantalla completa. En el registro, la primera consulta de cada lugar se marca como «pionera»: es la que fue a la API y dejó el dato en el caché para los demás.
