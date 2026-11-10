/* =========================================================
   Recorrido — animación del viaje de UNA consulta:

       [ Usuario ] ──── [ Caché LRU ] ──── [ Open-Meteo (API) ]

   QUIÉN LA DISPARA
   VisorLista (visor_lista.js) reproduce los eventos REALES del caché en
   orden. Antes de mover un nodo en la lista llama aquí, así primero se ve
   el viaje y después el cambio en la lista. El tipo de evento es lo que
   decide el camino (es el origen que devolvió el backend):

     acierto              -> Usuario → Caché (brilla en verde) → Usuario       ~1 s
     fallo ... insercion  -> Usuario → Caché (naranja, "no está") → API
                             (late mientras espera) → Caché (guarda la copia)
                             → Usuario                                         ~2 s
     expirado + fallo     -> igual que el fallo, pero el caché dice "vencido"

   Un fallo llega en DOS partes porque así pasa en el servidor: obtener()
   anota "fallo", se llama a la API (tarda), y guardar() anota "insercion"
   con el tiempo de la API. Mientras tanto la caja de la API late.

   HORA PUNTA / ESCANEO
   No se anima cada consulta: se muestran contadores encima de cada línea
   (respondidas por el caché / fueron a la API) que se actualizan en vivo.

   La tercera caja SIEMPRE es "Open-Meteo (API)": "Siguiente consulta",
   la cámara lenta y el público la consultan de verdad. Si Open-Meteo falla,
   el backend pasa solo al simulado y el panel lo avisa arriba (aviso de API).

   CANCELAR: reiniciar() sube un número de "generación". Cada viaje revisa
   ese número después de cada espera; si cambió, lanza CANCELADO y se corta
   (lo usa el botón "Vaciar todo" para limpiar la animación al instante).

   Las animaciones solo mueven la bolita (posición) y cambian opacidades.
   ========================================================= */
