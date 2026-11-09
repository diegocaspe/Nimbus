/* =========================================================
   Mapa del Perú "bloqueado" sobre el mismo globo 3D (proyección
   ortográfica en SVG, sin librerías) que la página de inicio.

   - Llega desde el globo con el mismo encuadre y se acerca al país.
   - Rueda / botones: zoom hacia el cursor. Arrastrar: mover (girar la esfera).
   - Zoom semántico: al acercar se pasa de Departamentos a Provincias
     y luego a Distritos (solo se dibuja lo que está a la vista).
   - Clic en una zona: la encuadra y muestra su clima (GET /clima).
   - "Mapa de calor": colorea cada zona por su temperatura actual
     (GET /calor, una sola llamada para departamentos y provincias).

   Límites: /static/data/*.geojson (INEI), generados con
   herramientas/convertir_peru.py.
   ========================================================= */
(function () {
  const D = Math.PI / 180;
  const CENTRO = 500;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ARCHIVOS = {
    dep: '/static/data/departamentos.geojson',
    prov: '/static/data/provincias.geojson',
    dist: '/static/data/distritos.geojson',
  };
  const PAISES = '/static/data/paises.json';
  const PROPS = { dep: 'NOMBDEP', prov: 'NOMBPROV', dist: 'NOMBDIST' };

  const Z_GLOBO = 2.4;                      // encuadre con el que termina el globo (globo.js)
  const PERU = { lat: -9.3, lon: -75 };     // mismo centro que usa globo.js al bloquear
  const LIMITES = { lon0: -82.5, lon1: -68, lat0: -19, lat1: 0.5 }; // el centro no sale del Perú
  // Zoom relativo al encuadre del país en el que cambia el nivel de detalle
  const REL_PROV = 1.9, REL_DIST = 7, REL_MAX = 90;
  const NIVELES = ['Departamentos', 'Provincias', 'Distritos'];
  const TIPOS = ['Departamento', 'Provincia', 'Distrito'];

  // Mapa de calor: 7 rangos fijos en °C. Colores: --calor-0 … --calor-6 (nimbus.css).
  const CORTES = [4, 8, 12, 16, 20, 24];
  const rangoDe = (t) => { let i = 0; while (i < CORTES.length && t >= CORTES[i]) i++; return i; };

  const $ = (id) => document.getElementById(id);
  const svg = $('mapa'), escena = $('escena'), tarjetaEl = $('tarjeta');
  const el = {
    oceano: $('mOceano'), borde: $('mBorde'), ret: $('mReticula'), retFina: $('mReticulaFina'),
    vecinos: $('mVecinos'), losa: $('mLosa'), regiones: $('mRegiones'), limProv: $('mLimProv'),
    limDep: $('mLimDep'), sel: $('mSel'), etiquetas: $('mEtiquetas'),
    hover: $('mHover'), guias: $('mGuias'),
  };
  const cartel = $('cartel');
  let hover = null; // zona bajo el mouse
  const cache = Nimbus.mapaCache($('mCache'), $('cacheCuenta'), () => pedirCuadro());
  const migasEl = $('migas'), nivelTxt = $('nivelTxt'), btnVolver = $('btnVolver');
  const btnCalor = $('btnCalor'), btnCalorTxt = $('btnCalorTxt'), leyenda = $('leyendaCalor'), avisoCalor = $('avisoCalor');

  const estado = { l0: PERU.lon, p0: PERU.lat, zoom: Z_GLOBO };
  let datos = null, vecinos = [], zPais = 6, bbPeru = null;
  let sel = null, modoCalor = false, temperaturasListas = false;
  let escala = 1, vista = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  let vuelo = null, arrastre = null, pendiente = false, nivelPrevio = -1;

  // ---------- Utilidades ----------
  const norm = (s) => Nimbus.sinTildes(String(s || '')).trim();
  const titulo = Nimbus.nombreLugar; // nombres con tildes (compartido con el globo)
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  function poligonos(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }

  /**
   * Cada anillo se guarda como [A, B, C] por punto, con A = cos(lat)·sen(lon),
   * B = cos(lat)·cos(lon), C = sen(lat): así proyectar no calcula senos ni
   * cosenos en cada cuadro (solo sumas y productos).
   */
  function precalcular(anillo) {
    const a = new Float64Array(anillo.length * 3);
    anillo.forEach(([lo, la], i) => {
      const cl = Math.cos(la * D);
      a[i * 3] = cl * Math.sin(lo * D); a[i * 3 + 1] = cl * Math.cos(lo * D); a[i * 3 + 2] = Math.sin(la * D);
    });
    return a;
  }

  function cajaLonLat(anillos) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of anillos) for (const [lo, la] of r) { a = Math.min(a, lo); c = Math.max(c, lo); b = Math.min(b, la); d = Math.max(d, la); }
    return [a, b, c, d]; // minLon, minLat, maxLon, maxLat
  }

  /** Centroide del polígono exterior más grande (etiqueta y coordenadas del clima). */
  function centroide(geom) {
    let mejor = null, areaMax = -1;
    for (const poli of poligonos(geom)) {
      const r = poli[0]; let A = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        A += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      if (Math.abs(A) > areaMax) { areaMax = Math.abs(A); mejor = A ? { lon: cx / (3 * A), lat: cy / (3 * A) } : { lon: r[0][0], lat: r[0][1] }; }
    }
    return mejor;
  }

  // ---------- Proyección ortográfica (la misma del globo) ----------
  let F = null; // constantes del cuadro actual
  function constantes() {
    const R = 400 * estado.zoom;
    F = { R, cl: Math.cos(estado.l0 * D), sl: Math.sin(estado.l0 * D), cp: Math.cos(estado.p0 * D), sp: Math.sin(estado.p0 * D) };
  }
  function proyectar(lon, lat) {
    const L = (lon - estado.l0) * D, P = lat * D, cp = Math.cos(P);
    return [cp * Math.sin(L), F.cp * Math.sin(P) - F.sp * cp * Math.cos(L), F.sp * Math.sin(P) + F.cp * cp * Math.cos(L)];
  }
  /** Anillo precalculado -> "M…Z" en unidades del viewBox. */
  function poligono(a) {
    const { R, cl, sl, cp, sp } = F;
    let s = 'M';
    for (let i = 0; i < a.length; i += 3) {
      const A = a[i], B = a[i + 1], C = a[i + 2];
      let x = A * cl - B * sl;              // cos(lat)·sen(lon − l0)
      const cL = B * cl + A * sl;           // cos(lat)·cos(lon − l0)
      let y = cp * C - sp * cL;
      if (sp * C + cp * cL < 0) { const h = Math.hypot(x, y) || 1; x /= h; y /= h; } // cara oculta: al borde
      s += (i ? 'L' : '') + (CENTRO + R * x).toFixed(1) + ',' + (CENTRO - R * y).toFixed(1);
    }
    return s + 'Z';
  }
  const ruta = (r) => r.anillos.map(poligono).join('');

  function inversa(sx, sy) {
    const R = 400 * estado.zoom;
    const x = (sx - CENTRO) / R, y = (CENTRO - sy) / R, rho = Math.hypot(x, y);
    if (rho > 1) return null;
    if (rho < 1e-9) return { lat: estado.p0, lon: estado.l0 };
    const P0 = estado.p0 * D, c = Math.asin(rho);
    const lat = Math.asin(Math.cos(c) * Math.sin(P0) + (y * Math.sin(c) * Math.cos(P0)) / rho) / D;
    const lon = estado.l0 + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(P0) - y * Math.sin(c) * Math.sin(P0)) / D;
    return { lat, lon };
  }

  /** Rectángulo en pantalla (unidades del viewBox) de una caja lon/lat; null si no se ve. */
  function cajaPantalla(bb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lo, la] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]], [(bb[0] + bb[2]) / 2, bb[3]], [(bb[0] + bb[2]) / 2, bb[1]]]) {
      const [x, y, z] = proyectar(lo, la);
      if (z < 0) return null;
      const sx = CENTRO + F.R * x, sy = CENTRO - F.R * y;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const m = 20 * escala;
    if (x1 < vista.x0 - m || x0 > vista.x1 + m || y1 < vista.y0 - m || y0 > vista.y1 + m) return null;
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- Nivel de detalle ----------
  const zoomRel = () => estado.zoom / zPais;
  function nivelActual() {
    const z = zoomRel();
    return z < REL_PROV ? 0 : z < REL_DIST ? 1 : 2;
  }

  // ---------- Dibujo ----------
  function reticula() {
    const lineas = (paso, lon0, lon1, lat0, lat1, muestra) => {
      let s = '';
      const trazo = (pts) => {
        let on = false;
        for (const [lo, la] of pts) {
          const [x, y, z] = proyectar(lo, la);
          if (z < 0) { on = false; continue; }
          s += (on ? 'L' : 'M') + (CENTRO + F.R * x).toFixed(1) + ',' + (CENTRO - F.R * y).toFixed(1);
          on = true;
        }
      };
      for (let lo = Math.ceil(lon0 / paso) * paso; lo <= lon1; lo += paso) { const p = []; for (let la = lat0; la <= lat1 + 1e-9; la += muestra) p.push([lo, la]); trazo(p); }
      for (let la = Math.ceil(lat0 / paso) * paso; la <= lat1; la += paso) { const p = []; for (let lo = lon0; lo <= lon1 + 1e-9; lo += muestra) p.push([lo, la]); trazo(p); }
      return s;
    };
    // Retícula global cada 20° (igual que el globo)
    el.ret.setAttribute('d', lineas(20, -180, 180, -80, 80, 4));

    // Retícula fina: más densa mientras más cerca (2°, 1°, 0,5°, 0,25°), solo en la zona visible
    const z = zoomRel();
    const paso = z < 0.6 ? 0 : z < 3 ? 2 : z < 12 ? 1 : z < 40 ? 0.5 : 0.25;
    if (!paso) { el.retFina.setAttribute('d', ''); return; }
    let lon0 = -94, lon1 = -58, lat0 = -28, lat1 = 9;
    const esq = [inversa(vista.x0, vista.y0), inversa(vista.x1, vista.y0), inversa(vista.x0, vista.y1), inversa(vista.x1, vista.y1)];
    if (esq.every(Boolean)) {
      lon0 = Math.max(lon0, Math.min(...esq.map((p) => p.lon)) - paso); lon1 = Math.min(lon1, Math.max(...esq.map((p) => p.lon)) + paso);
      lat0 = Math.max(lat0, Math.min(...esq.map((p) => p.lat)) - paso); lat1 = Math.min(lat1, Math.max(...esq.map((p) => p.lat)) + paso);
    }
    el.retFina.setAttribute('d', lineas(paso, lon0, lon1, lat0, lat1, paso / 2));
  }

  const pool = new Map();       // id de región -> <path>
  const etiquetasDom = new Map(); // id -> <text>

  function temperatura(r) {
    while (r) { if (r.temp != null) return r.temp; r = r.padre; }
    return null;
  }
  /** Departamento al que pertenece una zona (su color pastel lo heredan provincias y distritos). */
  const departamentoDe = (r) => { while (r && r.nivel > 0) r = r.padre; return r; };
  function colorear(p, r) {
    const t = modoCalor ? temperatura(r) : null;
    const d = departamentoDe(r);
    const c = t != null ? `var(--calor-${rangoDe(t)})` : d ? `var(--dep-${d.color})` : '';
    if (p.dataset.c !== c) { p.style.fill = c; p.dataset.c = c; }
    const txt = r.nombre + (t == null ? '' : ` · ${Math.round(t)} °C`);
    if (p.firstChild.textContent !== txt) p.firstChild.textContent = txt;
  }

  function dibujar() {
    constantes();
    const R = F.R;
    el.oceano.setAttribute('r', R.toFixed(1));
    el.borde.setAttribute('r', R.toFixed(1));
    reticula();

    // Países vecinos (contexto, atenuados)
    let v = '';
    for (const p of vecinos) if (cajaPantalla(p.bb)) for (const a of p.anillos) v += poligono(a);
    el.vecinos.setAttribute('d', v);
    if (!datos) return;

    const nivel = nivelActual();
    const lista = [datos.dep, datos.prov, datos.dist][nivel];

    // Departamentos visibles: base del relieve 3D y límites gruesos
    let dDep = '';
    for (const r of datos.dep) { r.caja = cajaPantalla(r.bb); r.d = r.caja ? ruta(r) : ''; dDep += r.d; }
    el.losa.setAttribute('d', dDep);
    // Relieve: el país como una losa con grosor, proyectada hacia abajo
    el.losa.setAttribute('transform', `translate(0 ${(Math.min(9, 3 + zoomRel() * 1.5) * escala).toFixed(2)})`);

    // Regiones del nivel actual (se reutilizan los <path>)
    const visibles = [];
    for (const r of lista) {
      if (nivel > 0) { r.caja = cajaPantalla(r.bb); if (!r.caja) continue; }
      else if (!r.caja) continue;
      visibles.push(r);
      let p = pool.get(r.id);
      if (!p) {
        p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('class', 'region3d');
        p.dataset.id = r.id;
        p.appendChild(document.createElementNS(SVGNS, 'title'));
        el.regiones.appendChild(p);
        pool.set(r.id, p);
      }
      p.setAttribute('d', nivel === 0 ? r.d : ruta(r));
      colorear(p, r);
      p.__vivo = true;
    }
    for (const [id, p] of pool) { if (!p.__vivo) { p.remove(); pool.delete(id); } else p.__vivo = false; }

    // Límites encima de las regiones
    el.limDep.setAttribute('d', nivel >= 1 ? dDep : '');
    let dProv = '';
    if (nivel === 2) for (const r of datos.prov) { const c = cajaPantalla(r.bb); if (c) dProv += ruta(r); }
    el.limProv.setAttribute('d', dProv);

    // Zona seleccionada y zona bajo el mouse
    el.sel.setAttribute('d', sel && cajaPantalla(sel.bb) ? ruta(sel) : '');
    if (hover && !pool.has(hover.id)) ocultarCartel();
    el.hover.setAttribute('d', hover ? ruta(hover) : '');

    // Puntos del caché
    cache.posicionar((lat, lon) => {
      const [x, y, z] = proyectar(lon, lat);
      return z > 0 ? [CENTRO + F.R * x, CENTRO - F.R * y] : null;
    }, escala);

    dibujarEtiquetas(visibles, nivel);

    if (nivel !== nivelPrevio) {
      nivelPrevio = nivel;
      nivelTxt.textContent = NIVELES[nivel];
      el.regiones.setAttribute('class', 'nivel-' + nivel); // grosor y opacidad de bordes por nivel (CSS)
    }
    btnVolver.disabled = !sel && zoomRel() < 1.08;
  }

  // ---------- Nombres (y temperatura en el mapa de calor) ----------
  function textoDe(r) {
    let tx = etiquetasDom.get(r.id);
    if (!tx) {
      tx = document.createElementNS(SVGNS, 'text');
      el.etiquetas.appendChild(tx);
      etiquetasDom.set(r.id, tx);
    }
    return tx;
  }
  function apagarEtiquetas(on) {
    for (const [id, tx] of etiquetasDom) {
      if (on.has(tx)) continue;
      tx.classList.remove('on');
      if (etiquetasDom.size > 400) { tx.remove(); etiquetasDom.delete(id); }
    }
  }

  /**
   * Nivel inicial: los 25 nombres (24 departamentos + Callao) SIEMPRE visibles.
   * Cada nombre prueba, en orden: dentro de su territorio con letra normal,
   * dentro con letra chica (con pequeños desplazamientos), y por último afuera
   * con una línea guía corta (primero hacia el oeste: el mar). No se oculta ninguno.
   */
  function etiquetasDepartamentos(visibles) {
    el.etiquetas.setAttribute('stroke-width', (3 * escala).toFixed(2));
    const cajas = [], on = new Set();
    let guias = '';
    const choca = (cx, cy, w, h) => {
      for (const c of cajas) if (Math.abs(c.x - cx) * 2 < c.w + w && Math.abs(c.y - cy) * 2 < c.h + h) return true;
      return false;
    };
    const FS = 10.5 * escala, FS_CHICA = 8.5 * escala;
    const medidas = (texto, fs) => [texto.length * fs * 0.8 + 6 * escala, fs * 1.4];
    // Los grandes eligen primero: los chicos usan lo que queda o una línea guía
    const orden = visibles.slice().sort((a, b) => b.caja.w * b.caja.h - a.caja.w * a.caja.h);
    const DIRS = [[-1, 0], [-0.8, 0.6], [-0.8, -0.6], [1, 0], [0.8, 0.6], [0.8, -0.6], [0, 1], [0, -1]];
    // Centro del país en pantalla: las líneas guía salen hacia afuera (y un poco hacia el oeste, el mar)
    const [pxc, pyc] = (() => { const [x, y] = proyectar((bbPeru[0] + bbPeru[2]) / 2, (bbPeru[1] + bbPeru[3]) / 2); return [CENTRO + F.R * x, CENTRO - F.R * y]; })();
    for (const r of orden) {
      const t = modoCalor ? temperatura(r) : null;
      const texto = r.nombre.toUpperCase() + (t == null ? '' : ` ${Math.round(t)}°`);
      const [x, y, z] = proyectar(r.lon, r.lat);
      if (z < 0) continue;
      const sx = CENTRO + F.R * x, sy = CENTRO - F.R * y;
      let pos = null;
      // 1) Dentro del territorio
      for (const fs of [FS, FS_CHICA]) {
        const [w, h] = medidas(texto, fs);
        if (w > r.caja.w * (fs === FS ? 1.05 : 1.25) || h > r.caja.h) continue;
        for (const dy of [0, -0.8, 0.8, -1.5, 1.5]) {
          if (!choca(sx, sy + dy * h, w, h)) { pos = { cx: sx, cy: sy + dy * h, fs, w, h }; break; }
        }
        if (pos) break;
      }
      // 2) Afuera, con línea guía
      if (!pos) {
        const [w, h] = medidas(texto, FS_CHICA);
        const ox = sx - pxc, oy = sy - pyc, on0 = Math.hypot(ox, oy) || 1;
        const dirs = DIRS.slice().sort(([ax, ay], [bx, by]) =>
          (bx * ox + by * oy) / on0 - 0.35 * bx - ((ax * ox + ay * oy) / on0 - 0.35 * ax));
        busca: for (const d of [26, 44, 64, 86, 110]) {
          for (const [ux, uy] of dirs) {
            const cx = sx + ux * (d * escala + w / 2), cy = sy + uy * (d * escala + h / 2);
            const enPantalla = cx - w / 2 > vista.x0 + 4 * escala && cx + w / 2 < vista.x1 - 4 * escala && cy - h / 2 > vista.y0 && cy + h / 2 < vista.y1;
            if (enPantalla && !choca(cx, cy, w, h)) { pos = { cx, cy, fs: FS_CHICA, w, h, guia: [ux, uy] }; break busca; }
          }
        }
        if (!pos) pos = { cx: sx, cy: sy, fs: FS_CHICA, w, h }; // último recurso: encima, pero visible
      }
      cajas.push({ x: pos.cx, y: pos.cy, w: pos.w, h: pos.h });
      if (pos.guia) {
        const [ux, uy] = pos.guia;
        const ex = pos.cx - ux * pos.w / 2, ey = pos.cy - uy * pos.h / 2;
        guias += `M${sx.toFixed(1)},${sy.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`;
        cajas.push({ x: (sx + ex) / 2, y: (sy + ey) / 2, w: Math.abs(ex - sx), h: Math.max(Math.abs(ey - sy), 2 * escala) });
      }
      const tx = textoDe(r);
      tx.setAttribute('class', 'et-region et-dep on' + (r === sel ? ' sel' : '') + (pos.guia ? ' con-guia' : ''));
      if (tx.textContent !== texto) tx.textContent = texto;
      tx.setAttribute('font-size', pos.fs.toFixed(2));
      tx.setAttribute('x', pos.cx.toFixed(1)); tx.setAttribute('y', pos.cy.toFixed(1));
      on.add(tx);
    }
    el.guias.setAttribute('d', guias);
    apagarEtiquetas(on);
  }

  function dibujarEtiquetas(visibles, nivel) {
    if (nivel === 0) return etiquetasDepartamentos(visibles);
    el.guias.setAttribute('d', '');
    // Provincias 11 px y distritos 10 px: se nota a qué nivel pertenece cada nombre
    const fs = (nivel === 1 ? 11 : 10) * escala;
    el.etiquetas.setAttribute('stroke-width', (3 * escala).toFixed(2));
    const panel = !tarjetaEl.hidden && window.innerWidth > 760 ? tarjetaEl.offsetWidth * escala : 0;
    const x0 = vista.x0 + 8 * escala, x1 = vista.x1 - panel - 8 * escala;
    const y0 = vista.y0 + 64 * escala, y1 = vista.y1 - 72 * escala; // deja libre la barra de arriba y los controles
    const cajas = [];
    const libre = (cx, cy, w, h) => {
      if (cx - w / 2 < x0 || cx + w / 2 > x1 || cy - h / 2 < y0 || cy + h / 2 > y1) return false;
      for (const c of cajas) if (Math.abs(c.x - cx) * 2 < c.w + w && Math.abs(c.y - cy) * 2 < c.h + h) return false;
      cajas.push({ x: cx, y: cy, w, h });
      return true;
    };
    const orden = visibles.slice().sort((a, b) => (b === sel) - (a === sel) || b.caja.w * b.caja.h - a.caja.w * a.caja.h);
    const on = new Set();
    for (const r of orden) {
      const t = modoCalor ? temperatura(r) : null;
      const contenido = r.nombre + (t == null ? '' : ` ${Math.round(t)}°`);
      const ancho = contenido.length * fs * 0.6 + 8 * escala;
      if (r !== sel && (r.caja.w < ancho * 0.55 || r.caja.h < fs * 1.2)) continue; // la zona es muy chica para su nombre
      const [x, y, z] = proyectar(r.lon, r.lat);
      if (z < 0) continue;
      const sx = CENTRO + F.R * x, sy = CENTRO - F.R * y;
      if (!libre(sx, sy, ancho, fs * 1.5)) continue;
      const tx = textoDe(r);
      tx.setAttribute('class', 'et-region on et-n' + nivel + (r === sel ? ' sel' : ''));
      if (tx.textContent !== contenido) tx.textContent = contenido;
      tx.setAttribute('font-size', fs.toFixed(2));
      tx.setAttribute('x', sx.toFixed(1)); tx.setAttribute('y', sy.toFixed(1));
      on.add(tx);
    }
    apagarEtiquetas(on);
  }

  /** Escala píxel → viewBox y área visible de la escena (el globo se sale del SVG al acercar). */
  function medir() {
    const r = svg.getBoundingClientRect(), e = escena.getBoundingClientRect();
    if (!r.width) return;
    escala = 1000 / r.width;
    vista = { x0: (e.left - r.left) * escala, x1: (e.right - r.left) * escala, y0: (e.top - r.top) * escala, y1: (e.bottom - r.top) * escala };
  }

  // ---------- Animación ----------
  function pedirCuadro() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(cuadro);
  }
  function cuadro() {
    pendiente = false;
    if (vuelo) {
      const k = Math.max(0, Math.min(1, (performance.now() - vuelo.t0) / vuelo.dur));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      estado.l0 = vuelo.l0 + (vuelo.l1 - vuelo.l0) * e;
      estado.p0 = vuelo.p0 + (vuelo.p1 - vuelo.p0) * e;
      estado.zoom = vuelo.z0 * Math.pow(vuelo.z1 / vuelo.z0, e); // interpolación logarítmica: el zoom se siente parejo
      if (k >= 1) { const fin = vuelo.fin; vuelo = null; if (fin) fin(); } else pedirCuadro();
    }
    dibujar();
  }
  /** Vuela a (lat, lon, zoom). Si no hay `t0`, empieza en el próximo cuadro. */
  function volar(destino, dur, fin) {
    vuelo = { t0: performance.now(), dur: dur || 650, l0: estado.l0, p0: estado.p0, z0: estado.zoom, l1: destino.lon, p1: destino.lat, z1: destino.zoom, fin };
    pedirCuadro();
  }

  /** Encuadre que muestra una caja lon/lat ocupando `frac` del mapa, sin quedar debajo de la tarjeta. */
  function encuadre(bb, frac, zMin, zMax) {
    const lat = (bb[1] + bb[3]) / 2, lon = (bb[0] + bb[2]) / 2;
    const dx = Math.max((bb[2] - bb[0]) * Math.cos(lat * D) * D, 1e-4), dy = Math.max((bb[3] - bb[1]) * D, 1e-4);
    // Espacio libre de la escena (en unidades del viewBox): sin la barra de arriba,
    // los controles de abajo ni la tarjeta del clima (a la derecha o, en celular, abajo)
    const movil = window.innerWidth <= 760;
    const tarjeta = tarjetaEl.hidden ? 0 : (movil ? tarjetaEl.offsetHeight : tarjetaEl.offsetWidth) * escala;
    const x0 = vista.x0, x1 = vista.x1 - (movil ? 0 : tarjeta);
    const y0 = vista.y0 + 70 * escala, y1 = vista.y1 - (movil && tarjeta ? tarjeta : 64 * escala);
    const W = Math.max(200 * escala, x1 - x0), H = Math.max(200 * escala, y1 - y0);
    const zoom = limitar(Math.min((W * frac) / (400 * dx), (H * frac) / (400 * dy)), zMin || 0, zMax || Infinity);
    // Mueve el centro para que la zona quede en medio del espacio libre
    const R = 400 * zoom;
    return { lat: lat + ((y0 + y1) / 2 - CENTRO) / R / D, lon: lon - ((x0 + x1) / 2 - CENTRO) / R / D / Math.cos(lat * D), zoom };
  }
  const encuadrePais = () => encuadre(bbPeru, 0.88);

  // ---------- Selección, migas y clima ----------
  function tipoDe(r) {
    if (r.nivel === 0 && norm(r.nombre) === 'callao') return 'Provincia Constitucional';
    return TIPOS[r.nivel];
  }

  function seleccionar(r) {
    sel = r;
    Nimbus.mostrarClima(tarjetaEl, { nombre: r.nombre, tipo: tipoDe(r), lat: r.lat, lon: r.lon }, () => {
      sel = null; pintarMigas(); pedirCuadro();
    });
    medir();
    // Departamento -> se ven sus provincias; provincia o distrito -> se ven los distritos
    const zMin = zPais * (r.nivel === 0 ? REL_PROV * 1.05 : REL_DIST * 1.05);
    const zMax = zPais * (r.nivel === 0 ? REL_DIST * 0.95 : REL_MAX);
    volar(encuadre(r.bb, r.nivel === 2 ? 0.45 : 0.6, zMin, zMax), 700);
    pintarMigas();
  }

  function verPais() {
    sel = null;
    tarjetaEl.hidden = true;
    pintarMigas();
    volar(encuadrePais(), 700);
  }

  function pintarMigas() {
    const cadena = [];
    for (let r = sel; r; r = r.padre) cadena.unshift(r);
    const m = [{ n: 'Perú', ir: verPais }].concat(cadena.map((r) => ({ n: r.nombre, ir: () => seleccionar(r) })));
    migasEl.innerHTML = '';
    m.forEach((x, i) => {
      if (i > 0) migasEl.insertAdjacentHTML('beforeend', '<span class="miga-sep" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'miga'; b.textContent = x.n;
      if (i === m.length - 1) b.setAttribute('aria-current', 'page');
      else b.addEventListener('click', x.ir);
      migasEl.appendChild(b);
    });
  }

  btnVolver.addEventListener('click', () => {
    if (sel && sel.padre) seleccionar(sel.padre);
    else verPais();
  });

  // ---------- Mapa de calor ----------
  function pintarLeyenda() {
    const etiquetas = ['< 4°'].concat(CORTES.slice(0, -1).map((c, i) => `${c}–${CORTES[i + 1]}°`), ['≥ 24°']);
    $('leyendaEscala').innerHTML = etiquetas.map((t, i) =>
      `<span class="leyenda-paso"><i style="background:var(--calor-${i})"></i><span>${t}</span></span>`).join('');
  }

  async function cargarTemperaturas() {
    const regiones = datos.dep.concat(datos.prov);
    const temps = await NimbusAPI.calor(regiones.map((r) => [r.lat, r.lon]));
    regiones.forEach((r, i) => { r.temp = temps[i]; });
    temperaturasListas = true;
  }

  btnCalor.addEventListener('click', async () => {
    avisoCalor.hidden = true;
    if (!modoCalor && !temperaturasListas) {
      btnCalor.disabled = true;
      btnCalorTxt.textContent = 'Cargando…';
      try {
        await cargarTemperaturas();
      } catch (e) {
        avisoCalor.textContent = 'No se pudo cargar el mapa de calor. ' + e.message;
        avisoCalor.hidden = false;
        return;
      } finally {
        btnCalor.disabled = false;
        btnCalorTxt.textContent = 'Mapa de calor';
      }
    }
    modoCalor = !modoCalor;
    escena.classList.toggle('calor', modoCalor);
    btnCalor.setAttribute('aria-pressed', String(modoCalor));
    leyenda.hidden = !modoCalor;
    pedirCuadro();
  });

  // ---------- Interacción ----------
  function limitarCentro() {
    estado.l0 = limitar(estado.l0, LIMITES.lon0, LIMITES.lon1);
    estado.p0 = limitar(estado.p0, LIMITES.lat0, LIMITES.lat1);
  }
  function zoomHacia(factor, sx, sy) {
    const z0 = estado.zoom;
    const z1 = limitar(z0 * factor, zPais * 0.8, zPais * REL_MAX);
    if (z1 === z0) return;
    const p = sx == null ? null : inversa(sx, sy);
    if (p) { // el punto bajo el cursor se queda bajo el cursor
      const k = 1 - z0 / z1;
      estado.l0 += (p.lon - estado.l0) * k;
      estado.p0 += (p.lat - estado.p0) * k;
    }
    estado.zoom = z1;
    limitarCentro();
    pedirCuadro();
  }

  const aViewBox = (e, rect) => [((e.clientX - rect.left) / rect.width) * 1000, ((e.clientY - rect.top) / rect.height) * 1000];

  // ---------- Resaltado y cartel al pasar el mouse ----------
  function ocultarCartel() {
    hover = null;
    cartel.hidden = true;
    el.hover.setAttribute('d', '');
  }
  function moverCartel(e) {
    if (arrastre || e.pointerType !== 'mouse' || !datos) return;
    const p = e.target.closest && e.target.closest('[data-id]');
    const r = p ? datos.porId.get(p.dataset.id) : null;
    if (!r) { if (hover) ocultarCartel(); return; }
    if (r !== hover) {
      hover = r;
      const t = modoCalor ? temperatura(r) : null;
      cartel.innerHTML = `<strong>${Nimbus.esc(r.nombre)}</strong><span>${Nimbus.esc(tipoDe(r))}${t == null ? '' : ' · ' + Math.round(t) + ' °C'}</span>`;
      cartel.hidden = false;
      pedirCuadro();
    }
    const caja = escena.getBoundingClientRect();
    let x = e.clientX - caja.left + 14, y = e.clientY - caja.top + 14;
    if (x + cartel.offsetWidth > caja.width - 8) x -= cartel.offsetWidth + 28; // no se sale por la derecha
    cartel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  svg.addEventListener('pointermove', moverCartel);
  svg.addEventListener('pointerleave', () => { if (hover) ocultarCartel(); });

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    vuelo = null;
    if (hover) ocultarCartel();
    // Segundo dedo: empieza un pellizco; el arrastre ya no cuenta como clic
    if (arrastre) { arrastre.movido = true; arrastre.multi = true; return; }
    arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY, l0: estado.l0, p0: estado.p0, movido: false, objetivo: e.target, rect: svg.getBoundingClientRect() };
    svg.classList.add('arrastrando');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id || arrastre.multi) return;
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.hypot(dx, dy) > 4) arrastre.movido = true;
    if (!arrastre.movido) return;
    const grados = (1000 / arrastre.rect.width) / (400 * estado.zoom) / D; // grados por píxel
    estado.l0 = arrastre.l0 - (dx * grados) / Math.cos(estado.p0 * D);
    estado.p0 = arrastre.p0 + dy * grados;
    limitarCentro();
    pedirCuadro();
  });
  function soltar(e) {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    const a = arrastre; arrastre = null;
    svg.classList.remove('arrastrando');
    if (a.movido || e.type !== 'pointerup') return;
    const p = a.objetivo.closest && a.objetivo.closest('[data-id]');
    if (p) seleccionar(datos.porId.get(p.dataset.id));
  }
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);
  // Pellizco con dos dedos (celulares): zoom hacia el punto medio
  Nimbus.pellizco(svg, (f, cx, cy) => {
    vuelo = null;
    const rect = svg.getBoundingClientRect();
    zoomHacia(f, ((cx - rect.left) / rect.width) * 1000, ((cy - rect.top) / rect.height) * 1000);
  });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    vuelo = null;
    const [sx, sy] = aViewBox(e, svg.getBoundingClientRect());
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomHacia(Math.exp(-limitar(delta, -120, 120) * 0.0022), sx, sy);
  }, { passive: false });
  $('zoomMas').addEventListener('click', () => { vuelo = null; zoomHacia(1.5); });
  $('zoomMenos').addEventListener('click', () => { vuelo = null; zoomHacia(1 / 1.5); });
  window.addEventListener('resize', () => { medir(); pedirCuadro(); });

  // Desbloquear: se aleja hasta el encuadre del globo, reaparecen los vecinos y vuelve al inicio
  $('btnDesbloquear').addEventListener('click', (e) => {
    e.preventDefault();
    const destino = e.currentTarget.href;
    sel = null;
    tarjetaEl.hidden = true;
    escena.classList.add('desbloqueando');
    volar({ lat: PERU.lat, lon: PERU.lon, zoom: Z_GLOBO }, 700, () => { location.href = destino.split('#')[0] + '#peru'; });
  });

  // ---------- Carga ----------
  function preparar(f, nivel, i) {
    const p = f.properties;
    const tipo = ['dep', 'prov', 'dist'][nivel];
    const anillosLL = [];
    for (const poli of poligonos(f.geometry)) for (const anillo of poli) anillosLL.push(anillo);
    const c = centroide(f.geometry);
    return {
      id: nivel + ':' + i, nivel, nombre: titulo(p[PROPS[tipo]]),
      dep: p[PROPS.dep], prov: p[PROPS.prov] || null,
      lat: c.lat, lon: c.lon, bb: cajaLonLat(anillosLL),
      anillos: anillosLL.map(precalcular), padre: null, temp: null, caja: null,
    };
  }

  async function cargar() {
    const json = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
    const [dep, prov, dist] = await Promise.all(Object.values(ARCHIVOS).map((u) => json(u).catch(() => ({ features: [] }))));
    datos = {
      dep: dep.features.map((f, i) => preparar(f, 0, i)),
      prov: prov.features.map((f, i) => preparar(f, 1, i)),
      dist: dist.features.map((f, i) => preparar(f, 2, i)),
      porId: new Map(),
    };
    // Enlaza cada zona con la de arriba (para migas, Volver y la temperatura de los distritos)
    const deps = new Map(datos.dep.map((d) => [norm(d.dep), d]));
    const provs = new Map(datos.prov.map((p) => [norm(p.dep) + '|' + norm(p.prov), p]));
    for (const p of datos.prov) p.padre = deps.get(norm(p.dep)) || null;
    for (const d of datos.dist) d.padre = provs.get(norm(d.dep) + '|' + norm(d.prov)) || deps.get(norm(d.dep)) || null;
    for (const lista of [datos.dep, datos.prov, datos.dist]) for (const r of lista) datos.porId.set(r.id, r);
    // Pastel sin repetir entre vecinos (el mismo color que en el globo)
    Nimbus.coloresVecinos(dep.features).forEach((c, k) => { datos.dep[k].color = c; });

    bbPeru = cajaLonLat([datos.dep.flatMap((d) => [[d.bb[0], d.bb[1]], [d.bb[2], d.bb[3]]])]);
    zPais = encuadre(bbPeru, 0.88).zoom;

    Nimbus.buscador($('buscar'), $('sugerencias'), (q) => {
      const r = [];
      for (const d of datos.dep) if (norm(d.nombre).includes(q)) r.push({ n: d.nombre, t: tipoDe(d), z: d });
      for (const p of datos.prov) if (norm(p.nombre).includes(q)) r.push({ n: p.nombre, t: 'Provincia · ' + titulo(p.dep), z: p });
      for (const d of datos.dist) if (norm(d.nombre).includes(q)) r.push({ n: d.nombre, t: 'Distrito · ' + titulo(d.prov) + ', ' + titulo(d.dep), z: d });
      return r;
    }, (it) => seleccionar(it.z));

    pintarMigas();
    pintarLeyenda();
    pedirCuadro();
    // Entrada: desde el encuadre del globo hasta el país completo
    setTimeout(() => volar(encuadrePais(), 900), 80);
  }

  async function cargarVecinos() {
    try {
      const lista = await fetch(PAISES).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
      // Solo Sudamérica y alrededores: el resto nunca entra en este encuadre
      vecinos = lista.filter((p) => p.c !== 'PER' && p.x > -95 && p.x < -30 && p.y > -60 && p.y < 15)
        .map((p) => ({ bb: cajaLonLat(p.a), anillos: p.a.map(precalcular) }));
      pedirCuadro();
    } catch (e) { /* sin vecinos el mapa sigue funcionando */ }
  }

  medir();
  pedirCuadro();
  cargarVecinos();
  cargar();
})();
