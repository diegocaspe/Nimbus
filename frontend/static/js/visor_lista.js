/* =========================================================
   VisorLista — muestra lo que hace el caché, separando la velocidad
   REAL del caché de la velocidad de la ANIMACIÓN.

   DE DÓNDE SALEN LOS DATOS
   Cada 250 ms se pide GET /admin/eventos?desde=<última secuencia>. El
   backend devuelve los eventos nuevos (acierto, fallo, inserción,
   expulsión, expirado…) en el orden exacto en que pasaron, y el estado
   real de la lista. Los eventos entran a una COLA DE REPRODUCCIÓN y se
   aplican sobre una COPIA local de la lista (`modelo`): mismos eventos en
   el mismo orden = misma lista que el servidor.

   CUATRO MODOS (según quién generó el evento, campo "origen")
   - "simulacion-paso"  -> PASO A PASO: cada etapa se anima lenta (~2 s por consulta).
   - "simulacion-lenta" -> CÁMARA LENTA: la misma animación, ~800 ms por evento.
   - "publico"          -> CONSULTAS DEL PÚBLICO: de una en una; si hay más de
                           15 en cola se reproducen al doble de velocidad (×2).
   - "simulacion"       -> HORA PUNTA / ESCANEO (acelerado): NO se anima cada
                           evento. Se aplican al instante sobre la copia y la
                           fila se redibuja cada 300 ms, con un gráfico en vivo
                           de la tasa de aciertos y un brillo en los aciertos.

   RECORRIDO DE LA CONSULTA (recorrido.js)
   En los modos animados, antes de mover un nodo se anima el viaje de la
   consulta (Usuario → Caché → API) según el tipo de evento: primero el
   viaje, después el cambio en la lista. En hora punta / escaneo solo se
   actualizan sus contadores en cada tic de 300 ms.

   La posición de un nodo se calcula aquí, recorriendo la copia: el backend
   NO la calcula porque eso haría O(n) a obtener(). Por eso el narrador
   siempre dice "Nodos recorridos: 0": el caché nunca recorre la lista.
   ========================================================= */
