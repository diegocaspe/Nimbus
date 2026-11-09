"""Convierte Natural Earth 50m (admin 0) en un JSON compacto para el globo."""
import json, sys

def dp(pts, tol):
    """Douglas-Peucker iterativo."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        a, b = pila.pop()
        ax, ay = pts[a]; bx, by = pts[b]
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

entrada, salida, tol = sys.argv[1], sys.argv[2], float(sys.argv[3])
d = json.load(open(entrada, encoding='utf-8'))
paises, total = [], 0
for ft in d['features']:
    p, g = ft['properties'], ft['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    anillos = []
    for poly in polys:
        for r in poly:
            s = dp([(round(x, 2), round(y, 2)) for x, y in r], tol)
            if len(s) >= 4:
                anillos.append([[x, y] for x, y in s])
    if not anillos:  # país diminuto: conserva su anillo mayor sin simplificar
        r = max((r for poly in polys for r in poly), key=area)
        anillos = [[[round(x, 2), round(y, 2)] for x, y in r]]
    total += sum(len(r) for r in anillos)
    paises.append({
        'n': p.get('NAME_ES') or p['NAME'],
        'c': p['ADM0_A3'],
        'r': p.get('MIN_LABEL') or 10,
        'x': round(p['LABEL_X'], 2), 'y': round(p['LABEL_Y'], 2),
        'a': anillos,
    })
paises.sort(key=lambda q: q['r'])
json.dump(paises, open(salida, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('paises', len(paises), 'puntos', total)
