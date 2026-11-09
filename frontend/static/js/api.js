/* =========================================================
   NimbusAPI — único punto de contacto con el backend Flask.
   Las páginas nunca hacen fetch directo: todo pasa por aquí.
   Si una ruta responde con error, se lanza un Error con el
   mensaje JSON del backend ({ "error": "..." }).
   ========================================================= */
window.NimbusAPI = (function () {
  const BASE = ''; // mismo origen que Flask

  const LIMITE_MS = 20000; // una petición colgada no debe trabar el sondeo del panel

  async function pedir(ruta, opciones) {
    let resp;
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), LIMITE_MS);
    try {
      resp = await fetch(BASE + ruta, Object.assign({ cache: 'no-store', credentials: 'same-origin', signal: corte.signal }, opciones));
    } catch (e) {
      throw new Error(corte.signal.aborted ? 'El servidor Nimbus tardó demasiado en responder.' : 'No se pudo conectar con el servidor Nimbus.');
    } finally {
      clearTimeout(reloj);
    }
    let json = null;
    try { json = await resp.json(); } catch (e) { /* respuesta sin JSON */ }
    if (!resp.ok) {
      const err = new Error((json && json.error) || 'El servidor respondió ' + resp.status + '.');
      err.status = resp.status;
      throw err;
    }
    return json;
  }

  const enviar = (ruta, cuerpo) => pedir(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo || {}),
  });

  return {
    /** GET /clima -> clima + "origen" ("cache" | "api") + "tiempo_ms" */
    clima: (nombre, lat, lon) =>
      pedir(`/clima?lat=${lat}&lon=${lon}&nombre=${encodeURIComponent(nombre || '')}`),
    /** GET /buscar -> [{ nombre, detalle, lat, lon }] */
    buscar: (texto) => pedir('/buscar?q=' + encodeURIComponent(texto)).then((r) => r.resultados || []),
    /** GET /estadisticas -> métricas + nodos de cabeza a cola */
    estadisticas: () => pedir('/estadisticas'),
    /** GET /calor -> temperatura actual de cada [lat, lon] (mapa de calor del Perú) */
    calor: (puntos) =>
      pedir('/calor?puntos=' + puntos.map(([la, lo]) => la.toFixed(3) + ',' + lo.toFixed(3)).join(';'))
        .then((r) => r.temperaturas || []),
    /** POST /vaciar */
    vaciar: () => enviar('/vaciar'),

    // ----- Administrador (requieren sesión) -----
    login: (usuario, clave) => enviar('/admin/login', { usuario, clave }),
    configuracion: () => pedir('/admin/configuracion'),
    configurar: (cambios) => enviar('/admin/configuracion', cambios),
    registro: () => pedir('/admin/registro').then((r) => r.consultas || []),
    /** tipo: "hora_punta" | "escaneo" | "camara_lenta". Siempre usan el servicio simulado. */
    simular: (tipo, velocidad) => enviar({
      escaneo: '/admin/simular/escaneo', camara_lenta: '/admin/simular/camara-lenta',
    }[tipo] || '/admin/simular/hora-punta', { velocidad: velocidad || 'rapida' }),
    detenerSimulacion: () => enviar('/admin/simulacion/detener'),
    pausarSimulacion: () => enviar('/admin/simulacion/pausar'),
    reanudarSimulacion: () => enviar('/admin/simulacion/reanudar'),
    /** Dinámica con el público: pone en cero el "Resumen de la sala" / lo consulta */
    iniciarDinamica: () => enviar('/admin/dinamica/iniciar'),
    resumenDinamica: () => pedir('/admin/dinamica/resumen'),
    estadoSimulacion: () => pedir('/admin/simulacion/estado'),
    /** GET /admin/eventos -> { eventos, ultima, perdidos, capacidad, ttl, estado } */
    eventos: (desde) => pedir('/admin/eventos' + (desde == null ? '' : '?desde=' + desde)),
    /** POST /admin/paso -> una consulta del tráfico simulado */
    paso: () => enviar('/admin/paso'),
    benchmark: () => pedir('/admin/benchmark'),
  };
})();
