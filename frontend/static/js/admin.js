/* =========================================================
   Panel de administrador. Todo viene del backend Flask:
     GET  /estadisticas               métricas + comparación con/sin caché + aviso de API
     GET  /admin/registro             últimas consultas (con "pionera" y quién consultó)
     GET  /admin/simulacion/estado    progreso de la simulación
     GET  /admin/dinamica/resumen     "Resumen de la sala" (solo consultas del público)
     POST /admin/configuracion        capacidad, ttl, sin_conexion, latencia_ms
     POST /admin/metricas/reiniciar   métricas, tiempos y registro en cero
   Todas las horas que manda el backend ya vienen en hora de Lima (UTC-5).
     GET  /admin/benchmark            resultados del benchmark
   Las métricas se actualizan por polling cada ~1 s; la lista animada
   la maneja VisorLista (visor_lista.js) con su propio sondeo de 250 ms.
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = Nimbus.esc;
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('es-PE');
  const fmtMs = (ms) => { const n = Number(ms); return n < 1 ? n.toFixed(2) : n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('es-PE'); };
  const fmtSeg = (ms) => (Number(ms || 0) / 1000).toFixed(1);
  const INTERVALO_MS = 1000;

  // ---------- Mensajes ----------
  let mensajeTimer = null;
  function mensaje(texto) {
    const el = $('mensaje');
    el.textContent = texto;
    el.hidden = !texto;
    clearTimeout(mensajeTimer);
    if (texto) mensajeTimer = setTimeout(() => { el.hidden = true; }, 6000);
  }
  function siSesionVencio(e) {
    if (e.status === 401) { location.href = '/login'; return true; }
    return false;
  }
  const fallar = (e) => { if (!siSesionVencio(e)) mensaje(e.message); };

  // ---------- Métricas, comparación y aviso de API ----------
  function pintarMetricas(st) {
    $('mAciertos').textContent = fmt(st.aciertos);
    $('mFallos').textContent = fmt(st.fallos);
    $('mTasa').textContent = Number(st.tasa_aciertos || 0).toFixed(1);
    $('mExpulsiones').textContent = fmt(st.expulsiones);
    $('mExpirados').textContent = `+ ${fmt(st.expirados)} expirados por TTL`;
    $('mTamano').textContent = st.tamano;
    $('mCapacidad').textContent = st.capacidad;
    $('mOcupacion').style.width = (st.capacidad ? (st.tamano / st.capacidad) * 100 : 0) + '%';
    $('mEvitadas').textContent = fmt(st.llamadas_api_evitadas);
    $('mAhorro').textContent = `S/ ${Number(st.soles_ahorrados || 0).toFixed(2)} ahorrados (estimado, suponiendo S/ ${Number(st.costo_por_llamada || 0).toFixed(2)} por llamada; Open-Meteo es gratuita)`;
    $('subCap').textContent = st.capacidad;
    $('subTtl').textContent = Math.round(st.ttl);
    $('chipModo').classList.toggle('sin-conexion', !!st.sin_conexion);
    $('txtModo').textContent = st.sin_conexion ? `Sin conexión · API simulada (${st.latencia_ms} ms)` : 'Conectado a Open-Meteo';
    Recorrido.configurar(st);   // con "sin conexión" la tercera caja dice "Servicio simulado"

    const c = st.comparacion || {};
    $('cCache').textContent = c.promedio_cache_ms == null ? '—' : Number(c.promedio_cache_ms).toFixed(c.promedio_cache_ms < 1 ? 3 : 1);
    $('cApi').textContent = c.promedio_api_ms == null ? '—' : fmtMs(c.promedio_api_ms);
    $('cVeces').textContent = c.veces_mas_rapido == null ? '—' : fmt(c.veces_mas_rapido);
    $('cAhorro').textContent = fmtSeg(c.ahorrado_ms);

    const aviso = st.aviso_api;
    $('avisoApi').hidden = !aviso;
    if (aviso) $('avisoApi').textContent = `${aviso.mensaje} (desde las ${aviso.hora}, hora de Lima: ${aviso.detalle}). Para volver a Open-Meteo, apaga «Modo sin conexión».`;
    if (document.activeElement !== $('inSinConexion')) $('inSinConexion').checked = !!st.sin_conexion;
  }

  // ---------- Recorrido de la consulta (Usuario → Caché → API) ----------
  Recorrido.iniciar({
    escena: $('rcEscena'), bolita: $('rcBolita'), usuario: $('rcUsuario'), cache: $('rcCache'), api: $('rcApi'),
    nombreApi: $('rcNombreApi'), iconoApi: $('rcIconoApi'), etiquetaApi: $('rcEtiquetaApi'), texto: $('rcTexto'),
    cuenta1: $('rcCuenta1'), cuenta2: $('rcCuenta2'), num1: $('rcNum1'), num2: $('rcNum2'),
  });

  // ---------- Lista doblemente enlazada ----------
  VisorLista.iniciar({
    elementos: {
      escena: $('visorEscena'), lista: $('lista'), vacio: $('listaVacia'), indicador: $('visorIndicador'),
      narrador: $('narrador'), historial: $('historial'), tablaHash: $('tablaHash'), cuentaHash: $('hashCuenta'),
      panelAcelerado: $('panelAcelerado'), grafico: $('graficoVivo'), resumen: $('resumenAcelerado'),
      resumenTxt: $('resumenTxt'), btnRepetir: $('btnRepetir'),
    },
    alError: fallar,
  });

  // Modo paso a paso: UNA consulta simulada, animada lenta (~2 s)
  $('btnPaso').addEventListener('click', async () => {
    $('btnPaso').disabled = true;
    try { await VisorLista.paso(); refrescar(); }
    catch (e) { fallar(e); }
    finally { setTimeout(() => { $('btnPaso').disabled = simulando; }, 600); }
  });

  // ---------- Registro ----------
  function pintarRegistro(filas) {
    const cuerpo = $('registro');
    if (!filas.length) { cuerpo.innerHTML = '<tr><td colspan="6" class="tabla-vacia">Sin consultas todavía</td></tr>'; return; }
    cuerpo.innerHTML = filas.map((f) => {
      const cache = f.origen === 'cache';
      return `<tr>
        <td class="mono">${esc(f.hora)}</td>
        <td>${esc(f.lugar)}${f.pionera ? ' <span class="etiqueta-pionera" title="Primera consulta de este lugar: fue a la API y dejó el dato en el caché">pionera</span>' : ''}</td>
        <td class="quien">${f.tipo === 'publico' ? 'Público' : 'Simulación'}</td>
        <td class="mono">${esc(f.clave)}</td>
        <td><span class="origen ${cache ? 'origen-cache' : 'origen-api'}"><span class="punto"></span>${cache ? 'Caché' : 'API'}</span></td>
        <td class="num">${fmtMs(f.tiempo_ms)} ms</td>
      </tr>`;
    }).join('');
  }

  // ---------- Simulaciones ----------
  let simulando = false, pausada = false;
  const NOMBRE_SIM = { hora_punta: 'Hora punta', escaneo: 'Escaneo', camara_lenta: 'Cámara lenta' };

  function pintarSimulacion(s) {
    simulando = s.en_curso;
    pausada = !!s.pausada;
    VisorLista.estadoSimulacion(s);
    ['btnPaso', 'btnLenta', 'btnHoraPunta', 'btnEscaneo'].forEach((id) => { $(id).disabled = simulando; });
    $('btnDetener').hidden = !simulando;
    const lenta = simulando && s.tipo === 'camara_lenta';
    $('btnPausaLenta').hidden = !lenta;
    $('btnPausaLenta').textContent = pausada ? 'Reanudar' : 'Pausar';
    $('btnPausaLenta').setAttribute('aria-pressed', String(pausada));
    if (!s.tipo) return;
    $('barraSim').style.width = s.progreso + '%';
    const hechas = s.aciertos + s.fallos;
    const tasa = hechas ? ((s.aciertos / hechas) * 100).toFixed(1) : '0.0';
    const txt = `${NOMBRE_SIM[s.tipo] || s.tipo}: ${fmt(s.hechas)} de ${fmt(s.total)} consultas · ${fmt(s.aciertos)} aciertos · ${fmt(s.fallos)} fallos · ${tasa} % de aciertos · ${s.segundos} s`;
    $('txtSim').textContent = s.error ? 'La simulación falló: ' + s.error
      : simulando ? txt + (pausada ? ' · en pausa' : '') : txt + (s.detenida ? ' · detenida' : ' · terminada');
  }

  async function lanzar(tipo) {
    try { pintarSimulacion(await NimbusAPI.simular(tipo)); refrescar(); } catch (e) { fallar(e); }
  }
  $('btnLenta').addEventListener('click', () => lanzar('camara_lenta'));
  $('btnHoraPunta').addEventListener('click', () => lanzar('hora_punta'));
  $('btnEscaneo').addEventListener('click', () => lanzar('escaneo'));
  $('btnPausaLenta').addEventListener('click', async () => {
    try { pintarSimulacion(await (pausada ? NimbusAPI.reanudarSimulacion() : NimbusAPI.pausarSimulacion())); } catch (e) { fallar(e); }
  });
  $('btnDetener').addEventListener('click', async () => {
    try { pintarSimulacion(await NimbusAPI.detenerSimulacion()); } catch (e) { fallar(e); }
  });

  // ---------- Dinámica con el público ----------
  function pintarSala(d) {
    $('sConsultas').textContent = fmt(d.consultas);
    $('sAciertos').textContent = fmt(d.aciertos);
    $('sTasa').textContent = d.consultas ? `${Number(d.tasa_aciertos).toFixed(1)} % de las consultas` : '';
    $('sEvitadas').textContent = fmt(d.llamadas_api_evitadas);
    $('sAhorro').textContent = fmtSeg(d.ahorrado_ms);
    $('salaDesde').textContent = d.activa
      ? `Contando las consultas del público desde las ${d.inicio}, hora de Lima (las simulaciones no cuentan).`
      : 'Pulsa «Iniciar dinámica» para empezar a contar las consultas del público.';
    $('btnDinamica').textContent = d.activa ? 'Reiniciar dinámica' : 'Iniciar dinámica';
  }
  $('btnDinamica').addEventListener('click', async () => {
    try { pintarSala(await NimbusAPI.iniciarDinamica()); refrescar(); } catch (e) { fallar(e); }
  });
  $('btnPantalla').addEventListener('click', () => {
    const sala = $('sala');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (sala.requestFullscreen) sala.requestFullscreen().catch(() => mensaje('El navegador no permitió la pantalla completa.'));
  });
  document.addEventListener('fullscreenchange', () => {
    $('btnPantalla').setAttribute('aria-label', document.fullscreenElement ? 'Salir de pantalla completa' : 'Ver a pantalla completa');
  });

  // ---------- Polling ----------
  let pidiendo = false;
  async function refrescar() {
    if (pidiendo) return;
    pidiendo = true;
    try {
      const [st, filas, sim, sala] = await Promise.all([
        NimbusAPI.estadisticas(), NimbusAPI.registro(), NimbusAPI.estadoSimulacion(), NimbusAPI.resumenDinamica(),
      ]);
      pintarMetricas(st);
      pintarRegistro(filas);
      pintarSimulacion(sim);
      pintarSala(sala);
    } catch (e) {
      fallar(e);
    } finally { pidiendo = false; }
  }

  // ---------- Configuración ----------
  async function configurar(cambios) {
    try {
      ponerControles(await NimbusAPI.configurar(cambios));
      refrescar();
    } catch (e) {
      fallar(e);
      cargarConfiguracion(); // vuelve a mostrar los valores reales
    }
  }
  function ponerControles(cfg) {
    $('inCapacidad').value = cfg.capacidad;
    $('inTtl').value = Math.round(cfg.ttl);
    $('inSinConexion').checked = cfg.sin_conexion;
    $('inLatencia').value = cfg.latencia_ms;
  }
  async function cargarConfiguracion() {
    try { ponerControles(await NimbusAPI.configuracion()); } catch (e) { fallar(e); }
  }

  $('inCapacidad').addEventListener('change', (e) => configurar({ capacidad: Number(e.target.value) }));
  $('inTtl').addEventListener('change', (e) => configurar({ ttl: Number(e.target.value) }));
  $('inLatencia').addEventListener('change', (e) => configurar({ latencia_ms: Number(e.target.value) }));
  $('inSinConexion').addEventListener('change', (e) => configurar({ sin_conexion: e.target.checked }));
  // Vaciar: borra solo los datos guardados (las métricas siguen)
  $('btnVaciar').addEventListener('click', async () => {
    try { await NimbusAPI.vaciar(); refrescar(); } catch (e) { fallar(e); }
  });
  // Reiniciar métricas: contadores, promedios con/sin caché, tiempo ahorrado y registro en cero.
  // No toca los datos guardados ni la configuración.
  $('btnReiniciarMetricas').addEventListener('click', async () => {
    try { await NimbusAPI.reiniciarMetricas(); refrescar(); } catch (e) { fallar(e); }
  });

  // ---------- Pestañas ----------
  function elegirPestana(bench) {
    $('tabVivo').setAttribute('aria-selected', String(!bench));
    $('tabBench').setAttribute('aria-selected', String(bench));
    $('tabVivo').tabIndex = bench ? -1 : 0;
    $('tabBench').tabIndex = bench ? 0 : -1;
    $('vistaVivo').hidden = bench;
    $('vistaBench').hidden = !bench;
    if (bench) cargarBenchmark();
  }
  $('tabVivo').addEventListener('click', () => elegirPestana(false));
  $('tabBench').addEventListener('click', () => elegirPestana(true));
  document.querySelector('.pestanas').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const bench = $('tabVivo').getAttribute('aria-selected') === 'true';
    elegirPestana(bench);
    (bench ? $('tabBench') : $('tabVivo')).focus();
  });

  // ---------- Benchmark (gráficos SVG a partir del JSON) ----------
  function graficoBarras(svg, escenarios) {
    const X0 = 56, X1 = 628, Y0 = 220, ALTO = 190;
    const max = Math.max(...escenarios.map((e) => e.latencia_promedio_ms)) * 1.1 || 1;
    const Y = (v) => Y0 - (v / max) * ALTO;
    const ancho = (X1 - X0) / escenarios.length;
    let html = [0, 0.5, 1].map((f) => {
      const v = max * f;
      return `<line class="rejilla" x1="${X0}" x2="${X1}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${X0 - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${fmtMs(v)} ms</text>`;
    }).join('');
    escenarios.forEach((e, i) => {
      const x = X0 + i * ancho + ancho * 0.2, w = ancho * 0.6, y = Y(e.latencia_promedio_ms);
      html += `<rect class="${e.capacidad ? 'g-barra' : 'g-barra-sin'}" x="${x}" y="${y}" width="${w}" height="${Math.max(1, Y0 - y)}" rx="2"><title>${esc(e.nombre)}: ${fmtMs(e.latencia_promedio_ms)} ms promedio · ${e.tasa_aciertos.toFixed(1)} % aciertos</title></rect>`;
      html += `<text class="g-valor" x="${x + w / 2}" y="${y - 8}" text-anchor="middle">${fmtMs(e.latencia_promedio_ms)}</text>`;
      html += `<text x="${x + w / 2}" y="${Y0 + 20}" text-anchor="middle">${esc(e.nombre)}</text>`;
    });
    svg.innerHTML = html;
  }

  function graficoLinea(svg, escenarios) {
    const conCache = escenarios.filter((e) => e.capacidad);
    const X0 = 56, X1 = 610, Y0 = 220, ALTO = 190;
    const Y = (v) => Y0 - (v / 100) * ALTO;
    const X = (i) => (conCache.length < 2 ? X0 : X0 + ((X1 - X0) * i) / (conCache.length - 1));
    let html = [0, 50, 100].map((v) => `<line class="rejilla" x1="${X0}" x2="${X1}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${X0 - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${v} %</text>`).join('');
    html += `<polyline class="linea" points="${conCache.map((e, i) => X(i) + ',' + Y(e.tasa_aciertos)).join(' ')}"/>`;
    conCache.forEach((e, i) => {
      html += `<circle class="g-punto" cx="${X(i)}" cy="${Y(e.tasa_aciertos)}" r="4"><title>Capacidad ${e.capacidad}: ${e.tasa_aciertos.toFixed(1)} % de aciertos</title></circle>`;
      html += `<text class="g-valor" x="${X(i)}" y="${Y(e.tasa_aciertos) - 12}" text-anchor="middle">${e.tasa_aciertos.toFixed(1)} %</text>`;
      html += `<text x="${X(i)}" y="${Y0 + 20}" text-anchor="middle">${e.capacidad}</text>`;
    });
    html += `<text x="${(X0 + X1) / 2}" y="${Y0 + 38}" text-anchor="middle">capacidad del caché</text>`;
    svg.innerHTML = html;
  }

  /** obtener y guardar (µs) vs. tamaño del caché. Eje Y desde 0: si la línea es plana, es O(1). */
  function graficoComplejidad(svg, filas) {
    const X0 = 64, X1 = 860, Y0 = 228, ALTO = 196;
    const max = Math.max(...filas.map((f) => Math.max(f.obtener_us, f.guardar_us))) * 1.8 || 1;
    const Y = (v) => Y0 - (v / max) * ALTO;
    const X = (i) => (filas.length < 2 ? X0 : X0 + ((X1 - X0) * i) / (filas.length - 1)); // tamaños ×10: escala logarítmica
    let html = [0, 0.5, 1].map((f) => {
      const v = max * f;
      return `<line class="rejilla" x1="${X0}" x2="${X1}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${X0 - 8}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${v.toFixed(1)} µs</text>`;
    }).join('');
    const serie = (campo, clase) => {
      let s = `<polyline class="${clase}" points="${filas.map((f, i) => X(i) + ',' + Y(f[campo])).join(' ')}"/>`;
      filas.forEach((f, i) => { s += `<circle class="g-punto ${clase}-punto" cx="${X(i)}" cy="${Y(f[campo])}" r="4"><title>${campo === 'obtener_us' ? 'obtener' : 'guardar'} con ${fmt(f.tamano)} elementos: ${f[campo].toFixed(2)} µs</title></circle>`; });
      return s;
    };
    html += serie('guardar_us', 'linea linea-2') + serie('obtener_us', 'linea');
    filas.forEach((f, i) => { html += `<text x="${X(i)}" y="${Y0 + 20}" text-anchor="middle">${fmt(f.tamano)}</text>`; });
    const u = filas[filas.length - 1];
    html += `<text class="g-valor" x="${X1 + 6}" y="${Y(u.obtener_us) - 8}" text-anchor="end">obtener</text>`;
    html += `<text class="g-valor" x="${X1 + 6}" y="${Y(u.guardar_us) + 16}" text-anchor="end">guardar</text>`;
    html += `<text x="${(X0 + X1) / 2}" y="${Y0 + 40}" text-anchor="middle">elementos en el caché (cada paso es ×10)</text>`;
    svg.innerHTML = html;
  }

  /** Una frase corta de interpretación debajo de cada gráfico, con los números del benchmark. */
  function interpretar(datos) {
    const sin = datos.escenarios.find((e) => !e.capacidad);
    const con = datos.escenarios.filter((e) => e.capacidad);
    const mejor = con[con.length - 1], c10 = con.find((e) => e.capacidad === 10) || con[0];
    if (sin && mejor) {
      $('iLatencia').textContent = `Sin caché cada consulta espera a la API (${fmtMs(sin.latencia_promedio_ms)} ms). Con capacidad ${mejor.capacidad} el promedio baja a ${fmtMs(mejor.latencia_promedio_ms)} ms: ${(sin.latencia_promedio_ms / mejor.latencia_promedio_ms).toFixed(1)} veces más rápido.`;
    }
    if (con.length > 1) {
      $('iTasa').textContent = `Más capacidad, más aciertos: de ${con[0].tasa_aciertos.toFixed(1)} % (capacidad ${con[0].capacidad}) a ${mejor.tasa_aciertos.toFixed(1)} % (capacidad ${mejor.capacidad}). El caché en vivo usa ${c10.capacidad}: ${c10.tasa_aciertos.toFixed(1)} % en este tráfico.`;
    }
    const f = datos.complejidad || [];
    if (f.length > 1) {
      const a = f[0], b = f[f.length - 1];
      $('iComplejidad').textContent = `De ${fmt(a.tamano)} a ${fmt(b.tamano)} elementos (${fmt(b.tamano / a.tamano)} veces más datos) obtener pasa de ${a.obtener_us.toFixed(1)} a ${b.obtener_us.toFixed(1)} µs y guardar de ${a.guardar_us.toFixed(1)} a ${b.guardar_us.toFixed(1)} µs. La línea es plana: el tiempo no depende del tamaño, es O(1). Si fuera O(n) crecería ${fmt(b.tamano / a.tamano)} veces.`;
      $('nComplejidad').textContent = `${fmt(datos.operaciones_complejidad || 10000)} operaciones por tamaño`;
    }
  }

  async function cargarBenchmark() {
    let datos;
    try { datos = await NimbusAPI.benchmark(); }
    catch (e) {
      if (siSesionVencio(e)) return;
      $('benchContenido').hidden = true;
      $('benchVacio').hidden = false;
      $('benchVacio').textContent = e.message;
      return;
    }
    $('benchVacio').hidden = true;
    $('benchContenido').hidden = false;
    const c = datos.configuracion;
    $('benchConfig').textContent = `${fmt(c.consultas)} consultas · ${c.lugares} lugares · distribución Zipf (s = ${c.zipf_s}) · semilla ${c.semilla} · latencia simulada ${c.latencia_ms} ms · ${datos.fecha}`;
    graficoBarras($('gLatencia'), datos.escenarios);   // sin caché, 5, 10, 20 y 50
    graficoLinea($('gTasa'), datos.escenarios);
    if (datos.complejidad && datos.complejidad.length) graficoComplejidad($('gComplejidad'), datos.complejidad);
    interpretar(datos);
    $('benchTabla').innerHTML = datos.escenarios.map((e) => `<tr>
        <td>${esc(e.nombre)}</td>
        <td class="num">${e.tiempo_total_s.toFixed(2)} s</td>
        <td class="num">${fmtMs(e.latencia_promedio_ms)} ms</td>
        <td class="num">${e.tasa_aciertos.toFixed(1)} %</td>
        <td class="num">${fmt(e.llamadas_api)}</td>
      </tr>`).join('');
    $('benchPng').innerHTML = Object.entries(datos.graficos || {})
      .map(([nombre, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(nombre)}.png</a>`).join(' · ') || '—';
  }

  // ---------- Inicio ----------
  cargarConfiguracion();
  refrescar();
  setInterval(() => { if (!document.hidden && !$('vistaVivo').hidden) refrescar(); }, INTERVALO_MS);
})();
