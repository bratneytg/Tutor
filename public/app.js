import { renderMarkdown, textoParaVoz, trocear } from './md.js';

const $ = (id) => document.getElementById(id);
const LS = { hist: 'awstutor.hist', codigo: 'awstutor.codigo', voz: 'awstutor.voz', vel: 'awstutor.vel', pref: 'awstutor.pref' };
const MAX_HIST = 30;

const almacen = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado o lleno: la app sigue funcionando */ } },
};

let config = { vozNatural: false, voces: [], requiereCodigo: false, maxTexto: 4000 };
let actual = null;          // { id, ts, texto, nivel, estilos, idioma, explicacion }
let peticion = null;        // AbortController de la petición en curso
const soportaNavegador = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function mostrarError(msg) {
  const e = $('error');
  e.textContent = msg || '';
  e.hidden = !msg;
}
const idiomaActual = () => $('idioma').value;
const estilosMarcados = () => [...document.querySelectorAll('#estilos input:checked')].map(i => i.value);
const nivelMarcado = () => document.querySelector('#nivel input:checked')?.value ?? 'basico';

async function llamar(ruta, cuerpo, signal) {
  const r = await fetch(ruta, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-access-code': almacen.get(LS.codigo, '') },
    body: JSON.stringify(cuerpo),
  });
  if (r.status === 401) { $('codigoBox').hidden = false; throw new Error('Introduce el código de acceso'); }
  return r;
}

// ---------------------------------------------------------------------------
// Voz: dos motores con los mismos controles (play / pausa / stop / velocidad)
//   br:<voiceURI>  voces del navegador (gratis, sin servidor)
//   el:<clave>     voz natural de ElevenLabs (opcional, vía /api/voz)
// ---------------------------------------------------------------------------
let generacion = 0;         // invalida callbacks viejos cuando se pulsa stop o se pide otra cosa
let estadoVoz = 'idle';     // idle | cargando | sonando | pausa
let audio = null;
const cacheAudio = new Map();

function setEstado(estado, nota = '') {
  estadoVoz = estado;
  $('play').textContent = estado === 'sonando' ? '❚❚' : estado === 'cargando' ? '…' : '▶';
  $('play').setAttribute('aria-label', estado === 'sonando' ? 'Pausar' : estado === 'pausa' ? 'Continuar' : 'Escuchar');
  $('play').disabled = estado === 'cargando' || $('voz').disabled;
  $('stop').disabled = estado === 'idle' || estado === 'cargando';
  $('estadoVoz').textContent = nota || { cargando: 'Preparando la voz…', sonando: 'Leyendo…', pausa: 'En pausa' }[estado] || '';
}

function poblarVoces() {
  const idioma = idiomaActual();
  const sel = $('voz');
  sel.replaceChildren();

  if (config.vozNatural) {
    const g = document.createElement('optgroup');
    g.label = 'Voz natural (ElevenLabs)';
    for (const v of config.voces.filter(v => v.clave.startsWith(idioma))) g.append(new Option(v.nombre, `el:${v.clave}`));
    if (g.children.length) sel.append(g);
  }
  if (soportaNavegador) {
    const lista = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith(idioma));
    if (lista.length) {
      const g = document.createElement('optgroup');
      g.label = 'Voces del navegador (gratis)';
      for (const v of lista) g.append(new Option(`${v.name} (${v.lang})`, `br:${v.voiceURI}`));
      sel.append(g);
    }
  }
  if (!sel.options.length) {
    sel.append(new Option('No hay voces disponibles', ''));
    sel.disabled = true;
    $('play').disabled = true;
    return;
  }
  sel.disabled = false;
  const guardada = almacen.get(`${LS.voz}.${idioma}`, null);
  if ([...sel.options].some(o => o.value === guardada)) sel.value = guardada;
}

async function urlAudioNatural(texto, voz) {
  const clave = `${voz}|${texto}`;
  if (cacheAudio.has(clave)) return cacheAudio.get(clave);   // repetir no vuelve a gastar créditos
  const r = await llamar('/api/voz', { texto, voz });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo generar la voz');
  const url = URL.createObjectURL(await r.blob());
  cacheAudio.set(clave, url);
  if (cacheAudio.size > 4) { const [vieja] = cacheAudio.keys(); URL.revokeObjectURL(cacheAudio.get(vieja)); cacheAudio.delete(vieja); }
  return url;
}

function velocidad() { return Number($('velocidad').value) || 1; }

