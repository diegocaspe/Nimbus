"""Benchmark del caché LRU (RF-08).

Ejecutar desde la raíz del proyecto:
    python -m benchmark.benchmark
    python -m benchmark.benchmark --consultas 2000 --latencia-ms 50

Qué hace:
  1. Genera N consultas (mínimo 1000) con distribución Zipf: pocos lugares muy
     consultados y muchos poco consultados, como el tráfico real. La semilla
     es fija, así todos los escenarios reciben EXACTAMENTE la misma secuencia.
  2. Compara: sin caché vs. CacheLRU con capacidades 5, 10, 20 y 50, usando el
     servicio simulado (latencia fija, sin depender de internet).
  3. Mide tiempo total, latencia promedio, tasa de aciertos y llamadas a la API.
  4. Mide el tiempo de obtener/guardar con cachés de distinto tamaño para
     evidenciar que son O(1): la curva debe salir plana.
  5. Guarda 3 gráficos PNG y un JSON en benchmark/resultados/.
"""

import argparse
import json
import random
import time
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # sin ventana: solo genera archivos
import matplotlib.pyplot as plt  # noqa: E402

from cache import CacheLRU  # noqa: E402
from servicio.lugares_peru import LUGARES_PERU  # noqa: E402
from servicio.nucleo import ZONA_LIMA  # noqa: E402
from servicio.servicio_clima import ServicioClimaSimulado, clave_de  # noqa: E402
from servicio.simulaciones import trafico_escaneo  # noqa: E402

CARPETA = Path(__file__).resolve().parent / "resultados"
CAPACIDADES = [5, 10, 20, 50]
TAMANOS_COMPLEJIDAD = [10, 100, 1_000, 10_000, 100_000]
OPERACIONES_COMPLEJIDAD = 10_000  # operaciones medidas por tamaño
ZIPF_S = 1.1

# Colores de la paleta de Nimbus (modo claro)
TINTA = "#1C1E21"
GRIS = "#6B6F76"
BORDE = "#E7E5E0"
ACENTO = "#2B4C7E"


# ----------------------------------------------------------------------
# Tráfico
# ----------------------------------------------------------------------
def lugares_benchmark():
    """100 lugares con claves distintas: los 50 del Perú + 50 puntos extra."""
    return list(LUGARES_PERU) + trafico_escaneo(50)


def trafico_zipf(lugares, n, s=ZIPF_S, semilla=42):
    """n consultas donde el lugar de rango r tiene peso 1 / r^s (ley de Zipf)."""
    azar = random.Random(semilla)
    pesos = [1 / (r ** s) for r in range(1, len(lugares) + 1)]
    return azar.choices(lugares, weights=pesos, k=n)


# ----------------------------------------------------------------------
# Escenarios
# ----------------------------------------------------------------------
def correr_escenario(consultas, servicio, capacidad=None):
    """Atiende todas las consultas; capacidad=None significa "sin caché"."""
    cache = CacheLRU(capacidad, ttl_segundos=3600) if capacidad else None
    llamadas_api = 0
    inicio = time.perf_counter()
    for nombre, _, lat, lon in consultas:
        if cache is None:
            servicio.consultar(lat, lon, nombre)
            llamadas_api += 1
            continue
        clave = clave_de(lat, lon)
        if cache.obtener(clave) is None:          # fallo -> API y guardar
            cache.guardar(clave, servicio.consultar(lat, lon, nombre))
            llamadas_api += 1
    total = time.perf_counter() - inicio

    aciertos = len(consultas) - llamadas_api
    return {
        "nombre": f"Caché {capacidad}" if capacidad else "Sin caché",
        "capacidad": capacidad or 0,
        "tiempo_total_s": round(total, 3),
        "latencia_promedio_ms": round(total / len(consultas) * 1000, 3),
        "tasa_aciertos": round(aciertos / len(consultas) * 100, 1),
        "llamadas_api": llamadas_api,
    }


def medir_complejidad(tamanos=TAMANOS_COMPLEJIDAD, operaciones=OPERACIONES_COMPLEJIDAD, semilla=7):
    """Tiempo promedio (µs) de obtener y guardar con el caché lleno de n entradas.

    Si fueran O(n), pasar de 10 a 100 000 entradas multiplicaría el tiempo
    por 10 000. Con O(1) el tiempo se mantiene casi igual.
    """
    azar = random.Random(semilla)
    filas = []
    for n in tamanos:
        cache = CacheLRU(n, ttl_segundos=10**9)
        for i in range(n):
            cache.guardar(i, i)
        claves = [azar.randrange(n) for _ in range(operaciones)]

        t0 = time.perf_counter()
        for k in claves:
            cache.obtener(k)                       # siempre acierto: mueve a la cabeza
        t_obtener = (time.perf_counter() - t0) / operaciones

        t0 = time.perf_counter()
        for i in range(n, n + operaciones):
            cache.guardar(i, i)                    # clave nueva: expulsa la cola
        t_guardar = (time.perf_counter() - t0) / operaciones

        filas.append({"tamano": n,
                      "obtener_us": round(t_obtener * 1e6, 3),
                      "guardar_us": round(t_guardar * 1e6, 3)})
    return filas


# ----------------------------------------------------------------------
# Gráficos
# ----------------------------------------------------------------------
def _estilo(ax):
    """Ejes discretos: sin marco superior/derecho, rejilla suave."""
    for lado in ("top", "right", "left"):
        ax.spines[lado].set_visible(False)
    ax.spines["bottom"].set_color(GRIS)
    ax.tick_params(colors=GRIS, length=0)
    ax.grid(axis="y", color=BORDE, linewidth=1)
    ax.set_axisbelow(True)