window.VisorLista = (function () {
  const SONDEO_MS = 250;          // cada cuánto se piden eventos
  const TICK_ACELERADO_MS = 300;  // redibujo, gráfico y brillos en hora punta
  const QUIETO_MS = 700;          // sin eventos rápidos este tiempo = terminó lo acelerado
  const HISTORIAL = 6;            // líneas grises del narrador
  const MAX_HUECOS = 40;          // hasta esta capacidad se dibujan los espacios libres
  const NODO_MIN = 44;            // ancho mínimo de un nodo (px); con menos, la fila se desplaza
  const NODO_MAX = 190;
  const UMBRAL_PUBLICO = 15;      // más consultas del público en cola -> ×2
  const UMBRAL_SALTO = 400;       // más eventos lentos en cola -> se resincroniza
  const HISTORIA_MAX = 400;       // eventos acelerados guardados para "repetir las últimas 10"
  // Duración de cada etapa: el paso a paso es la referencia (1); el resto es una fracción
  const FACTOR = { paso: 1, lenta: 0.4, publico: 0.5 };
  const NOMBRE_MODO = { paso: 'Paso a paso', lenta: 'Cámara lenta', publico: 'Público', repeticion: 'Repetición' };
  // Velocidad del viaje en el diagrama del recorrido (1 = ~1 s un acierto, ~2 s un fallo).
  // La cámara lenta llega a 1 consulta por segundo: su viaje es algo más corto para no atrasarse.
  const VIAJE = { paso: 1, lenta: 0.6, publico: 1, repeticion: 0.6 };
  const SIN_RECORRIDO = { acierto() {}, vencido() {}, fallo() {}, respuesta() {}, entrega() {}, contadores() {}, reiniciar() {}, esperandoA: () => false };
  const R = window.Recorrido || SIN_RECORRIDO;

  let el = {};
  let alError = () => {};

  // ----- Copia local y reproducción -----
  let modelo = [];                // [{ clave, nombre, usos }], cabeza → cola
  const nodosDom = new Map();     // clave -> elemento .nodo
  const expiraEn = new Map();     // clave -> instante (Date.now) en que vence su TTL
  const cola = [];                // eventos pendientes (FIFO)
  let desde = null, ultimoEstado = [], capacidad = 10, ttlTotal = 600;
  let reproduciendo = false, repitiendo = false;
  const historial = [];
  let resaltada = null;
  let geo = { w: 160, a: 24, slots: 1 };

  // ----- Modo acelerado (hora punta / escaneo) -----
  let acel = null;                // datos de la corrida acelerada en curso
  let desfasado = false;
  let historia = [];              // [{ ev, antes }] para repetir en cámara lenta
  const brilloEn = new Map();     // clave -> último brillo (máximo 1 cada 300 ms por nodo)
  const porBrillar = new Set();
  let sim = { en_curso: false, tipo: null, pausada: false };

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtMs = (n) => (n == null ? '—' : Number(n) < 1 ? Number(n).toFixed(3) : Number(n) < 10 ? Number(n).toFixed(1) : Math.round(Number(n)).toLocaleString('es-PE'));
  const copia = (lista) => lista.map((n) => ({ clave: n.clave, nombre: n.nombre, usos: n.usos }));
  const NR = ' Nodos recorridos: 0.';

  function modoDe(ev) {
    if (ev.origen === 'simulacion') return 'rapido';
    if (ev.origen === 'simulacion-lenta') return 'lenta';
    if (ev.origen === 'simulacion-paso') return 'paso';
    return 'publico'; // público y acciones del administrador
  }

  // ==========================================================
  // 1. Sondeo: trae eventos del servidor y los encola
  // ==========================================================
  async function sondear() {
    try {
      if (!document.hidden) {
        const r = await NimbusAPI.eventos(desde);
        capacidad = r.capacidad;
        ttlTotal = r.ttl;
        ultimoEstado = r.estado;
        actualizarVencimientos(r.estado);
        if (desde === null) {
          resincronizar(null);                       // primera vez: copiar el estado tal cual
        } else if (r.perdidos) {
          resincronizar('se perdieron eventos', cola.length);
        } else {
          cola.push(...r.eventos);
          const lentos = cola.reduce((k, e) => k + (modoDe(e) === 'rapido' ? 0 : 1), 0);
          if (lentos > UMBRAL_SALTO) resincronizar('demasiadas consultas en cola', lentos);
        }
        desde = r.ultima;
        reproducir();
      }
    } catch (e) {
      alError(e);
    } finally {
      setTimeout(sondear, SONDEO_MS);
    }
  }

  // ==========================================================
  // 2. Reproducción
  // ==========================================================
  async function reproducir() {
    if (reproduciendo || repitiendo) return;
    reproduciendo = true;
    while (cola.length && !repitiendo) {
      // Eventos acelerados: se aplican todos los seguidos, al instante (el tic de 300 ms dibuja).
      // Si detrás de un evento lento ya esperan eventos acelerados, el lento también se aplica
      // al instante: la hora punta no puede quedar atrasada esperando animaciones.
      if (modoDe(cola[0]) === 'rapido' || cola.some((e) => modoDe(e) === 'rapido')) {
        while (cola.length && (modoDe(cola[0]) === 'rapido' || cola.some((e) => modoDe(e) === 'rapido'))) aplicarRapido(cola.shift());
        continue;
      }
      const ev = cola.shift();
      const modo = modoDe(ev);
      let f = FACTOR[modo];
      let doble = false;
      if (modo === 'publico') {
        const enCola = cola.reduce((k, e) => k + (modoDe(e) === 'publico' ? 1 : 0), 0);
        if (enCola > UMBRAL_PUBLICO) { f /= 2; doble = true; }
        pintarIndicador(`Público${doble ? ' · ×2' : ''}${enCola ? ` · ${enCola} en cola` : ''}`);
      } else {
        pintarIndicador(NOMBRE_MODO[modo] + (modo === 'lenta' && sim.pausada ? ' · en pausa' : ''));
      }
      try { await animar(ev, f, modo); } catch (e) { console.error(e); resincronizar('error al animar', cola.length); }
    }
    reproduciendo = false;
    if (!acel && !repitiendo) pintarIndicador(sim.pausada ? 'Cámara lenta · en pausa' : '');
  }

  /** Vacía la cola y copia el estado real de la lista (sin animar lo omitido). */
  function resincronizar(motivo, omitidos) {
    cola.length = 0;
    R.reiniciar();
    modelo = copia(ultimoEstado);
    nodosDom.forEach((nodo) => nodo.remove());
    nodosDom.clear();
    dibujar();
    if (motivo) narrar(`Resincronizado con el servidor (${motivo}) · ${omitidos} operaciones sin animar`, 'neutro');
  }

  // ==========================================================
  // 3. Animación de un evento (paso a paso, cámara lenta y público)
  //    `f` escala los tiempos: 1 = paso a paso (~2 s por consulta).
  // ==========================================================
  function duracion(ms) { el.escena.style.setProperty('--dur', Math.round(ms) + 'ms'); }

  async function animar(ev, f, modo) {
    const T = (ms) => esperar(ms * f);
    const i = modelo.findIndex((n) => n.clave === ev.clave); // posición en la copia (O(n) aquí, nunca en el caché)
    const quien = NOMBRE_MODO[modo] || '';
    // Velocidad del viaje: la del modo, a la mitad si el público va ×2
    const v = (VIAJE[modo] || VIAJE.repeticion) * (FACTOR[modo] ? f / FACTOR[modo] : 1);
    duracion(700 * f);

    switch (ev.tipo) {
      case 'acierto': {
        if (i < 0) return resincronizar('desfase', cola.length);
        await R.acierto(ev, v);          // primero el viaje: Usuario → Caché → Usuario
        const n = modelo[i];
        const nodo = nodosDom.get(n.clave);
        n.usos = ev.usos || n.usos + 1;
        // 1) el índice (dict) encuentra la clave  2) el nodo brilla  3) se desliza a la cabeza
        marcarIndice(n.clave, true);
        narrar(i === 0
          ? `${n.nombre} ya estaba y ya era la cabeza: el índice la encontró al instante (${fmtMs(ev.tiempo_ms)} ms).${NR}`
          : `${n.nombre} ya estaba: el índice la encontró al instante y pasa a la cabeza (${fmtMs(ev.tiempo_ms)} ms).${NR}`, 'cache', quien);
        await T(500);
        nodo.classList.add('acierto');
        await T(600);
        if (i > 0) {
          modelo.splice(i, 1);
          modelo.unshift(n);
          dibujar();
          parpadear([0, i - 1, i]);
        } else dibujar();
        await T(900);
        nodo.classList.remove('acierto');
        marcarIndice(null);
        return;
      }

      case 'actualizacion': {
        if (i < 0) return resincronizar('desfase', cola.length);
        if (R.esperandoA(ev.clave)) await R.entrega(ev, v); // otra consulta ya la había guardado
        const n = modelo[i];
        expiraEn.set(n.clave, Date.now() + (ev.ttl || ttlTotal) * 1000);
        narrar(`${n.nombre} ya estaba: se renuevan su valor y su TTL, y pasa a la cabeza.${NR}`, 'neutro', quien);
        if (i > 0) { modelo.splice(i, 1); modelo.unshift(n); }
        dibujar();
        await T(900);
        return;
      }

      case 'fallo':
        await R.fallo(ev, v);            // Usuario → Caché ("no está") → API, que queda esperando
        marcarAusente(ev.clave);
        narrar(`${ev.nombre} no estaba en el índice: hay que pedirla a la API.${NR}`, 'api', quien);
        await T(1000);
        return;

      case 'insercion': {
        if (i >= 0) return resincronizar('desfase', cola.length);
        if (R.esperandoA(ev.clave)) await R.entrega(ev, v); // API → Caché (copia) → Usuario
        modelo.unshift({ clave: ev.clave, nombre: ev.nombre, usos: 1 });
        if (!expiraEn.has(ev.clave)) expiraEn.set(ev.clave, Date.now() + (ev.ttl || ttlTotal) * 1000);
        marcarAusente(null);
        dibujar(ev.clave);               // entra por la cabeza con borde --color-api
        parpadear([0]);
        const api = ev.tiempo_api_ms != null ? ` en ${fmtMs(ev.tiempo_api_ms)} ms` : '';
        narrar(`${ev.nombre} llegó de la API${api} y entra por la cabeza.${NR}`, 'api', quien);
        const nuevo = nodosDom.get(ev.clave);
        await T(1400);
        if (nuevo) nuevo.classList.remove('nuevo', 'entra');
        return;
      }

      case 'expulsion': {
        if (i < 0) return resincronizar('desfase', cola.length);
        // Si la expulsión es para hacer sitio a un dato que volvía de la API, primero llega ese
        // dato al caché (guardar() anota expulsión e inserción juntas: la inserción ya está en cola)
        const entra = cola.find((e) => e.tipo === 'insercion');
        if (entra && R.esperandoA(entra.clave)) await R.respuesta(entra, v);
        const n = modelo[i];
        const nodo = nodosDom.get(n.clave);
        // 1) la cola se marca en rojo  2) se mantiene 1 s  3) sale
        nodo.classList.add('por-expulsar');
        nodo.querySelector('.nodo-tag').textContent = 'expulsado';
        narrar(`El caché está lleno: sale ${n.nombre}, que estaba en la cola (la usada hace más tiempo).${NR}`, 'error', quien);
        await T(1000);
        nodo.classList.add('expulsado');
        await T(600);
        quitarNodo(n.clave, i);
        await T(200);
        return;
      }

      case 'expirado':
      case 'eliminacion': {
        if (i < 0) return resincronizar('desfase', cola.length);
        if (ev.tipo === 'expirado') await R.vencido(ev, v); // el caché la tenía, pero venció
        const n = modelo[i];
        const nodo = nodosDom.get(n.clave);
        nodo.classList.add('apagado');
        narrar(ev.tipo === 'expirado'
          ? `${n.nombre} venció su TTL (${Math.round(ttlTotal)} s): se apaga y sale al leerla.${NR}`
          : `${n.nombre} se eliminó del caché.${NR}`, 'neutro', quien);
        await T(900);
        quitarNodo(n.clave, i);
        await T(200);
        return;
      }

      case 'vaciado':
        nodosDom.forEach((nodo) => nodo.classList.add('apagado'));
        narrar('Caché vaciado: el dict y la lista quedan vacíos.', 'neutro', quien);
        await T(800);
        modelo = [];
        nodosDom.forEach((nodo) => nodo.remove());
        nodosDom.clear();
        dibujar();
        return;

      default:
        return;
    }
  }

  function quitarNodo(clave, i) {
    const nodo = nodosDom.get(clave);
    modelo.splice(i, 1);
    nodosDom.delete(clave);
    if (nodo) nodo.remove();
    dibujar();
    if (i > 0 && i < modelo.length) parpadear([i - 1]); // el anterior ahora apunta al siguiente
  }

  // ==========================================================
  // 4. Modo acelerado (hora punta / escaneo)
  // ==========================================================
  function empezarAcelerado() {
    acel = { consultas: 0, aciertos: 0, msAciertos: 0, msApi: 0, nApi: 0, puntos: [], marcas: [], ultimo: performance.now(), tipo: sim.tipo };
    historia = [];
    el.resumen.hidden = true;
    el.panelAcelerado.hidden = false;
    pintarGrafico();
    R.contadores(0, 0, nombreAcelerado(acel.tipo));
    narrar(`${sim.tipo === 'escaneo' ? 'Escaneo' : 'Hora punta'} a velocidad real: no se anima cada consulta; la fila se redibuja cada 300 ms y cada acierto hace brillar su nodo.`, 'neutro');
  }

  /**
   * Aplica un evento a la copia, sin animarlo. Solo los de la simulación
   * acelerada ("simulacion") cuentan para el gráfico, el ×N y el resumen.
   */
  function aplicarRapido(ev) {
    const cuenta = modoDe(ev) === 'rapido';
    if (!acel) empezarAcelerado();
    const ahora = performance.now();
    acel.ultimo = ahora;
    if (cuenta) {
      historia.push({ ev, antes: copia(modelo) });
      if (historia.length > HISTORIA_MAX) historia.splice(0, historia.length - HISTORIA_MAX);
    }
    const i = modelo.findIndex((n) => n.clave === ev.clave);
    switch (ev.tipo) {
      case 'acierto':
        if (cuenta) {
          acel.consultas++; acel.aciertos++; acel.marcas.push(ahora);
          acel.msAciertos += Number(ev.tiempo_ms) || 0;
        }
        if (i < 0) { desfasado = true; break; }
        modelo[i].usos = ev.usos || modelo[i].usos + 1;
        modelo.unshift(modelo.splice(i, 1)[0]);
        porBrillar.add(ev.clave);
        break;
      case 'actualizacion':
        if (i > 0) modelo.unshift(modelo.splice(i, 1)[0]);
        break;
      case 'fallo':
        if (cuenta) { acel.consultas++; acel.marcas.push(ahora); }
        break;
      case 'insercion':
        if (cuenta && ev.tiempo_api_ms != null) { acel.msApi += Number(ev.tiempo_api_ms); acel.nApi++; }
        if (i >= 0) { desfasado = true; break; }
        modelo.unshift({ clave: ev.clave, nombre: ev.nombre, usos: 1 });
        expiraEn.set(ev.clave, Date.now() + (ev.ttl || ttlTotal) * 1000);
        break;
      case 'expulsion': case 'expirado': case 'eliminacion':
        if (i < 0) { desfasado = true; break; }
        modelo.splice(i, 1);
        break;
      case 'vaciado':
        modelo = [];
        break;
      default:
        break;
    }
  }

  function tickAcelerado() {
    if (!acel || repitiendo) return;
    const ahora = performance.now();
    if (desfasado) {
      // La copia no coincide con el servidor: se toma el estado real y se descarta la
      // cola (ese estado ya incluye esos eventos; aplicarlos otra vez los duplicaría)
      desfasado = false;
      cola.length = 0;
      modelo = copia(ultimoEstado);
      historia = [];
    }
    duracion(250); // transiciones suaves de posición entre redibujos
    dibujar();
    // Brillo breve en los nodos que tuvieron un acierto (máximo 1 cada 300 ms por nodo)
    porBrillar.forEach((clave) => {
      if (ahora - (brilloEn.get(clave) || 0) < TICK_ACELERADO_MS) return;
      const nodo = nodosDom.get(clave);
      if (!nodo) return;
      nodo.classList.remove('brilla');
      void nodo.offsetWidth;          // reinicia la animación
      nodo.classList.add('brilla');
      brilloEn.set(clave, ahora);
    });
    porBrillar.clear();
    // Tasa de aciertos acumulada de esta corrida
    if (acel.consultas) acel.puntos.push((acel.aciertos / acel.consultas) * 100);
    pintarGrafico();
    R.contadores(acel.aciertos, acel.consultas - acel.aciertos, nombreAcelerado(acel.tipo));
    // ×N = consultas por segundo frente a la cámara lenta (1 por segundo)
    acel.marcas = acel.marcas.filter((t) => ahora - t < 1000);
    if (acel.marcas.length) acel.ritmo = acel.marcas.length;
    pintarIndicador(`Acelerado ×${acel.ritmo || 1}`, true);
    const quedanRapidos = cola.some((e) => modoDe(e) === 'rapido');
    if (!sim.en_curso && !quedanRapidos && ahora - acel.ultimo > QUIETO_MS) terminarAcelerado();
  }

  const nombreAcelerado = (tipo) => (tipo === 'escaneo' ? 'Escaneo' : 'Hora punta');

  function terminarAcelerado() {
    const a = acel;
    acel = null;
    R.contadores(a.aciertos, a.consultas - a.aciertos, nombreAcelerado(a.tipo));
    duracion(300);
    dibujar();
    const promApi = a.nApi ? a.msApi / a.nApi : 0;
    const ahorrado = Math.max(0, a.aciertos * promApi - a.msAciertos) / 1000;
    const tasa = a.consultas ? (a.aciertos / a.consultas) * 100 : 0;
    const nombre = nombreAcelerado(a.tipo);
    el.resumenTxt.textContent = `${nombre}: ${a.consultas.toLocaleString('es-PE')} consultas · ${tasa.toFixed(0)} % aciertos · ${ahorrado.toFixed(1)} s ahorrados`;
    el.resumen.hidden = false;
    el.btnRepetir.disabled = !historia.some((h) => h.ev.tipo === 'acierto' || h.ev.tipo === 'fallo');
    narrar(el.resumenTxt.textContent, 'cache');
    pintarIndicador('');
  }

  function pintarGrafico() {
    const svg = el.grafico;
    const puntos = acel ? acel.puntos : (svg.__puntos || []);
    if (acel) svg.__puntos = puntos;
    const X0 = 40, X1 = 590, Y0 = 108, ALTO = 92;
    const Y = (v) => Y0 - (v / 100) * ALTO;
    const n = Math.max(puntos.length, 2);
    const X = (k) => X0 + ((X1 - X0) * k) / (n - 1);
    let html = [0, 50, 100].map((v) => `<line class="rejilla" x1="${X0}" x2="${X1}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${X0 - 6}" y="${Y(v)}" text-anchor="end" dominant-baseline="middle">${v} %</text>`).join('');
    if (puntos.length) {
      html += `<polyline class="linea" points="${puntos.map((v, k) => X(k).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`;
      const u = puntos[puntos.length - 1], k = puntos.length - 1;
      html += `<circle class="g-punto" cx="${X(k).toFixed(1)}" cy="${Y(u).toFixed(1)}" r="3.5"/>`;
      html += `<text class="g-valor" x="${Math.min(X(k), X1 - 4).toFixed(1)}" y="${(Y(u) - 10).toFixed(1)}" text-anchor="end">${u.toFixed(1)} %</text>`;
    }
    svg.innerHTML = html;
  }

  /** Repite en cámara lenta las últimas k consultas de la corrida acelerada. */
  async function repetirUltimas(k) {
    if (repitiendo || acel || !historia.length) return;
    // Busca, desde el final, el evento con el que empezó la k-ésima consulta (acierto o fallo)
    let cuenta = 0, inicio = -1;
    for (let j = historia.length - 1; j >= 0; j--) {
      const t = historia[j].ev.tipo;
      if (t === 'acierto' || t === 'fallo') { cuenta++; inicio = j; if (cuenta === k) break; }
    }
    if (inicio < 0) return;
    const previo = historia[inicio - 1];
    if (previo && previo.ev.tipo === 'expirado' && previo.ev.clave === historia[inicio].ev.clave) inicio--; // el vencimiento es parte de esa consulta
    const tramo = historia.slice(inicio);
    while (reproduciendo) await esperar(100);
    repitiendo = true;
    el.btnRepetir.disabled = true;
    const final = copia(modelo);
    modelo = copia(tramo[0].antes);
    nodosDom.forEach((nodo) => nodo.remove());
    nodosDom.clear();
    duracion(300);
    dibujar();
    narrar(`Repetición en cámara lenta de las últimas ${cuenta} consultas`, 'neutro');
    pintarIndicador('Repetición · cámara lenta');
    await esperar(800);
    for (const h of tramo) {
      try { await animar(h.ev, FACTOR.lenta, 'repeticion'); } catch (e) { console.error(e); break; }
    }
    // La repetición termina exactamente en el estado actual; si algo no cuadra, se corrige
    if (modelo.map((n) => n.clave).join('|') !== final.map((n) => n.clave).join('|')) {
      modelo = final;
      nodosDom.forEach((nodo) => nodo.remove());
      nodosDom.clear();
      dibujar();
    }
    repitiendo = false;
    el.btnRepetir.disabled = false;
    pintarIndicador('');
    reproducir();
  }

  // ==========================================================
  // 5. Dibujo: SIEMPRE una sola fila (cabeza a la izquierda, cola a la derecha)
  //    Cada nodo se ubica con `left`; al cambiar de posición se desliza
  //    con una transición (solo posición). Si no caben, los nodos se achican.
  // ==========================================================
  function medir() {
    const W = el.escena.clientWidth || 800;
    const slots = capacidad <= MAX_HUECOS ? Math.max(capacidad, modelo.length, 1) : Math.max(modelo.length, 1);
    const a = Math.max(12, Math.min(28, W * 0.025));
    const w = Math.max(NODO_MIN, Math.min(NODO_MAX, (W - (slots - 1) * a) / slots));
    geo = { w, a, slots };
    el.lista.style.width = (slots * w + (slots - 1) * a) + 'px';
    el.lista.classList.toggle('compacta', w < 118);
    el.lista.classList.toggle('mini', w < 76);
  }
  const xDe = (i) => i * (geo.w + geo.a);

  /** nuevaEnCabeza: clave recién insertada (entra desde arriba con borde --color-api). */
  function dibujar(nuevaEnCabeza) {
    medir();
    const { w, a } = geo;
    // Quita los nodos que ya no están en la copia (en hora punta salen sin animación)
    const vivas = new Set(modelo.map((n) => n.clave));
    nodosDom.forEach((nodo, clave) => { if (!vivas.has(clave)) { nodo.remove(); nodosDom.delete(clave); } });
    // Decoración (espacios libres y flechas): se rehace entera, es barata
    el.lista.querySelectorAll('.decor').forEach((d) => d.remove());
    const frag = document.createDocumentFragment();
    if (capacidad <= MAX_HUECOS) {
      for (let i = modelo.length; i < geo.slots; i++) frag.appendChild(decor('hueco', xDe(i), w, 'libre'));
    }
    for (let i = 0; i < modelo.length - 1; i++) {
      const f = decor('flecha', xDe(i) + w, a, FLECHA);
      f.dataset.enlace = i;
      frag.appendChild(f);
    }
    el.lista.appendChild(frag);

    modelo.forEach((n, i) => {
      let nodo = nodosDom.get(n.clave);
      if (!nodo) {
        nodo = crearNodo(n);
        if (n.clave === nuevaEnCabeza) nodo.classList.add('entra', 'nuevo');
        nodo.style.left = xDe(i) + 'px';
        nodosDom.set(n.clave, nodo);
        el.lista.appendChild(nodo);
      }
      nodo.style.left = xDe(i) + 'px';
      nodo.style.width = w + 'px';
      const u = n.usos || 1;
      const usos = nodo.querySelector('.nodo-usos');
      // "consultado N veces"; si el nodo es angosto, "N veces"; si es diminuto, "×N"
      usos.textContent = w >= 118 ? `consultado ${u} ${u === 1 ? 'vez' : 'veces'}` : w >= 56 ? `${u} ${u === 1 ? 'vez' : 'veces'}` : '×' + u;
      usos.title = `consultado ${u} ${u === 1 ? 'vez' : 'veces'}`;
      const cabeza = i === 0, colaN = i === modelo.length - 1;
      const saliendo = nodo.classList.contains('por-expulsar');
      nodo.classList.toggle('es-cola', colaN && !saliendo);
      if (!saliendo) nodo.querySelector('.nodo-tag').textContent = cabeza && colaN ? 'cabeza · cola' : cabeza ? 'cabeza' : colaN ? 'cola' : '';
    });
    el.vacio.hidden = modelo.length > 0;
    pintarTabla();
    marcarTtl();
    if (resaltada) resaltar(resaltada);
  }

  const FLECHA = '<svg viewBox="0 0 24 20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18M18 4l3 3-3 3"/><path d="M21 13H3M6 10l-3 3 3 3"/></svg>';

  function decor(clase, x, ancho, contenido) {
    const d = document.createElement('div');
    d.className = 'decor ' + clase;
    d.style.left = x + 'px';
    d.style.width = ancho + 'px';
    if (contenido.startsWith('<svg')) d.innerHTML = contenido; else d.textContent = contenido;
    return d;
  }

  function crearNodo(n) {
    const nodo = document.createElement('div');
    nodo.className = 'nodo';
    nodo.dataset.clave = n.clave;
    nodo.innerHTML = `
      <span class="nodo-tag"></span>
      <span class="nodo-nombre"></span>
      <span class="nodo-usos"></span>
      <span class="nodo-clave"></span>
      <div class="ttl"><i></i></div>
      <span class="nodo-ttl-txt"></span>`;
    nodo.querySelector('.nodo-nombre').textContent = n.nombre;
    nodo.querySelector('.nodo-nombre').title = n.nombre;
    nodo.querySelector('.nodo-clave').textContent = n.clave;
    return nodo;
  }

  function parpadear(enlaces) {
    enlaces.forEach((i) => {
      const f = el.lista.querySelector(`.flecha[data-enlace="${i}"]`);
      if (f) { f.classList.remove('parpadeo'); void f.offsetWidth; f.classList.add('parpadeo'); }
    });
  }

  // ==========================================================
  // 6. TTL en tiempo real
  // ==========================================================
  function actualizarVencimientos(estado) {
    const ahora = Date.now();
    estado.forEach((n) => expiraEn.set(n.clave, ahora + n.ttl_restante * 1000));
    const vivas = new Set(estado.map((n) => n.clave).concat(modelo.map((n) => n.clave)));
    for (const clave of expiraEn.keys()) if (!vivas.has(clave)) expiraEn.delete(clave);
  }

  function marcarTtl() {
    const ahora = Date.now();
    modelo.forEach((n) => {
      const nodo = nodosDom.get(n.clave);
      if (!nodo) return;
      const restante = Math.max(0, ((expiraEn.get(n.clave) || ahora) - ahora) / 1000);
      const pct = Math.min(100, (restante / ttlTotal) * 100);
      nodo.querySelector('.ttl i').style.width = pct + '%';
      nodo.querySelector('.ttl').classList.toggle('bajo', pct < 25);
      nodo.classList.toggle('vencido', restante <= 0);
      nodo.querySelector('.nodo-ttl-txt').textContent = restante <= 0 ? 'vencido' : `TTL ${Math.ceil(restante)} s`;
    });
  }

  // ==========================================================
  // 7. Tabla hash (el índice) y resaltado
  // ==========================================================
  let ausente = null; // clave buscada que no está (fila temporal "no está")

  function pintarTabla() {
    const filas = modelo.slice().sort((a, b) => a.clave.localeCompare(b.clave));
    el.cuentaHash.textContent = `${modelo.length} de ${capacidad}`;
    el.tablaHash.innerHTML = '';
    const frag = document.createDocumentFragment();
    if (ausente && !modelo.some((n) => n.clave === ausente)) {
      const li = document.createElement('li');
      li.className = 'hash-ausente';
      li.innerHTML = '<code></code><span class="hash-flecha" aria-hidden="true">→</span><span class="hash-nombre">no está</span>';
      li.querySelector('code').textContent = `"${ausente}"`;
      frag.appendChild(li);
    }
    if (!filas.length && !frag.childNodes.length) {
      el.tablaHash.innerHTML = '<li class="hash-vacio">dict vacío: {}</li>';
      return;
    }
    filas.forEach((n) => {
      const li = document.createElement('li');
      li.dataset.clave = n.clave;
      li.innerHTML = '<code></code><span class="hash-flecha" aria-hidden="true">→</span><span class="hash-nombre"></span>';
      li.querySelector('code').textContent = `"${n.clave}"`;
      li.querySelector('.hash-nombre').textContent = 'Nodo ' + n.nombre;
      frag.appendChild(li);
    });
    el.tablaHash.appendChild(frag);
  }

  /** Resalta la fila del índice que se está consultando (el "chip" del acierto). */
  function marcarIndice(clave) {
    el.tablaHash.querySelectorAll('li.consultando').forEach((x) => x.classList.remove('consultando'));
    if (!clave) return;
    const fila = el.tablaHash.querySelector(`li[data-clave="${CSS.escape(clave)}"]`);
    if (fila) { fila.classList.add('consultando'); fila.scrollIntoView({ block: 'nearest' }); }
  }
  function marcarAusente(clave) {
    ausente = clave;
    pintarTabla();
  }

  function resaltar(clave) {
    el.lista.querySelectorAll('.nodo.resaltado').forEach((x) => x.classList.remove('resaltado'));
    el.tablaHash.querySelectorAll('li.resaltado').forEach((x) => x.classList.remove('resaltado'));
    resaltada = clave;
    if (!clave) return;
    const nodo = nodosDom.get(clave);
    if (nodo) nodo.classList.add('resaltado');
    const fila = el.tablaHash.querySelector(`li[data-clave="${CSS.escape(clave)}"]`);
    if (fila) fila.classList.add('resaltado');
  }

  // ==========================================================
  // 8. Narrador e indicador
  // ==========================================================
  const PUNTO = { cache: 'origen-cache', api: 'origen-api', error: 'punto-error', neutro: '' };

  function narrar(texto, tipo, quien) {
    const actual = el.narrador.dataset.texto;
    if (actual) {
      historial.unshift(actual);
      historial.length = Math.min(historial.length, HISTORIAL);
      el.historial.innerHTML = '';
      historial.forEach((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        el.historial.appendChild(li);
      });
    }
    const completo = quien ? `${quien} · ${texto}` : texto;
    el.narrador.dataset.texto = completo;
    el.narrador.className = 'narrador-actual origen ' + (PUNTO[tipo] || '');
    el.narrador.innerHTML = '<span class="punto"></span><span></span>';
    el.narrador.lastChild.textContent = completo;
  }

  function pintarIndicador(texto, acelerado) {
    el.indicador.textContent = texto || '';
    el.indicador.hidden = !texto;
    el.indicador.classList.toggle('acelerado', !!acelerado);
  }

  // ==========================================================
  // API pública
  // ==========================================================
  function iniciar(opciones) {
    el = opciones.elementos;
    alError = opciones.alError || alError;
    el.tablaHash.addEventListener('mouseover', (e) => { const li = e.target.closest('li[data-clave]'); if (li) resaltar(li.dataset.clave); });
    el.tablaHash.addEventListener('mouseleave', () => resaltar(null));
    el.lista.addEventListener('mouseover', (e) => { const n = e.target.closest('.nodo'); if (n) resaltar(n.dataset.clave); });
    el.lista.addEventListener('mouseleave', () => resaltar(null));
    el.lista.addEventListener('animationend', (e) => {
      if (e.target.classList.contains('flecha')) e.target.classList.remove('parpadeo');
      if (e.target.classList.contains('nodo')) e.target.classList.remove('brilla');
    });
    el.btnRepetir.addEventListener('click', () => repetirUltimas(10));
    new ResizeObserver(() => { if (!reproduciendo && !repitiendo) { duracion(0); dibujar(); } }).observe(el.escena);
    setInterval(marcarTtl, 250);
    setInterval(tickAcelerado, TICK_ACELERADO_MS);
    pintarGrafico();
    sondear();
  }

  /** El panel avisa el estado de la simulación (para saber cuándo terminó lo acelerado y si hay pausa). */
  function estadoSimulacion(s) {
    sim = { en_curso: !!s.en_curso, tipo: s.tipo, pausada: !!s.pausada };
    if (!acel && !reproduciendo && !repitiendo) pintarIndicador(sim.pausada ? 'Cámara lenta · en pausa' : '');
  }

  /** "Siguiente consulta": POST /admin/paso (una consulta simulada, se anima lenta). */
  function paso() { return NimbusAPI.paso(); }

  return { iniciar, estadoSimulacion, paso, repetirUltimas };
})();
