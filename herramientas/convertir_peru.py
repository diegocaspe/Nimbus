"""Convierte los límites del Perú (INEI, repositorio juaneladio/peru-geojson) en
GeoJSON compactos para el mapa del Perú.

Uso:
    python herramientas/convertir_peru.py <carpeta_entrada> frontend/static/data

La carpeta de entrada debe tener peru_departamental_simple.geojson,
peru_provincial_simple.geojson y peru_distrital_simple.geojson (o
departamental/provincial/distrital.geojson). Se dejan solo las propiedades
NOMBDEP, NOMBPROV y NOMBDIST, se simplifican los bordes (Douglas-Peucker) y
las coordenadas se redondean a 3 decimales (~100 m).
"""
import json
import sys
from pathlib import Path

TOLERANCIA = {"dep": 0.012, "prov": 0.006, "dist": 0.0025}


def dp(pts, tol):
    """Douglas-Peucker iterativo (el mismo de convertir_paises.py)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        a, b = pila.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        dmax, imax = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol * tol:
            keep[imax] = True
            pila += [(a, imax), (imax, b)]
    return [p for p, k in zip(pts, keep) if k]


def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


def leer(carpeta, nombre):
    for candidato in (f"peru_{nombre}_simple.geojson", f"{nombre}.geojson"):
        ruta = carpeta / candidato
        if ruta.exists():
            return json.loads(ruta.read_text(encoding="utf-8"))
    raise SystemExit(f"No encuentro {nombre} en {carpeta}")


def convertir(datos, tipo):
    salida = []
    for ft in datos["features"]:
        p, g = ft["properties"], ft["geometry"]
        if not g:
            continue
        props = {"NOMBDEP": p.get("NOMBDEP") or p.get("FIRST_NOMB")}
        if tipo in ("prov", "dist"):
            props["NOMBPROV"] = p["NOMBPROV"]
        if tipo == "dist":
            props["NOMBDIST"] = p["NOMBDIST"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        nuevos = []
        for poly in polys:
            anillos = []
            for anillo in poly:
                r = [[round(x, 3), round(y, 3)] for x, y in dp([tuple(c[:2]) for c in anillo], TOLERANCIA[tipo])]
                if len(r) >= 4 and area(r) > TOLERANCIA[tipo] ** 2:
                    anillos.append(r)
            if anillos:
                nuevos.append(anillos)
        if not nuevos:
            continue
        geom = {"type": "Polygon", "coordinates": nuevos[0]} if len(nuevos) == 1 else {"type": "MultiPolygon", "coordinates": nuevos}
        salida.append({"type": "Feature", "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "features": salida}


def main():
    entrada, destino = Path(sys.argv[1]), Path(sys.argv[2])
    for nombre, tipo, archivo in (("departamental", "dep", "departamentos"),
                                  ("provincial", "prov", "provincias"),
                                  ("distrital", "dist", "distritos")):
        geo = convertir(leer(entrada, nombre), tipo)
        texto = json.dumps(geo, ensure_ascii=False, separators=(",", ":"))
        (destino / f"{archivo}.geojson").write_text(texto, encoding="utf-8")
        print(f"{archivo}: {len(geo['features'])} regiones, {len(texto) // 1024} KB")


if __name__ == "__main__":
    main()