window.Recorrido = (function () {
  const ESPERA_MAX_MS = 15000; // sin respuesta de la API en este tiempo: se deja de esperar
  const CANCELADO = new Error('viaje cancelado');

  let el = {};
  let gen = 0;                 // sube en cada reiniciar(): los viajes viejos se cortan
  let bolitaEn = null;         // 'usuario' | 'cache' | 'api' | null (oculta)
  let claveEnCache = null;     // clave cuya consulta dejó la bolita en el caché ("vencido")
  const pendientes = new Map(); // clave -> { nombre, tipo, devuelta }: esperan a la API
  let relojEspera = null;
  let contando = false;
  const reducido = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('es-PE');
  const fmtMs = (n) => { const x = Number(n); return x < 0.01 ? x.toFixed(3) : x < 1 ? x.toFixed(2) : x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('es-PE'); };
  /** Espera `ms` y corta el viaje si mientras tanto alguien llamó a reiniciar(). */
  async function pausa(g, ms) {
    await esperar(ms);
    if (g !== gen) throw CANCELADO;
  }

  // ---------- Dibujo ----------
  function cajas() { return { usuario: el.usuario, cache: el.cache, api: el.api }; }

  /** Centro de una caja, en coordenadas de la escena. */
  function centro(nombre) {
    const e = el.escena.getBoundingClientRect(), r = cajas()[nombre].getBoundingClientRect();
    return { x: r.left - e.left + r.width / 2, y: r.top - e.top + r.height / 2 };
  }
  const tr = (p) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;

  /** Marca una caja: 'cache' (verde), 'api' (naranja), 'guardar', 'espera' (late) o null. */
  function marcar(nombre, tipo, texto) {
    const caja = cajas()[nombre];
    caja.classList.remove('marca-cache', 'marca-api', 'marca-guardar', 'esperando');
    if (tipo) caja.classList.add(tipo === 'espera' ? 'esperando' : 'marca-' + tipo);
    caja.querySelector('.rc-estado').textContent = texto || '';
  }

  function texto(clase, contenido) {
    el.texto.className = 'recorrido-texto origen ' + (clase || '');
    el.texto.lastChild.textContent = contenido;
  }

  /** La bolita viaja de una caja a otra. Pasa por DEBAJO de las cajas: solo se ve sobre las líneas. */
  async function tramo(g, de, a, ms, color) {
    const p0 = centro(de), p1 = centro(a);
    el.bolita.className = 'rc-bolita ' + color;
    el.bolita.hidden = false;
    el.bolita.style.transform = tr(p1);
    bolitaEn = null;
    if (!reducido.matches && ms > 0 && el.bolita.animate) {
      const anim = el.bolita.animate([{ transform: tr(p0) }, { transform: tr(p1) }],
        { duration: ms, easing: 'cubic-bezier(.45, 0, .25, 1)' });
      try { await anim.finished; } catch (e) { /* cancelada por reiniciar() */ }
    }
    if (g !== gen) throw CANCELADO;
    bolitaEn = a;
  }

  function ocultarBolita() {
    el.bolita.hidden = true;
    bolitaEn = null;
  }

  /** Antes de cada viaje animado: fuera los contadores de hora punta y las marcas viejas. */
  function empezar() {
    if (contando) { contando = false; el.cuenta1.hidden = true; el.cuenta2.hidden = true; }
    marcar('usuario', null);
    marcar('cache', null);
    if (!pendientes.size) marcar('api', null);
    claveEnCache = null;
  }

  function armarRelojEspera() {
    clearTimeout(relojEspera);
    relojEspera = setTimeout(() => {
      if (!pendientes.size) return;
      const nombres = [...pendientes.values()].map((p) => p.nombre).join(', ');
      pendientes.clear();
      marcar('api', null);
      ocultarBolita();
      texto('punto-error', `Sin respuesta del servicio externo para ${nombres}`);
    }, ESPERA_MAX_MS);
  }

  // ---------- Viajes (v escala los tiempos: 1 = velocidad normal) ----------
  /** ACIERTO: Usuario → Caché (verde) → Usuario. ~1 s con v = 1. */
  async function acierto(ev, v) {
    const t = (ms) => ms * v, g = gen;
    empezar();
    texto('', `Consulta · ${ev.nombre}: ¿está en el caché?`);
    await tramo(g, 'usuario', 'cache', t(300), 'b-pregunta');
    marcar('cache', 'cache', 'acierto');
    texto('origen-cache', `Acierto · ${ev.nombre} estaba en el caché → respondió en ${fmtMs(ev.tiempo_ms)} ms`);
    await pausa(g, t(260));
    await tramo(g, 'cache', 'usuario', t(300), 'b-cache');
    await pausa(g, t(140));
    marcar('cache', null);
    ocultarBolita();
  }

  /** VENCIDO (llega justo antes del fallo de la misma clave): Usuario → Caché, que dice "vencido". */
  async function vencido(ev, v) {
    const t = (ms) => ms * v, g = gen;
    empezar();
    texto('', `Consulta · ${ev.nombre}: ¿está en el caché?`);
    await tramo(g, 'usuario', 'cache', t(300), 'b-pregunta');
    marcar('cache', 'api', 'vencido');
    texto('origen-api', `Vencido · ${ev.nombre} estaba en el caché, pero su TTL ya venció`);
    await pausa(g, t(450));
    claveEnCache = ev.clave;
  }

  /** FALLO, primera parte: (Usuario →) Caché naranja "no está" → API, que late mientras espera. */
  async function fallo(ev, v) {
    const t = (ms) => ms * v, g = gen;
    const venia = bolitaEn === 'cache' && claveEnCache === ev.clave; // ya pasó por "vencido"
    const tipo = venia ? 'vencido' : 'fallo';
    if (!venia) {
      empezar();
      texto('', `Consulta · ${ev.nombre}: ¿está en el caché?`);
      await tramo(g, 'usuario', 'cache', t(300), 'b-pregunta');
    }
    claveEnCache = null;
    marcar('cache', 'api', venia ? 'vencido' : 'no está');
    texto('origen-api', venia
      ? `Vencido · ${ev.nombre} había vencido → se pide a Open-Meteo…`
      : `Fallo · ${ev.nombre} no estaba → se pide a Open-Meteo…`);
    await pausa(g, t(250));
    await tramo(g, 'cache', 'api', t(300), 'b-pregunta');
    marcar('cache', null);
    pendientes.set(ev.clave, { nombre: ev.nombre, tipo, devuelta: false });
    marcar('api', 'espera', 'esperando');
    armarRelojEspera();
    await pausa(g, t(350));
  }

  /** FALLO, segunda parte: la API responde → Caché (se guarda la copia). `ev` es la inserción. */
  async function respuesta(ev, v) {
    const p = pendientes.get(ev.clave);
    if (!p || p.devuelta) return;
    const t = (ms) => ms * v, g = gen;
    p.devuelta = true;
    const otras = [...pendientes.values()].some((o) => !o.devuelta);
    if (!otras) marcar('api', null);         // ya no queda nadie esperando
    const ms = ev.tiempo_api_ms != null ? ` (${fmtMs(ev.tiempo_api_ms)} ms)` : '';
    texto('origen-api', p.tipo === 'vencido'
      ? `Vencido · ${p.nombre} había vencido → se pidió a Open-Meteo${ms} y se guardó una copia nueva`
      : `Fallo · ${p.nombre} no estaba → se pidió a Open-Meteo${ms} y se guardó una copia`);
    await tramo(g, 'api', 'cache', t(300), 'b-api');
    marcar('cache', 'guardar', 'copia guardada');
    await pausa(g, t(220));
  }

  /** FALLO, final: Caché → Usuario con el dato que vino de la API. */
  async function entrega(ev, v) {
    const p = pendientes.get(ev.clave);
    if (!p) return;
    const t = (ms) => ms * v, g = gen;
    if (!p.devuelta) await respuesta(ev, v);
    pendientes.delete(ev.clave);
    if (!pendientes.size) clearTimeout(relojEspera);
    await tramo(g, 'cache', 'usuario', t(300), 'b-api');
    marcar('cache', null);
    await pausa(g, t(100));
    ocultarBolita();
  }

  // ---------- Hora punta / escaneo ----------
  /** Contadores encima de cada línea (sin animar cada consulta). */
  function contadores(nCache, nApi, titulo) {
    if (!contando) {
      reiniciar();
      contando = true;
      el.cuenta1.hidden = false;
      el.cuenta2.hidden = false;
    }
    el.num1.textContent = fmt(nCache);
    el.num2.textContent = fmt(nApi);
    texto('', `${titulo} · ${fmt(nCache + nApi)} consultas: ${fmt(nCache)} respondidas por el caché y ${fmt(nApi)} fueron a la API`);
  }

  // ---------- Control ----------
  /** Corta cualquier viaje en curso (resincronización, métricas reiniciadas…). */
  function reiniciar() {
    gen++;
    if (el.bolita && el.bolita.getAnimations) el.bolita.getAnimations().forEach((a) => a.cancel());
    pendientes.clear();
    clearTimeout(relojEspera);
    claveEnCache = null;
    if (!el.bolita) return;
    ocultarBolita();
    ['usuario', 'cache', 'api'].forEach((c) => marcar(c, null));
    if (contando) { contando = false; el.cuenta1.hidden = true; el.cuenta2.hidden = true; }
  }

  /** «Vaciar todo»: corta los viajes, borra los contadores y vuelve al texto inicial. */
  function limpiarTodo() {
    reiniciar();
    if (!el.texto) return;
    el.num1.textContent = '0';
    el.num2.textContent = '0';
    texto('', 'Pulsa «Siguiente consulta» para ver el viaje de una consulta.');
  }

  const esperandoA = (clave) => pendientes.has(clave);

  function iniciar(elementos) {
    el = elementos;
    // Si cambia el ancho, la bolita quieta vuelve al centro de su caja
    window.addEventListener('resize', () => { if (bolitaEn && !el.bolita.hidden) el.bolita.style.transform = tr(centro(bolitaEn)); });
  }

  return { CANCELADO, iniciar, acierto, vencido, fallo, respuesta, entrega, contadores, reiniciar, limpiarTodo, esperandoA };
})();