async function reproducir() {
  if (!actual?.explicacion) return;
  detener();
  const gen = ++generacion;
  const valor = $('voz').value;
  const [motor, id] = [valor.slice(0, 2), valor.slice(3)];
  const texto = textoParaVoz(actual.explicacion, actual.idioma);
  mostrarError('');

  if (motor === 'el') {
    setEstado('cargando');
    try {
      const url = await urlAudioNatural(texto, id);
      if (gen !== generacion) return;
      audio = new Audio(url);
      audio.playbackRate = velocidad();
      audio.onended = () => { if (gen === generacion) setEstado('idle'); };
      await audio.play();
      setEstado('sonando');
    } catch (e) {
      if (gen !== generacion) return;
      setEstado('idle');
      mostrarError(e.message);
    }
    return;
  }

  if (motor === 'br' && soportaNavegador) {
    const voz = speechSynthesis.getVoices().find(v => v.voiceURI === id);
    const trozos = trocear(texto);
    let i = 0;
    const siguiente = () => {
      if (gen !== generacion) return;
      if (i >= trozos.length) return setEstado('idle');
      const u = new SpeechSynthesisUtterance(trozos[i++]);
      u.lang = voz?.lang || (actual.idioma === 'en' ? 'en-US' : 'es-ES');
      if (voz) u.voice = voz;
      u.rate = velocidad();               // se lee en cada trozo: cambiar la velocidad aplica enseguida
      u.onend = siguiente;
      u.onerror = (ev) => { if (ev.error !== 'interrupted' && ev.error !== 'canceled') siguiente(); };
      speechSynthesis.speak(u);
    };
    setEstado('sonando');
    siguiente();
  }
}

function pausarOContinuar() {
  if (estadoVoz === 'sonando') {
    if (audio) audio.pause(); else speechSynthesis.pause();
    setEstado('pausa');
  } else if (estadoVoz === 'pausa') {
    if (audio) audio.play(); else speechSynthesis.resume();
    setEstado('sonando');
  } else {
    reproducir();
  }
}

function detener() {
  generacion++;
  if (audio) { audio.pause(); audio = null; }
  if (soportaNavegador) { speechSynthesis.cancel(); speechSynthesis.resume(); }
  setEstado('idle');
}

// ---------------------------------------------------------------------------
// Historial (solo en este navegador)
// ---------------------------------------------------------------------------
const leerHist = () => almacen.get(LS.hist, []);