def grafico_latencia(escenarios, ruta):
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    nombres = [e["nombre"] for e in escenarios]
    valores = [e["latencia_promedio_ms"] for e in escenarios]
    colores = [BORDE if e["capacidad"] == 0 else TINTA for e in escenarios]
    barras = ax.bar(nombres, valores, color=colores, width=0.55)
    for b, v in zip(barras, valores):
        ax.annotate(f"{v:.1f} ms", (b.get_x() + b.get_width() / 2, v),
                    xytext=(0, 4), textcoords="offset points", ha="center", color=TINTA, fontsize=9)
    ax.set_ylabel("Latencia promedio por consulta (ms)", color=GRIS)
    ax.set_title("Latencia promedio: sin caché vs. caché LRU", color=TINTA, loc="left")
    _estilo(ax)
    fig.tight_layout()
    fig.savefig(ruta)
    plt.close(fig)


def grafico_tasa(escenarios, ruta):
    con = [e for e in escenarios if e["capacidad"]]
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    x = [e["capacidad"] for e in con]
    y = [e["tasa_aciertos"] for e in con]
    ax.plot(x, y, color=ACENTO, linewidth=2, marker="o", markersize=6)
    for xi, yi in zip(x, y):
        ax.annotate(f"{yi:.1f} %", (xi, yi), xytext=(0, 8), textcoords="offset points",
                    ha="center", color=TINTA, fontsize=9)
    ax.set_xticks(x)
    ax.set_ylim(0, 100)
    ax.set_xlabel("Capacidad del caché (entradas)", color=GRIS)
    ax.set_ylabel("Tasa de aciertos (%)", color=GRIS)
    ax.set_title("Tasa de aciertos vs. capacidad", color=TINTA, loc="left")
    _estilo(ax)
    fig.tight_layout()
    fig.savefig(ruta)
    plt.close(fig)


def grafico_complejidad(filas, ruta):
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    x = [f["tamano"] for f in filas]
    ax.plot(x, [f["obtener_us"] for f in filas], color=ACENTO, linewidth=2, marker="o", label="obtener")
    ax.plot(x, [f["guardar_us"] for f in filas], color=TINTA, linewidth=2, marker="s", label="guardar")
    ax.set_xscale("log")
    ax.set_xticks(x, [f"{n:,}".replace(",", " ") for n in x])
    tope = max(max(f["obtener_us"], f["guardar_us"]) for f in filas)
    ax.set_ylim(0, tope * 1.6)
    ax.set_xlabel("Entradas en el caché (escala logarítmica)", color=GRIS)
    ax.set_ylabel("Tiempo por operación (µs)", color=GRIS)
    ax.set_title("obtener y guardar son O(1): el tiempo no crece con el tamaño", color=TINTA, loc="left")
    ax.legend(frameon=False, labelcolor=TINTA)
    _estilo(ax)
    fig.tight_layout()
    fig.savefig(ruta)
    plt.close(fig)


# ----------------------------------------------------------------------
def main(argv=None):
    p = argparse.ArgumentParser(description="Benchmark del caché LRU de Nimbus")
    p.add_argument("--consultas", type=int, default=1000, help="número de consultas (mínimo 1000)")
    p.add_argument("--latencia-ms", type=int, default=20, help="latencia del servicio simulado")
    p.add_argument("--semilla", type=int, default=42)
    args = p.parse_args(argv)
    if args.consultas < 1000:
        p.error("El enunciado pide al menos 1000 consultas.")

    lugares = lugares_benchmark()
    consultas = trafico_zipf(lugares, args.consultas, semilla=args.semilla)
    servicio = ServicioClimaSimulado(latencia_ms=args.latencia_ms)

    print(f"{args.consultas} consultas · {len(lugares)} lugares · Zipf s={ZIPF_S} · "
          f"semilla {args.semilla} · latencia {args.latencia_ms} ms\n")
    escenarios = []
    for capacidad in [None] + CAPACIDADES:
        e = correr_escenario(consultas, servicio, capacidad)
        escenarios.append(e)
        print(f"  {e['nombre']:<10} total {e['tiempo_total_s']:7.2f} s · "
              f"promedio {e['latencia_promedio_ms']:7.2f} ms · aciertos {e['tasa_aciertos']:5.1f} % · "
              f"API {e['llamadas_api']}")

    print("\nMidiendo obtener/guardar según el tamaño del caché…")
    complejidad = medir_complejidad()
    for f in complejidad:
        print(f"  n = {f['tamano']:>7}: obtener {f['obtener_us']:.2f} µs · guardar {f['guardar_us']:.2f} µs")

    CARPETA.mkdir(parents=True, exist_ok=True)
    grafico_latencia(escenarios, CARPETA / "latencia.png")
    grafico_tasa(escenarios, CARPETA / "tasa_aciertos.png")
    grafico_complejidad(complejidad, CARPETA / "complejidad.png")
    resultados = {
        "fecha": datetime.now(ZONA_LIMA).strftime("%Y-%m-%d %H:%M") + " (hora de Lima)",
        "configuracion": {"consultas": args.consultas, "lugares": len(lugares), "zipf_s": ZIPF_S,
                          "semilla": args.semilla, "latencia_ms": args.latencia_ms},
        "escenarios": escenarios,
        "complejidad": complejidad,
        "operaciones_complejidad": OPERACIONES_COMPLEJIDAD,
    }
    (CARPETA / "resultados.json").write_text(json.dumps(resultados, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nGráficos y resultados.json guardados en {CARPETA}")
    return resultados


if __name__ == "__main__":
    main()
