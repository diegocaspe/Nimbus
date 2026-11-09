/* =========================================================
   Utilidades compartidas: tema, íconos, tarjeta de clima, buscador.
   ========================================================= */
window.Nimbus = (function () {
  // ---------- Tema claro / oscuro ----------
  const btnTema = document.getElementById('btnTema');
  if (btnTema) {
    const etiquetar = (oscuro) => btnTema.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    etiquetar(document.documentElement.classList.contains('dark'));
    btnTema.addEventListener('click', () => {
      const oscuro = document.documentElement.classList.toggle('dark');
      etiquetar(oscuro);
      try { localStorage.setItem('nimbus-tema', oscuro ? 'oscuro' : 'claro'); } catch (e) {}
    });
  }

  // ---------- Íconos lineales monocromos (Lucide, 24x24, heredan currentColor) ----------
  const NUBE = '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>';
  const ICONOS = {
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    parcial: '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
    nubes: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    niebla: NUBE + '<path d="M16 17H7"/><path d="M17 21H9"/>',
    llovizna: NUBE + '<path d="M8 19v1"/><path d="M8 14v1"/><path d="M16 19v1"/><path d="M16 14v1"/><path d="M12 21v1"/><path d="M12 16v1"/>',
    lluvia: NUBE + '<path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
    nieve: NUBE + '<path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>',
    tormenta: '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
    cerrar: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  /** Códigos WMO (los que devuelve Open-Meteo en weather_code). */
  function condicion(codigo) {
    const c = Number(codigo);
    if (c === 0) return { k: 'sol', txt: 'Despejado' };
    if (c === 1) return { k: 'parcial', txt: 'Mayormente despejado' };
    if (c === 2) return { k: 'parcial', txt: 'Parcialmente nublado' };
    if (c === 3) return { k: 'nubes', txt: 'Nublado' };
    if (c === 45 || c === 48) return { k: 'niebla', txt: 'Niebla' };
    if (c >= 51 && c <= 57) return { k: 'llovizna', txt: 'Llovizna' };
    if (c >= 61 && c <= 67) return { k: 'lluvia', txt: 'Lluvia' };
    if (c >= 71 && c <= 77) return { k: 'nieve', txt: 'Nieve' };
    if (c >= 80 && c <= 82) return { k: 'lluvia', txt: 'Chubascos' };
    if (c === 85 || c === 86) return { k: 'nieve', txt: 'Nevadas' };
    if (c >= 95) return { k: 'tormenta', txt: 'Tormenta' };
    return { k: 'nubes', txt: '—' };
  }

  function icono(nombre, tam, grosor) {
    return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${grosor || 1.5}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre]}</svg>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const redondo = (n) => Math.round(Number(n));
  function coordsTxt(lat, lon) {
    return Math.abs(lat).toFixed(2) + '° ' + (lat < 0 ? 'S' : 'N') + ' · ' + Math.abs(lon).toFixed(2) + '° ' + (lon < 0 ? 'O' : 'E');
  }
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function diaCorto(fecha) {
    const [a, m, d] = fecha.split('-').map(Number);
    return DIAS[new Date(a, m - 1, d).getDay()];
  }

  // ---------- Tarjeta de clima ----------
  /**
   * Pinta la tarjeta. `info` = { nombre, tipo?, lat, lon }.
   * `respuesta` = JSON de /clima (o null mientras carga).
   */
  function tarjeta(el, info, respuesta, alCerrar) {
    const cab = `
      <div class="t-cab">
        <div>
          ${info.tipo ? `<span class="t-tipo">${esc(info.tipo)}</span>` : ''}
          <h2 class="t-nombre">${esc(info.nombre)}</h2>
          <span class="t-coords">${coordsTxt(info.lat, info.lon)}</span>
        </div>
        <button type="button" class="iconbtn" data-cerrar aria-label="Cerrar">${icono('cerrar', 18)}</button>
      </div>`;
    let cuerpo;
    if (!respuesta) {
      cuerpo = `
        <div class="t-cuerpo" aria-busy="true">
          <span class="origen"><span class="punto"></span>Consultando…</span>
          <div class="esqueleto" style="height:80px;width:55%"></div>
          <div class="esqueleto" style="height:112px"></div>
          <div class="esqueleto" style="height:200px"></div>
        </div>`;
    } else if (respuesta.error) {
      cuerpo = `<div class="t-cuerpo"><p class="t-error" role="alert">${esc(respuesta.error)}</p></div>`;
    } else {
      const a = respuesta.actual;
      const c = condicion(a.codigo);
      const enCache = respuesta.origen === 'cache';
      const ms = Number(respuesta.tiempo_ms);
      const msTxt = ms < 10 ? ms.toFixed(1) : Math.round(ms);
      const dias = respuesta.pronostico || [];
      const minS = Math.min(...dias.map((d) => d.min)), maxS = Math.max(...dias.map((d) => d.max));
      const rango = Math.max(1, maxS - minS);
      cuerpo = `
        <div class="t-cuerpo">
          <div class="t-actual">
            <div class="t-temp-fila">
              <span class="t-temp">${redondo(a.temperatura)}°</span>
              <span class="origen origen-grande ${enCache ? 'origen-cache' : 'origen-api'}" title="Origen del dato y tiempo de respuesta del backend">
                <span class="punto"></span><span>${enCache ? 'Desde caché' : 'Desde la API'} · ${msTxt} ms</span>
              </span>
            </div>
            <span class="t-cond">${icono(c.k, 18)}${c.txt}</span>
          </div>
          <div class="t-datos">
            <div class="t-dato"><span>Sensación térmica</span><span>${redondo(a.sensacion_termica)}°</span></div>
            <div class="t-dato"><span>Humedad</span><span>${redondo(a.humedad)} %</span></div>
            <div class="t-dato"><span>Viento</span><span>${redondo(a.viento_kmh)} km/h</span></div>
            <div class="t-dato"><span>Prob. de lluvia</span><span>${redondo(a.prob_lluvia)} %</span></div>
          </div>
          <div class="t-dias">
            <span class="t-seccion">Próximos ${dias.length} días</span>
            ${dias.map((d) => {
              const cd = condicion(d.codigo);
              const izq = ((d.min - minS) / rango) * 100, ancho = Math.max(8, ((d.max - d.min) / rango) * 100);
              return `<div class="t-dia">
                <span>${diaCorto(d.fecha)}</span>
                <span title="${cd.txt}">${icono(cd.k, 18)}</span>
                <span class="t-min">${redondo(d.min)}°</span>
                <span class="t-rango"><i style="left:${izq}%;width:${Math.min(ancho, 100 - izq)}%"></i></span>
                <span class="t-max">${redondo(d.max)}°</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }
    el.innerHTML = cab + cuerpo;
    el.hidden = false;
    el.querySelector('[data-cerrar]').addEventListener('click', () => { el.hidden = true; if (alCerrar) alCerrar(); });
  }

  /**
   * Consulta /clima y actualiza la tarjeta (con esqueleto mientras carga).
   * Ignora respuestas viejas si el usuario hizo otra consulta mientras tanto.
   */
  let turno = 0;
  async function mostrarClima(el, info, alCerrar) {
    const mio = ++turno;
    const primeraVez = el.hidden;
    tarjeta(el, info, null, alCerrar);
    if (!primeraVez) el.style.animation = 'none';
    let r;
    try { r = await NimbusAPI.clima(info.nombre, info.lat, info.lon); }
    catch (e) { r = { error: 'No se pudo obtener el clima. ' + e.message }; }
    if (mio !== turno) return;
    tarjeta(el, info, r, alCerrar);
    el.style.animation = '';
  }

  // ---------- Buscador con autocompletado ----------
  /**
   * @param fuente  función (texto) => [{ n, t, ... }] o una Promesa de esa lista
   *                (por ejemplo, la que consulta GET /buscar en el backend)
   * @param alElegir función (item)
   */
  function buscador(input, lista, fuente, alElegir) {
    let items = [], activo = -1, espera = null, pedido = 0;
    const cerrar = () => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); activo = -1; };
    const pintar = () => {
      lista.innerHTML = items.map((it, i) => `
        <li class="sugerencia ${i === activo ? 'activa' : ''}" role="option" id="sug-${i}" data-i="${i}" aria-selected="${i === activo}">
          <span class="sug-nombre">${esc(it.n)}</span><span class="sug-tipo">${esc(it.t)}</span>
        </li>`).join('');
      lista.hidden = items.length === 0;
      input.setAttribute('aria-expanded', String(items.length > 0));
      if (activo >= 0) input.setAttribute('aria-activedescendant', 'sug-' + activo); else input.removeAttribute('aria-activedescendant');
    };
    const elegir = (it) => { input.value = ''; cerrar(); input.blur(); alElegir(it); };
    input.addEventListener('input', () => {
      const texto = input.value.trim();
      clearTimeout(espera);
      // Espera 200 ms a que el usuario deje de escribir para no llamar al backend en cada tecla
      espera = setTimeout(async () => {
        const mio = ++pedido;
        let r = [];
        try { r = texto ? await fuente(sinTildes(texto), texto) : []; } catch (e) { r = []; }
        if (mio !== pedido) return; // llegó una respuesta vieja: se ignora
        items = r.slice(0, 7);
        activo = items.length ? 0 : -1;
        pintar();
      }, 200);
    });
    input.addEventListener('keydown', (e) => {
      if (lista.hidden) return;
      if (e.key === 'ArrowDown') { activo = (activo + 1) % items.length; pintar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { activo = (activo - 1 + items.length) % items.length; pintar(); e.preventDefault(); }
      else if (e.key === 'Enter' && activo >= 0) { elegir(items[activo]); e.preventDefault(); }
      else if (e.key === 'Escape') cerrar();
    });
    lista.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]');
      if (li) { e.preventDefault(); elegir(items[+li.dataset.i]); }
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
  }

  // ---------- Lugares del Perú (compartido por el globo y el modo Perú) ----------
  // Los datos del INEI vienen en mayúsculas y casi sin tildes: se corrigen las palabras más comunes.
  const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el']);
  const TILDES = {
    ancash: 'Áncash', apurimac: 'Apurímac', huanuco: 'Huánuco', junin: 'Junín', martin: 'Martín',
    peru: 'Perú', maranon: 'Marañón', canete: 'Cañete', ferrenafe: 'Ferreñafe', canar: 'Cañar',
    camana: 'Camaná', caraveli: 'Caravelí', jaen: 'Jaén', concepcion: 'Concepción', bolivar: 'Bolívar',
    angel: 'Ángel', jose: 'José', maria: 'María', ramon: 'Ramón', simon: 'Simón', andres: 'Andrés',
    ines: 'Inés', lucia: 'Lucía', sebastian: 'Sebastián', tomas: 'Tomás', agustin: 'Agustín',
    jesus: 'Jesús', fermin: 'Fermín', nicolas: 'Nicolás', ascension: 'Ascensión', asuncion: 'Asunción',
    limon: 'Limón', rimac: 'Rímac', ancon: 'Ancón', lurin: 'Lurín',
  };
  /** "MADRE DE DIOS" -> "Madre de Dios", "JUNIN" -> "Junín". */
  const nombreLugar = (s) => String(s).toLowerCase().split(' ')
    .map((p, i) => (i > 0 && MENORES.has(p) ? p : TILDES[p] || p.charAt(0).toUpperCase() + p.slice(1))).join(' ');

  function poligonosDe(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    return [];
  }

  /**
   * Índice de color pastel (0…5, --dep-0 … --dep-5) para cada feature, sin repetir
   * el de sus vecinos (coloreo voraz de grafos, los de más vecinos primero).
   * Dos zonas son vecinas si tienen vértices a menos de ~2 km (los bordes
   * simplificados no comparten exactamente los mismos puntos).
   */
  function coloresVecinos(features) {
    const CELDA = 0.02;
    const celdas = new Map(); // "i,j" -> Set de índices
    features.forEach((f, k) => {
      for (const poli of poligonosDe(f.geometry)) for (const anillo of poli) for (const [lo, la] of anillo) {
        const c = Math.floor(lo / CELDA) + ',' + Math.floor(la / CELDA);
        if (!celdas.has(c)) celdas.set(c, new Set());
        celdas.get(c).add(k);
      }
    });
    const vecinos = features.map(() => new Set());
    for (const [c, s] of celdas) {
      const [i, j] = c.split(',').map(Number);
      const cerca = new Set(s);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const o = celdas.get((i + a) + ',' + (j + b)); if (o) o.forEach((k) => cerca.add(k)); }
      for (const k of s) for (const m of cerca) if (k !== m) vecinos[k].add(m);
    }
    const color = features.map(() => -1);
    const orden = features.map((_, k) => k).sort((a, b) => vecinos[b].size - vecinos[a].size);
    for (const k of orden) {
      const usados = new Set([...vecinos[k]].map((m) => color[m]));
      let c = 0; while (usados.has(c)) c++;
      color[k] = c % 6;
    }
    return color;
  }

  /** Centroide del polígono exterior más grande: { lon, lat }. */
  function centroideDe(geom) {
    let mejor = null, areaMax = -1;
    for (const poli of poligonosDe(geom)) {
      const r = poli[0]; let A = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        A += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      if (Math.abs(A) > areaMax) { areaMax = Math.abs(A); mejor = A ? { lon: cx / (3 * A), lat: cy / (3 * A) } : { lon: r[0][0], lat: r[0][1] }; }
    }
    return mejor;
  }

  // ---------- Mapa del caché ----------
  /**
   * Dibuja un punto que brilla en cada lugar guardado ahora en el caché.
   * Consulta GET /estadisticas cada 2 s (nodos de cabeza a cola, con su clave
   * "lat,lon"). Un lugar que sale del caché (LRU o TTL vencido, ttl_restante = 0)
   * se apaga con una animación corta y luego se quita.
   *
   * @param capa      <g> del SVG donde van los puntos
   * @param contador  elemento donde se escribe cuántos lugares hay (opcional)
   * @param alCambiar función que el mapa usa para redibujar
   * @returns { posicionar(fn, escala) } — fn(lat, lon) -> [x, y] en el viewBox, o null si no se ve
   */
  function mapaCache(capa, contador, alCambiar) {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const puntos = new Map(); // clave -> { lat, lon, g }

    function sincronizar(nodos) {
      const vivos = new Set();
      for (const n of nodos) {
        if (!(n.ttl_restante > 0)) continue; // vencido: ya no cuenta como guardado
        vivos.add(n.clave);
        if (puntos.has(n.clave)) continue;
        const [lat, lon] = String(n.clave).split(',').map(Number);
        if (!isFinite(lat) || !isFinite(lon)) continue;
        const g = document.createElementNS(SVGNS, 'g');
        g.setAttribute('class', 'cache-punto');
        g.innerHTML = '<circle class="cache-halo" r="9"/><circle class="cache-nucleo" r="3.5"/>';
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = (n.nombre || n.clave) + ' · guardado en caché';
        g.appendChild(t);
        capa.appendChild(g);
        puntos.set(n.clave, { lat, lon, g });
      }
      for (const [clave, p] of puntos) {
        if (vivos.has(clave)) continue;
        puntos.delete(clave);
        p.g.classList.add('apagando');
        setTimeout(() => p.g.remove(), 320);
      }
      if (contador) contador.textContent = vivos.size === 1 ? '1 lugar' : vivos.size + ' lugares';
      if (alCambiar) alCambiar();
    }

    async function consultar() {
      if (document.hidden) return;
      try { sincronizar((await NimbusAPI.estadisticas()).nodos || []); } catch (e) { /* sin servidor: se reintenta */ }
    }
    consultar();
    setInterval(consultar, 2000);

    return {
      /** Ubica cada punto; `escala` (unidades del viewBox por píxel) mantiene su tamaño en pantalla. */
      posicionar(fn, escala) {
        for (const p of puntos.values()) {
          const xy = fn(p.lat, p.lon);
          if (!xy) { p.g.setAttribute('visibility', 'hidden'); continue; }
          p.g.removeAttribute('visibility');
          p.g.setAttribute('transform', `translate(${xy[0].toFixed(1)} ${xy[1].toFixed(1)}) scale(${escala.toFixed(3)})`);
        }
      },
    };
  }

  // ---------- Gestos con dos dedos ----------
  /**
   * Sigue los punteros activos de un elemento. Con dos dedos llama
   * alPellizcar(factor, cx, cy) con el cambio de distancia entre ellos y el
   * punto medio (en coordenadas de cliente). Devuelve cuántos punteros hay.
   */
  function pellizco(elemento, alPellizcar) {
    const activos = new Map();
    let distancia = 0;
    const medir = () => {
      const [a, b] = [...activos.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };
    elemento.addEventListener('pointerdown', (e) => {
      activos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activos.size === 2) distancia = medir().d;
    });
    elemento.addEventListener('pointermove', (e) => {
      if (!activos.has(e.pointerId)) return;
      activos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activos.size !== 2) return;
      const m = medir();
      if (distancia > 0 && m.d > 0) alPellizcar(m.d / distancia, m.cx, m.cy);
      distancia = m.d;
    });
    const quitar = (e) => { activos.delete(e.pointerId); distancia = 0; };
    elemento.addEventListener('pointerup', quitar);
    elemento.addEventListener('pointercancel', quitar);
    return { cuantos: () => activos.size };
  }

  return {
    icono, esc, sinTildes, coordsTxt, condicion, tarjeta, mostrarClima, buscador, mapaCache, pellizco,
    nombreLugar, poligonosDe, coloresVecinos, centroideDe,
  };
})();