function pintarHist() {
  const lista = leerHist();
  const ul = $('listaHist');
  ul.replaceChildren();
  $('vacioHist').hidden = lista.length > 0;
  $('borrarHist').hidden = lista.length === 0;
  for (const h of lista) {
    const li = document.createElement('li');
    const abrir = document.createElement('button');
    abrir.type = 'button'; abrir.className = 'abrir';
    const t = document.createElement('span'); t.textContent = h.texto;
    const f = document.createElement('small'); f.textContent = new Date(h.ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    abrir.append(t, f);
    abrir.addEventListener('click', () => abrirDelHist(h.id));
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.className = 'quitar'; quitar.textContent = '✕'; quitar.setAttribute('aria-label', 'Quitar del historial');
    quitar.addEventListener('click', () => { almacen.set(LS.hist, leerHist().filter(x => x.id !== h.id)); pintarHist(); });
    li.append(abrir, quitar);
    ul.append(li);
  }
}

function guardarEnHist(entrada) {
  const resto = leerHist().filter(h => h.id !== entrada.id);
  almacen.set(LS.hist, [entrada, ...resto].slice(0, MAX_HIST));
  pintarHist();
}

function abrirDelHist(id) {
  const h = leerHist().find(x => x.id === id);
  if (!h) return;
  detener();
  $('texto').value = h.texto;
  actualizarContador();
  document.querySelector(`#nivel input[value="${h.nivel}"]`)?.click();
  document.querySelectorAll('#estilos input').forEach(i => { i.checked = h.estilos.includes(i.value); });
  $('idioma').value = h.idioma;
  poblarVoces();
  mostrarResultado(h);
}

// ---------------------------------------------------------------------------
// Explicar
// ---------------------------------------------------------------------------
function mostrarResultado(entrada) {
  actual = entrada;
  $('resultado').innerHTML = renderMarkdown(entrada.explicacion); // renderMarkdown escapa todo el texto antes de añadir etiquetas
  $('salida').hidden = false;
  mostrarError('');
}

async function pedir(ajuste = null) {
  const base = ajuste && actual ? actual : {
    texto: $('texto').value.trim(), nivel: nivelMarcado(), estilos: estilosMarcados(), idioma: idiomaActual(),
  };
  if (base.texto.length < 2) { mostrarError('Escribe un tema o pega un párrafo'); $('texto').focus(); return; }
  if (!ajuste) almacen.set(LS.pref, { nivel: base.nivel, estilos: base.estilos, idioma: base.idioma, auto: $('auto').checked });

  peticion?.abort();
  peticion = new AbortController();
  const botones = [$('explicar'), ...document.querySelectorAll('[data-ajuste]')];
  const pulsado = ajuste ? document.querySelector(`[data-ajuste="${ajuste}"]`) : $('explicar');
  botones.forEach(b => { b.disabled = true; });
  pulsado.classList.add('cargando');
  mostrarError('');

  try {
    const r = await llamar('/api/explicar', {
      texto: base.texto, nivel: base.nivel, estilos: base.estilos, idioma: base.idioma,
      ajuste, previa: ajuste ? actual.explicacion : undefined,
    }, peticion.signal);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || !datos.success) throw new Error(datos.error || `Error ${r.status}`);

    detener();
    const entrada = {
      id: ajuste && actual ? actual.id : crypto.randomUUID(),
      ts: Date.now(), texto: base.texto, nivel: base.nivel, estilos: base.estilos, idioma: base.idioma,
      explicacion: datos.explicacion,
    };
    mostrarResultado(entrada);
    guardarEnHist(entrada);
    $('salida').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if ($('auto').checked) reproducir();
  } catch (e) {
    if (e.name !== 'AbortError') mostrarError(e.message || 'No se pudo explicar');
  } finally {
    botones.forEach(b => { b.disabled = false; });
    pulsado.classList.remove('cargando');
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
function actualizarContador() {
  $('contador').textContent = `${$('texto').value.length} / ${config.maxTexto}`;
}

function restaurarPreferencias() {
  const p = almacen.get(LS.pref, null);
  if (p) {
    document.querySelector(`#nivel input[value="${p.nivel}"]`)?.click();
    document.querySelectorAll('#estilos input').forEach(i => { i.checked = p.estilos?.includes(i.value) ?? i.checked; });
    if (p.idioma === 'en' || p.idioma === 'es') $('idioma').value = p.idioma;
    $('auto').checked = !!p.auto;
  }
  $('velocidad').value = almacen.get(LS.vel, 1);
  $('velTexto').textContent = `${Number($('velocidad').value).toFixed(1)}×`;
}

async function iniciar() {
  try { config = { ...config, ...(await (await fetch('/api/config')).json()) }; } catch { /* sin config: se usan los valores por defecto */ }
  $('codigoBox').hidden = !config.requiereCodigo || !!almacen.get(LS.codigo, '');
  $('texto').maxLength = config.maxTexto;
  restaurarPreferencias();
  actualizarContador();
  poblarVoces();
  setEstado('idle');
  pintarHist();
  if (soportaNavegador) speechSynthesis.addEventListener('voiceschanged', poblarVoces); // las voces llegan de forma asíncrona
  if ($('voz').disabled) $('estadoVoz').textContent = 'Tu navegador no tiene voces para este idioma.';
}

$('texto').addEventListener('input', actualizarContador);
$('texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pedir(); } });
$('explicar').addEventListener('click', () => pedir());
document.querySelectorAll('[data-ajuste]').forEach(b => b.addEventListener('click', () => pedir(b.dataset.ajuste)));
$('idioma').addEventListener('change', poblarVoces);
$('voz').addEventListener('change', () => { almacen.set(`${LS.voz}.${idiomaActual()}`, $('voz').value); if (estadoVoz !== 'idle') detener(); });
$('velocidad').addEventListener('input', () => {
  const v = velocidad();
  $('velTexto').textContent = `${v.toFixed(1)}×`;
  almacen.set(LS.vel, v);
  if (audio) audio.playbackRate = v;
});
$('play').addEventListener('click', pausarOContinuar);
$('stop').addEventListener('click', detener);
$('copiar').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(actual?.explicacion ?? ''); e.target.textContent = 'Copiado ✓'; }
  catch { e.target.textContent = 'No se pudo copiar'; }
  setTimeout(() => { e.target.textContent = 'Copiar'; }, 1800);
});
$('guardarCodigo').addEventListener('click', () => {
  const c = $('codigo').value.trim();
  if (!c) return;
  almacen.set(LS.codigo, c);
  $('codigoBox').hidden = true;
  mostrarError('');
});
$('borrarHist').addEventListener('click', () => { if (confirm('¿Borrar todo el historial de este navegador?')) { almacen.set(LS.hist, []); pintarHist(); } });
window.addEventListener('pagehide', detener);

iniciar();
