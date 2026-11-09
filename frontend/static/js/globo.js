/* =========================================================
   Globo 3D (proyección ortográfica en SVG, sin librerías).
   - Arrastrar: gira   - Rueda / botones: zoom
   - Rotación automática lenta cuando no se usa
   - Clic en un punto: tarjeta de clima de ese lugar
   - Países: /static/data/paises.json (Natural Earth 1:50m, simplificado
     con herramientas/convertir_paises.py). Los nombres aparecen al
     acercar: primero los países grandes y, con más zoom, los pequeños
     y las ciudades.
   ========================================================= */
(function () {
  const D = Math.PI / 180;
  const CENTRO = 500;
  const ZOOM_MIN = 0.75, ZOOM_MAX = 8;
  const DATOS = '/static/data/paises.json';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Respaldo si no carga paises.json: contornos simplificados [lon, lat].
  const TIERRA = [
    [[-77.3,8.6],[-80,7.5],[-83,8.4],[-85.8,10.5],[-87.6,13.2],[-91.4,14],[-94.5,16.2],[-96.5,15.7],[-101,17.3],[-105.5,20],[-105.7,22.5],[-109.4,25.8],[-112.2,29],[-114.7,31.7],[-117.1,32.5],[-120.6,34.5],[-124,40.3],[-124.5,48.3],[-130,54.5],[-140,59.8],[-152,59.5],[-165,62],[-166,68],[-156,71.3],[-140,69.6],[-128,70],[-110,68],[-95,68],[-82,66],[-78,62],[-70,60],[-64,60],[-61,56],[-55.8,51.6],[-59.8,47.6],[-64.6,47.5],[-66,44.5],[-70,41.6],[-74,40.5],[-75.5,35.2],[-81,31.5],[-80,25.3],[-81.8,26.5],[-83,29.5],[-89,30.2],[-94,29.6],[-97.4,27.5],[-97.7,22],[-95.9,18.8],[-91,18.8],[-90.4,21],[-87,21.5],[-88,18.5],[-88.2,15.8],[-84,15.9],[-83.2,15],[-83.6,11],[-81.7,9],[-79.5,9.6]],
    [[-77.3,8.6],[-75.5,10.5],[-71.6,12.4],[-68,10.8],[-64,10.6],[-61.5,10.6],[-60,8.5],[-57,6],[-52,5],[-50,1.8],[-48.5,-1],[-44.5,-2.5],[-39,-3.5],[-35.2,-5.5],[-35,-9],[-39,-13.5],[-39.2,-17.7],[-40.9,-22],[-44.5,-23.2],[-48.6,-26],[-48.6,-28.5],[-52,-32.2],[-53.4,-33.7],[-56.5,-36.3],[-57.5,-38.5],[-62,-39],[-65,-41],[-64.4,-42.5],[-67.5,-46],[-65.8,-47.8],[-68.3,-50.2],[-68.4,-52.3],[-69,-55],[-71.5,-53.8],[-74.5,-52],[-75.5,-47],[-73.7,-42],[-73.5,-37],[-71.6,-33],[-71.4,-28],[-70.4,-23.5],[-70.3,-18.4],[-71.3,-17.6],[-72.7,-16.6],[-75.2,-15.4],[-76.2,-13.7],[-77.1,-12.05],[-78.6,-9.1],[-79.9,-6.8],[-81.1,-5.8],[-81.33,-4.68],[-80.3,-3.4],[-80.9,-1],[-80.1,0.8],[-79,1.6],[-77.8,3.5],[-77.4,6.7]],
    [[-17,14.7],[-16.8,21],[-13,27.6],[-9.6,30.5],[-5.9,35.8],[10.3,37],[11.1,33],[20,31.5],[32,31.3],[34,27],[39,21],[43,12.6],[51.2,11.8],[51,10.5],[47,4],[41,-2],[39.5,-6],[40.5,-11],[40,-16],[35.5,-24],[32.9,-26],[30.5,-31],[26,-33.8],[20,-34.8],[18.4,-34],[17.6,-30.5],[15,-27],[11.8,-17],[13.4,-11.7],[12.2,-6],[9.6,-1.5],[9.6,3.5],[8.5,4.5],[6,4.3],[2,6.3],[-4,5.2],[-7.6,4.4],[-11.5,6.9],[-13.3,9],[-15,10.9]],
    [[-9.5,43],[-9,37],[-6,36.2],[-2,36.7],[3.2,41.9],[7.5,43.7],[12.4,44.2],[12,47],[8.5,54],[5,53],[2,51],[-1.5,49.5],[-4.5,48.4],[-1.2,46],[-1.8,43.4]],
    [[-5.7,50],[1.5,51],[1.7,52.7],[-0.3,54],[-2,55.9],[-3,58.6],[-5,58.6],[-6,56.5],[-4.8,54.8],[-3,53.4],[-4.6,52.8],[-5.3,51.7]],
    [[-45,60],[-43,60],[-22,70],[-18,77],[-30,83],[-60,82],[-70,77],[-58,75],[-52,69],[-50,64]],
    [[-84.9,21.8],[-82,23.1],[-77,21],[-74.2,20.2],[-77.7,19.9],[-80,21.8]],
  ];
  const PERU = [[-75.2,-0.05],[-75.6,-0.9],[-75.3,-1.6],[-76.6,-2.6],[-77.9,-3.0],[-78.4,-3.5],[-78.7,-4.6],[-79.3,-4.9],[-79.6,-4.4],[-80.1,-4.3],[-80.3,-3.4],[-80.9,-3.9],[-81.33,-4.68],[-81.1,-5.8],[-80.8,-6.1],[-79.9,-6.8],[-79.4,-7.6],[-79.0,-8.1],[-78.6,-9.1],[-77.7,-10.7],[-77.1,-12.05],[-76.6,-12.9],[-76.2,-13.7],[-75.9,-14.6],[-75.2,-15.4],[-74.2,-15.9],[-72.7,-16.6],[-71.3,-17.6],[-70.4,-18.35],[-69.9,-18.1],[-69.5,-17.5],[-69.6,-17.2],[-69.0,-16.6],[-68.9,-16.2],[-69.4,-15.6],[-69.2,-15.3],[-68.8,-14.6],[-68.9,-13.7],[-68.7,-12.5],[-69.6,-11.0],[-70.6,-11.0],[-70.5,-9.5],[-71.3,-10.0],[-72.2,-10.0],[-72.4,-9.5],[-73.2,-9.4],[-72.9,-9.1],[-73.6,-8.4],[-74.0,-7.5],[-73.7,-6.9],[-73.1,-5.6],[-72.9,-5.2],[-72.0,-4.5],[-70.9,-4.4],[-70.0,-4.3],[-69.95,-4.2],[-70.7,-3.8],[-71.7,-2.2],[-72.6,-2.4],[-73.5,-1.6],[-74.3,-1.0],[-74.8,-0.3]];

  const LUGARES = window.NIMBUS_LUGARES;
  const CIUDADES = LUGARES.filter((l) => l.t.startsWith('Ciudad'));

  const $ = (id) => document.getElementById(id);
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const svg = $('globo'), tarjetaEl = $('tarjeta'), escena = svg.parentElement;
  const el = { oceano: $('gOceano'), ret: $('gReticula'), tierra: $('gTierra'), peru: $('gPeru'), ciudades: $('gCiudades'), etiquetas: $('gEtiquetas'), pin: $('gPin'), borde: $('gBorde') };

  el.deps = $('gDeps'); el.guias = $('gGuias'); el.depHover = $('gDepHover');
  const cartel = $('cartel');
  const pinAnim = el.pin.querySelector('.pin-anim');

  // ---------- Privilegio de Perú: departamentos en el globo ----------
  // Desde ZOOM_PERU (Perú ocupa buena parte de la pantalla) se dibujan sus 24
  // departamentos + Callao encima del país, con relleno pastel, nombre y clic propio.
  // Los demás países no cambian. Provincias y distritos solo existen en /peru.
  const DEPARTAMENTOS = '/static/data/departamentos.geojson';
  const ZOOM_PERU = 3.4;
  const CENTRO_PERU = { lat: -9.3, lon: -75 };
  let DEPS = null;          // [{ nombre, tipo, color, anillos, bb, lat, lon, el }]
  let depHover = null;
  const enPeruCiudad = (c) => /Perú/.test(c.t);
  function modoPeru() {
    return !!DEPS && estado.zoom >= ZOOM_PERU && proyectar(CENTRO_PERU.lon, CENTRO_PERU.lat)[2] > 0.35;
  }

  /** Punto de consulta del clima: el centroide si cae dentro del departamento; si no, el punto interior más cercano a él. */
  function centroVisual(geom, anillos, bb) {
    const c = Nimbus.centroideDe(geom);
    const dentro = (lon, lat) => { let k = false; for (const a of anillos) if (dentroDe(lon, lat, a)) k = !k; return k; };
    if (dentro(c.lon, c.lat)) return c;
    let mejor = null, dmin = Infinity;
    for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
      const lon = bb[0] + (bb[2] - bb[0]) * i / 16, lat = bb[1] + (bb[3] - bb[1]) * j / 16;
      const d = Math.hypot(lon - c.lon, lat - c.lat);
      if (d < dmin && dentro(lon, lat)) { dmin = d; mejor = { lon, lat }; }
    }
    return mejor || c;
  }

  async function cargarDepartamentos() {
    try {
      const geo = await fetch(DEPARTAMENTOS).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
      const colores = Nimbus.coloresVecinos(geo.features);
      DEPS = geo.features.map((f, i) => {
        const anillos = [];
        for (const poli of Nimbus.poligonosDe(f.geometry)) for (const a of poli) anillos.push(a);
        let bb = [Infinity, Infinity, -Infinity, -Infinity];
        for (const a of anillos) for (const [lo, la] of a) bb = [Math.min(bb[0], lo), Math.min(bb[1], la), Math.max(bb[2], lo), Math.max(bb[3], la)];
        const nombre = Nimbus.nombreLugar(f.properties.NOMBDEP);
        const c = centroVisual(f.geometry, anillos, bb);
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('class', 'g-dep');
        p.dataset.dep = i;
        p.style.fill = `var(--dep-${colores[i]})`;
        el.deps.appendChild(p);
        return {
          nombre, tipo: Nimbus.sinTildes(nombre) === 'callao' ? 'Provincia Constitucional' : 'Departamento',
          anillos, bb, lat: c.lat, lon: c.lon, el: p,
        };
      });
      dibujar();
    } catch (e) { /* sin departamentos el globo funciona igual que antes */ }
  }

  function abrirDepartamento(d) {
    abrirClima({ n: d.nombre + ', Perú', t: d.tipo, lat: d.lat, lon: d.lon });
  }
  function depEn(lat, lon) {
    if (!DEPS) return null;
    for (const d of DEPS) {
      if (lon < d.bb[0] || lon > d.bb[2] || lat < d.bb[1] || lat > d.bb[3]) continue;
      let k = false;
      for (const a of d.anillos) if (dentroDe(lon, lat, a)) k = !k;
      if (k) return d;
    }
    return null;
  }
  // Puntos que brillan en los lugares guardados en el caché (GET /estadisticas cada 2 s)
  const cache = Nimbus.mapaCache($('gCache'), $('cacheCuenta'), () => dibujar());
  const estado = { l0: -66, p0: -12, zoom: 1, pin: null };
  let ultimoUso = 0, vuelo = null, arrastre = null, tarjetaAbierta = false;
  let PAISES = null;            // [{ n: nombre, c: código ISO, r: rango de etiqueta, x/y: punto de etiqueta, a: anillos }]
  let escala = 1;               // unidades del viewBox por píxel de pantalla
  let vista = { x0: 0, y0: 0, x1: 1000, y1: 1000 }; // área visible de la escena, en unidades del viewBox

  // ---------- Proyección ortográfica ----------
  function proyectar(lon, lat) {
    const L = (lon - estado.l0) * D, P = lat * D, P0 = estado.p0 * D, cp = Math.cos(P);
    return [
      cp * Math.sin(L),
      Math.cos(P0) * Math.sin(P) - Math.sin(P0) * cp * Math.cos(L),
      Math.sin(P0) * Math.sin(P) + Math.cos(P0) * cp * Math.cos(L), // > 0 = cara visible
    ];
  }
  const px = (x, R) => (CENTRO + R * x).toFixed(1);
  const py = (y, R) => (CENTRO - R * y).toFixed(1);

  function poligono(coords, R) {
    const pts = coords.map(([lo, la]) => proyectar(lo, la));
    if (pts.every((p) => p[2] < 0)) return '';
    return 'M' + pts.map(([x, y, c]) => {
      if (c < 0) { const h = Math.hypot(x, y) || 1; x /= h; y /= h; } // pega al borde lo que queda detrás
      return px(x, R) + ',' + py(y, R);
    }).join(' ') + 'Z';
  }
  function linea(pts, R) {
    let s = '', trazo = false;
    for (const [lo, la] of pts) {
      const [x, y, c] = proyectar(lo, la);
      if (c < 0) { trazo = false; continue; }
      s += (trazo ? 'L' : 'M') + px(x, R) + ',' + py(y, R);
      trazo = true;
    }
    return s;
  }
  function inversa(sx, sy, R) {
    const x = (sx - CENTRO) / R, y = (CENTRO - sy) / R, rho = Math.hypot(x, y);
    if (rho > 1) return null;
    if (rho < 1e-6) return { lat: estado.p0, lon: estado.l0 };
    const P0 = estado.p0 * D, c = Math.asin(rho);
    const lat = Math.asin(Math.cos(c) * Math.sin(P0) + (y * Math.sin(c) * Math.cos(P0)) / rho) / D;
    let lon = estado.l0 + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(P0) - y * Math.sin(c) * Math.sin(P0)) / D;
    lon = ((lon + 540) % 360) - 180;
    return { lat, lon };
  }

  // ---------- Dibujo ----------
  function dibujar() {
    const R = 400 * estado.zoom;
    el.oceano.setAttribute('r', R.toFixed(1));
    el.borde.setAttribute('r', R.toFixed(1));
    let ret = '';
    for (let lo = -180; lo < 180; lo += 20) { const p = []; for (let la = -80; la <= 80; la += 4) p.push([lo, la]); ret += linea(p, R); }
    for (let la = -60; la <= 60; la += 20) { const p = []; for (let lo = -180; lo <= 180; lo += 4) p.push([lo, la]); ret += linea(p, R); }
    el.ret.setAttribute('d', ret);
    if (PAISES) {
      let tierra = '', peru = '';
      for (const p of PAISES) {
        if (proyectar(p.clon, p.clat)[2] <= p.margen) continue; // en la cara oculta
        let d = '';
        for (const anillo of p.a) d += poligono(anillo, R);
        if (p.c === 'PER') peru = d; else tierra += d;
      }
      el.tierra.setAttribute('d', tierra);
      el.peru.setAttribute('d', peru);
    } else {
      el.tierra.setAttribute('d', TIERRA.map((c) => poligono(c, R)).join(''));
      el.peru.setAttribute('d', poligono(PERU, R));
    }
    // Departamentos de Perú (aparecen y desaparecen con un fundido, ver .modo-peru en CSS)
    const enPeru = modoPeru();
    escena.classList.toggle('modo-peru', enPeru);
    if (DEPS && estado.zoom >= ZOOM_PERU * 0.85) for (const d of DEPS) d.el.setAttribute('d', d.anillos.map((a) => poligono(a, R)).join(''));
    if (depHover) el.depHover.setAttribute('d', depHover.el.getAttribute('d'));
    if (!enPeru && depHover) ocultarCartel();
    dibujarEtiquetas(R, enPeru);
    let puntos = '';
    for (const c of CIUDADES) {
      if (enPeru && enPeruCiudad(c)) continue; // en Perú mandan los departamentos
      const [x, y, v] = proyectar(c.lon, c.lat);
      if (v > 0.08) { const cx = CENTRO + R * x, cy = CENTRO - R * y; puntos += `M${(cx - 2.5).toFixed(1)},${cy.toFixed(1)}a2.5,2.5 0 1 0 5,0a2.5,2.5 0 1 0 -5,0`; }
    }
    el.ciudades.setAttribute('d', puntos);
    if (estado.pin) {
      const [x, y, v] = proyectar(estado.pin.lon, estado.pin.lat);
      el.pin.toggleAttribute('hidden', v <= 0); // en SVG, .hidden no existe como propiedad
      el.pin.setAttribute('transform', `translate(${px(x, R)} ${py(y, R)})`);
    } else el.pin.setAttribute('hidden', '');
    cache.posicionar((lat, lon) => {
      const [x, y, v] = proyectar(lon, lat);
      return v > 0.02 ? [CENTRO + R * x, CENTRO - R * y] : null;
    }, escala);
    escena.classList.toggle('acercado', estado.zoom > 1.25);
  }

  // ---------- Nombres de continentes, países y ciudades según el zoom ----------
  // Niveles fijos: cada nivel muestra TODOS sus nombres a la vez (con un fundido).
  //   alejado (< 1.5)      -> continentes
  //   medio   (1.5 a 3)    -> países grandes y medianos (rango Natural Earth <= 3)
  //   cercano (>= 3)       -> todos los países; desde 3.2 también las ciudades
  // Los nombres van en LABEL_X/LABEL_Y de Natural Earth: el centro visual del
  // territorio principal (dentro del país aunque tenga islas lejanas).
  const NIVEL_MEDIO = 1.5, NIVEL_CERCANO = 3, ZOOM_CIUDADES = 3.2, RANGO_MEDIO = 3;
  const CONTINENTES = [
    ['América del Norte', -100, 46], ['América del Sur', -60, -16], ['Europa', 18, 53], ['África', 20, 4],
    ['Asia', 92, 46], ['Oceanía', 134, -25], ['Antártida', 0, -80],
  ];
  const nivelNombres = (z) => (z < NIVEL_MEDIO ? 0 : z < NIVEL_CERCANO ? 1 : 2);

  const etiquetasDom = new Map();
  function etiqueta(clave, texto, clase) {
    let t = etiquetasDom.get(clave);
    if (!t) {
      t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('class', clase);
      t.textContent = texto;
      el.etiquetas.appendChild(t);
      etiquetasDom.set(clave, t);
    }
    return t;
  }

  /**
   * Los 25 nombres de departamentos, SIEMPRE todos. Cada uno prueba: dentro de su
   * territorio con letra normal, dentro con letra chica (con pequeños desplazamientos)
   * y, si no cabe, afuera con una línea guía corta hacia fuera del país (de
   * preferencia hacia el oeste: el mar). Se colocan antes que países y ciudades.
   */
  function etiquetasDepartamentos(R, choca, poner) {
    const FS = 10 * escala, FS_CHICA = 8 * escala;
    const medidas = (texto, fs) => [texto.length * fs * 0.8 + 6 * escala, fs * 1.4];
    const pc = proyectar(CENTRO_PERU.lon, CENTRO_PERU.lat);
    const pcx = CENTRO + R * pc[0], pcy = CENTRO - R * pc[1];
    const DIRS = [[-1, 0], [-0.8, 0.6], [-0.8, -0.6], [1, 0], [0.8, 0.6], [0.8, -0.6], [0, 1], [0, -1]];
    // Caja en pantalla de cada departamento (para saber si su nombre cabe adentro)
    const lista = DEPS.map((d) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [lo, la] of [[d.bb[0], d.bb[1]], [d.bb[2], d.bb[1]], [d.bb[0], d.bb[3]], [d.bb[2], d.bb[3]]]) {
        const [x, y] = proyectar(lo, la);
        const sx = CENTRO + R * x, sy = CENTRO - R * y;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { d, w: x1 - x0, h: y1 - y0 };
    }).sort((a, b) => b.w * b.h - a.w * a.h); // los grandes eligen primero
    let guias = '';
    for (const { d, w: cw, h: ch } of lista) {
      const texto = d.nombre.toUpperCase();
      const [x, y] = proyectar(d.lon, d.lat);
      const sx = CENTRO + R * x, sy = CENTRO - R * y;
      let pos = null;
      for (const fs of [FS, FS_CHICA]) { // 1) dentro del territorio
        const [w, h] = medidas(texto, fs);
        if (w > cw * (fs === FS ? 1.05 : 1.25) || h > ch) continue;
        for (const dy of [0, -0.8, 0.8, -1.5, 1.5]) if (!choca(sx, sy + dy * h, w, h)) { pos = { cx: sx, cy: sy + dy * h, fs, w, h }; break; }
        if (pos) break;
      }
      if (!pos) { // 2) afuera, con línea guía
        const [w, h] = medidas(texto, FS_CHICA);
        const ox = sx - pcx, oy = sy - pcy, n = Math.hypot(ox, oy) || 1;
        const puntaje = ([ux, uy]) => (ux * ox + uy * oy) / n - 0.35 * ux;
        const dirs = DIRS.slice().sort((a, b) => puntaje(b) - puntaje(a));
        busca: for (const dist of [22, 38, 56, 76, 100]) for (const [ux, uy] of dirs) {
          const cx = sx + ux * (dist * escala + w / 2), cy = sy + uy * (dist * escala + h / 2);
          const enPantalla = cx - w / 2 > vista.x0 + 4 * escala && cx + w / 2 < vista.x1 - 4 * escala && cy - h / 2 > vista.y0 && cy + h / 2 < vista.y1;
          if (enPantalla && !choca(cx, cy, w, h)) { pos = { cx, cy, fs: FS_CHICA, w, h, guia: [ux, uy] }; break busca; }
        }
        if (!pos) pos = { cx: sx, cy: sy, fs: FS_CHICA, w, h }; // último recurso: encima, pero visible
      }
      const t = etiqueta('d:' + d.nombre, texto, 'et-dep-globo');
      poner(t, pos.cx, pos.cy, pos.fs, pos.w, pos.h);
      if (pos.guia) {
        const [ux, uy] = pos.guia;
        const ex = pos.cx - ux * pos.w / 2, ey = pos.cy - uy * pos.h / 2;
        guias += `M${sx.toFixed(1)},${sy.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`;
      }
    }
    el.guias.setAttribute('d', guias);
  }

  function dibujarEtiquetas(R, enPeru) {
    el.etiquetas.setAttribute('stroke-width', (3 * escala).toFixed(2));
    const visibles = new Set(), cajas = [];
    const choca = (cx, cy, w, h) => {
      for (const c of cajas) if (Math.abs(c.x - cx) * 2 < c.w + w && Math.abs(c.y - cy) * 2 < c.h + h) return true;
      return false;
    };
    const poner = (t, sx, sy, fs, w, h) => {
      t.setAttribute('x', sx.toFixed(1)); t.setAttribute('y', sy.toFixed(1));
      t.setAttribute('font-size', fs.toFixed(2));
      cajas.push({ x: sx, y: sy, w, h });
      visibles.add(t);
    };
    const nivel = nivelNombres(estado.zoom);
    const Rpx = R / escala; // radio del globo en píxeles de pantalla

    if (enPeru) etiquetasDepartamentos(R, choca, poner);
    else el.guias.setAttribute('d', '');

    if (nivel === 0) {
      for (const [n, lon, lat] of CONTINENTES) {
        const [x, y, z] = proyectar(lon, lat);
        if (z < 0.25) continue; // en la cara oculta
        const fs = 11 * escala, w = n.length * fs * 0.85;
        poner(etiqueta('k:' + n, n, 'et-continente'), CENTRO + R * x, CENTRO - R * y, fs, w, fs * 1.6);
      }
    } else if (PAISES) {
      for (const p of PAISES) { // ordenados por rango: los grandes primero, así eligen sitio antes
        if (nivel === 1 && p.r > RANGO_MEDIO) continue;
        if (enPeru && p.c === 'PER') continue; // Perú se nombra por departamentos
        const [x, y, z] = proyectar(p.x, p.y);
        if (z < 0.15) continue; // detrás del globo o pegado al borde: no se puede leer
        const sx = CENTRO + R * x, sy = CENTRO - R * y;
        // Letra según el ancho del país en pantalla (8 a 13 px), más chica para nombres largos
        const anchoPx = Rpx * p.ancho * z;
        const tope = p.r <= 2 ? 13 : p.r <= 3 ? 11.5 : 10.5;
        const base = limitar(anchoPx / (p.n.length * 0.62), 8, tope);
        const t = etiqueta('p:' + p.c, p.n, 'et-pais');
        // Si choca: primero se desplaza un poco, luego se achica la letra. Nunca se oculta.
        let hecho = false;
        for (const k of [1, 0.85, 0.72]) {
          const fs = Math.max(7, base * k) * escala, w = p.n.length * fs * 0.7 + 4 * escala, h = fs * 1.35;
          for (const [dx, dy] of [[0, 0], [0, -0.9], [0, 0.9], [-0.25, 0], [0.25, 0], [0, -1.6], [0, 1.6]]) {
            const cx = sx + dx * w, cy = sy + dy * h;
            if (!choca(cx, cy, w, h)) { poner(t, cx, cy, fs, w, h); hecho = true; break; }
          }
          if (hecho) break;
        }
        if (!hecho) { const fs = 7 * escala; poner(t, sx, sy, fs, p.n.length * fs * 0.7, fs * 1.35); }
      }
    }
    if (estado.zoom >= ZOOM_CIUDADES) { // ciudades: solo donde queda espacio libre
      for (const c of CIUDADES) {
        if (enPeru && enPeruCiudad(c)) continue; // no se confunden con los departamentos
        const [x, y, z] = proyectar(c.lon, c.lat);
        if (z < 0.2) continue;
        const fs = 10 * escala, sx = CENTRO + R * x + 7 * escala, sy = CENTRO - R * y;
        const w = c.n.length * fs * 0.6;
        if (choca(sx + w / 2, sy, w, fs * 1.4)) continue;
        const t = etiqueta('c:' + c.n, c.n, 'et-ciudad');
        t.setAttribute('font-size', fs.toFixed(2));
        t.setAttribute('x', sx.toFixed(1)); t.setAttribute('y', sy.toFixed(1));
        cajas.push({ x: sx + w / 2, y: sy, w, h: fs * 1.4 });
        visibles.add(t);
      }
    }
    for (const t of etiquetasDom.values()) t.classList.toggle('on', visibles.has(t));
  }

  /** Escala píxel → viewBox y área visible de la escena (el globo se sale del SVG al acercar). */
  function medir() {
    const r = svg.getBoundingClientRect(), e = svg.parentElement.getBoundingClientRect();
    if (!r.width) return;
    escala = 1000 / r.width;
    vista = { x0: (e.left - r.left) * escala, x1: (e.right - r.left) * escala, y0: (e.top - r.top) * escala, y1: (e.bottom - r.top) * escala };
  }

  // ---------- Países ----------
  /** Centro y radio angular de cada país, para saltar rápido los que están en la cara oculta. */
  function prepararPais(p) {
    let sx = 0, sy = 0, sz = 0;
    const vs = [];
    for (const anillo of p.a) for (const [lo, la] of anillo) {
      const v = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
      vs.push(v); sx += v[0]; sy += v[1]; sz += v[2];
    }
    const n = Math.hypot(sx, sy, sz) || 1;
    sx /= n; sy /= n; sz /= n;
    let cosMin = 1;
    for (const v of vs) cosMin = Math.min(cosMin, v[0] * sx + v[1] * sy + v[2] * sz);
    // Ancho del territorio principal (anillo más grande), en radianes: decide el tamaño de la letra
    let mayor = p.a[0], areaMax = -1;
    for (const anillo of p.a) {
      let s = 0;
      for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) s += anillo[j][0] * anillo[i][1] - anillo[i][0] * anillo[j][1];
      if (Math.abs(s) > areaMax) { areaMax = Math.abs(s); mayor = anillo; }
    }
    let lo0 = Infinity, lo1 = -Infinity;
    for (const [lo] of mayor) { lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
    p.ancho = Math.min(lo1 - lo0, 60) * Math.cos(p.y * D) * D;
    p.clon = Math.atan2(sy, sx) / D;
    p.clat = Math.asin(Math.max(-1, Math.min(1, sz))) / D;
    // Visible si el centro está a menos de 90° + radio de la vista (cos > -sen(radio)).
    p.margen = cosMin < 0 ? -1.01 : -Math.sqrt(1 - cosMin * cosMin);
    return p;
  }

  function dentroDe(lon, lat, anillo) {
    let c = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function paisEn(lat, lon) {
    if (!PAISES) return null;
    for (const p of PAISES) {
      let c = false;
      for (const anillo of p.a) if (dentroDe(lon, lat, anillo)) c = !c; // par-impar: respeta los huecos
      if (c) return p;
    }
    return null;
  }

  // ---------- Animación: vuelo + rotación automática ----------
  function volar(lat, lon, zoom) {
    vuelo = { t0: performance.now(), l0: estado.l0, p0: estado.p0, z0: estado.zoom, l1: lon, p1: Math.max(-70, Math.min(70, lat)), z1: zoom || Math.max(estado.zoom, 1.5) };
  }
  function cuadro(t) {
    if (vuelo) {
      const k = Math.min(1, (t - vuelo.t0) / 700);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      let dl = vuelo.l1 - vuelo.l0; dl = ((dl + 540) % 360) - 180; // camino más corto
      estado.l0 = vuelo.l0 + dl * e;
      estado.p0 = vuelo.p0 + (vuelo.p1 - vuelo.p0) * e;
      estado.zoom = vuelo.z0 + (vuelo.z1 - vuelo.z0) * e;
      if (k >= 1) { vuelo = null; ultimoUso = Date.now(); }
      dibujar();
    } else if (!arrastre && !tarjetaAbierta && !modoPeru() && Date.now() - ultimoUso > 2500) { // mirando Perú de cerca no gira
      estado.l0 += 0.04; // rotación lenta en reposo
      dibujar();
    }
    requestAnimationFrame(cuadro);
  }

  // ---------- Clima ----------
  /** Ciudad cercana al clic (el radio se achica con el zoom); si no hay, el país; si no, el punto. */
  function nombrar(lat, lon) {
    let mejor = null, dmin = 3.5 / estado.zoom;
    const sinPeru = modoPeru(); // con los departamentos a la vista, las ciudades de Perú están ocultas
    for (const p of CIUDADES) {
      if (sinPeru && enPeruCiudad(p)) continue;
      const d = Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos(lat * D));
      if (d < dmin) { dmin = d; mejor = p; }
    }
    if (mejor) return mejor;
    const pais = paisEn(lat, lon);
    return pais ? { n: pais.n, t: 'País', lat, lon } : { n: 'Punto seleccionado', t: '', lat, lon };
  }
  function abrirClima(lugar) {
    tarjetaAbierta = true;
    estado.pin = { lat: lugar.lat, lon: lugar.lon };
    pinAnim.classList.remove('pin-anim'); // reinicia la animación de caída del pin
    requestAnimationFrame(() => pinAnim.classList.add('pin-anim'));
    dibujar();
    Nimbus.mostrarClima(tarjetaEl, { nombre: lugar.n, tipo: lugar.t, lat: lugar.lat, lon: lugar.lon }, () => {
      tarjetaAbierta = false; estado.pin = null; ultimoUso = Date.now(); dibujar();
    });
  }

  // ---------- Interacción ----------
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    vuelo = null;
    // Segundo dedo: empieza un pellizco; el arrastre ya no cuenta como clic
    if (arrastre) { arrastre.movido = true; arrastre.multi = true; return; }
    if (depHover) ocultarCartel();
    arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, l0: estado.l0, p0: estado.p0, movido: false, objetivo: e.target, rect: svg.getBoundingClientRect() };
    svg.classList.add('arrastrando');
  });

  // Cartel y resaltado del departamento bajo el mouse
  function ocultarCartel() {
    depHover = null;
    cartel.hidden = true;
    el.depHover.setAttribute('d', '');
  }
  svg.addEventListener('pointermove', (e) => {
    if (arrastre || e.pointerType !== 'mouse') return;
    const p = modoPeru() && e.target.closest && e.target.closest('[data-dep]');
    const d = p ? DEPS[+p.dataset.dep] : null;
    if (!d) { if (depHover) ocultarCartel(); return; }
    if (d !== depHover) {
      // El resaltado va en una capa aparte: los polígonos no se reordenan, así el clic
      // siempre cae en el mismo departamento que se ve resaltado
      depHover = d;
      el.depHover.setAttribute('d', d.el.getAttribute('d'));
      cartel.innerHTML = `<strong>${Nimbus.esc(d.nombre)}</strong><span>${Nimbus.esc(d.tipo)} · Perú</span>`;
      cartel.hidden = false;
    }
    const caja = escena.getBoundingClientRect();
    let x = e.clientX - caja.left + 14, y = e.clientY - caja.top + 14;
    if (x + cartel.offsetWidth > caja.width - 8) x -= cartel.offsetWidth + 28;
    cartel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  svg.addEventListener('pointerleave', () => { if (depHover) ocultarCartel(); });
  svg.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id || arrastre.multi) return;
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.hypot(dx, dy) > 4) arrastre.movido = true;
    const k = (180 / (arrastre.rect.width * estado.zoom)) * 1.1;
    estado.l0 = arrastre.l0 - dx * k;
    estado.p0 = Math.max(-75, Math.min(75, arrastre.p0 + dy * k));
    dibujar();
  });
  function soltar(e) {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    const a = arrastre; arrastre = null; ultimoUso = Date.now();
    svg.classList.remove('arrastrando');
    if (a.movido || e.type !== 'pointerup') return;
    const sx = ((e.clientX - a.rect.left) / a.rect.width) * 1000;
    const sy = ((e.clientY - a.rect.top) / a.rect.height) * 1000;
    const p = inversa(sx, sy, 400 * estado.zoom);
    // Con Perú en primer plano, un clic dentro de Perú elige el DEPARTAMENTO (no el país ni una ciudad)
    if (modoPeru()) {
      const dp = a.objetivo && a.objetivo.closest && a.objetivo.closest('[data-dep]');
      const d = dp ? DEPS[+dp.dataset.dep] : p && depEn(p.lat, p.lon);
      if (d) return abrirDepartamento(d);
    }
    if (p) { const l = nombrar(p.lat, p.lon); abrirClima({ n: l.n, t: l.t, lat: l.lat, lon: l.lon }); }
  }
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);
  // Pellizco con dos dedos (celulares): zoom
  Nimbus.pellizco(svg, (f) => {
    ultimoUso = Date.now(); vuelo = null;
    estado.zoom = limitar(estado.zoom * f, ZOOM_MIN, ZOOM_MAX);
    dibujar();
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault(); ultimoUso = Date.now(); vuelo = null;
    estado.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, estado.zoom * (e.deltaY < 0 ? 1.1 : 0.91)));
    dibujar();
  }, { passive: false });
  $('zoomMas').addEventListener('click', () => { ultimoUso = Date.now(); vuelo = null; estado.zoom = Math.min(ZOOM_MAX, estado.zoom * 1.3); dibujar(); });
  $('zoomMenos').addEventListener('click', () => { ultimoUso = Date.now(); vuelo = null; estado.zoom = Math.max(ZOOM_MIN, estado.zoom / 1.3); dibujar(); });
  window.addEventListener('resize', () => { medir(); dibujar(); });

  // Bloquear en Perú: el globo viaja hasta el Perú y el resto del mundo se apaga.
  // peru.js arranca con este mismo encuadre (centro -9.3, -75 y zoom 2.4), así el cambio de página no se nota.
  let bloqueando = false;
  $('btnBloquear').addEventListener('click', (e) => {
    e.preventDefault();
    if (bloqueando) return;
    bloqueando = true;
    const destino = e.currentTarget.href;
    tarjetaEl.hidden = true; tarjetaAbierta = false; estado.pin = null;
    escena.classList.add('bloqueando');
    vuelo = { t0: performance.now(), l0: estado.l0, p0: estado.p0, z0: estado.zoom, l1: -75, p1: -9.3, z1: 2.4 };
    setTimeout(() => { location.href = destino; }, 820);
  });

  // Vuelta desde el mapa del Perú (/#peru): empieza en el encuadre del Perú y se aleja.
  if (location.hash === '#peru') {
    history.replaceState(null, '', location.pathname);
    Object.assign(estado, { l0: -75, p0: -9.3, zoom: 2.4 });
    escena.classList.add('bloqueando');
    setTimeout(() => {
      escena.classList.remove('bloqueando');
      volar(-12, -66, 1);
    }, 120);
  }

  Nimbus.buscador($('buscar'), $('sugerencias'),
    async (q, texto) => {
      // Departamentos de Perú primero (ya cargados en el globo)
      const r = [];
      if (DEPS) for (const d of DEPS) if (Nimbus.sinTildes(d.nombre).includes(q)) r.push({ n: d.nombre, t: d.tipo + ' · Perú', dep: d });
      // Lugares: GET /buscar (Open-Meteo o lista local en modo sin conexión)
      if (texto.length >= 2) {
        try { for (const l of await NimbusAPI.buscar(texto)) r.push({ n: l.nombre, t: l.detalle, lat: l.lat, lon: l.lon }); } catch (e) { /* quedan los locales */ }
      }
      // Países: ya están cargados en el globo, se filtran aquí
      if (PAISES) for (const p of PAISES) if (Nimbus.sinTildes(p.n).includes(q)) r.push({ n: p.n, t: 'País', lat: p.y, lon: p.x, pais: true });
      return r;
    },
    (l) => {
      if (l.dep) { // gira y se acerca al departamento (siempre con zoom de departamentos) y abre su clima
        const d = l.dep;
        const ancho = Math.max((d.bb[2] - d.bb[0]) * Math.cos(d.lat * D), d.bb[3] - d.bb[1]) * D;
        volar(d.lat, d.lon, limitar(350 / (400 * ancho), ZOOM_PERU * 1.25, ZOOM_MAX));
        return abrirDepartamento(d);
      }
      volar(l.lat, l.lon, l.pais ? 2.6 : 3.5); abrirClima(l);
    });

  cargarDepartamentos();

  // Carga los países; mientras tanto (o si falla) se usa el contorno de respaldo.
  fetch(DATOS)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((lista) => { PAISES = lista.map(prepararPais); dibujar(); })
    .catch(() => {});

  medir();
  dibujar();
  requestAnimationFrame(cuadro);
})();
