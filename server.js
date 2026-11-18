import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { explicar, ErrorIA, ESTILOS, NIVELES, AJUSTES } from './src/gemini.js';
import { generarAudio, hayElevenLabs, VOCES, MAX_CHARS_VOZ } from './src/elevenlabs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

// Carga el .env de esta carpeta (no pisa variables que ya existan, así que las del sistema, p. ej. Render, mandan)
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* no existe: nada que cargar */ }

const MAX_TEXTO = 4000;
const MAX_PREVIA = 6000;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function responder(res, status, cuerpo, tipo = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
}

async function leerJson(req, max = 64 * 1024) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > max) throw Object.assign(new Error('Petición demasiado grande'), { status: 413 });
    trozos.push(t);
  }
  try { return JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON no válido'), { status: 400 }); }
}

// Límite por IP: Gemini y ElevenLabs cuestan dinero
const ventanas = new Map();
function superaLimite(clave, max, ms) {
  const ahora = Date.now();
  const recientes = (ventanas.get(clave) || []).filter(t => ahora - t < ms);
  recientes.push(ahora);
  ventanas.set(clave, recientes);
  if (ventanas.size > 5000) for (const [k, v] of ventanas) if (!v.some(t => ahora - t < ms)) ventanas.delete(k);
  return recientes.length > max;
}
function ipDe(req) {
  if (process.env.TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'desconocida';
}

// Código de acceso opcional: evita que cualquiera gaste tus créditos si lo publicas
function codigoValido(req) {
  const esperado = process.env.ACCESS_CODE;
  if (!esperado) return true;
  const dado = String(req.headers['x-access-code'] || '');
  const a = crypto.createHash('sha256').update(dado).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

const comoLista = (v) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string');

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(req, res, ruta) {
  if (req.method === 'GET' && ruta === '/api/config') {
    return responder(res, 200, {
      vozNatural: hayElevenLabs(),
      voces: Object.entries(VOCES).map(([clave, v]) => ({ clave, nombre: v.nombre })),
      requiereCodigo: !!process.env.ACCESS_CODE,
      maxTexto: MAX_TEXTO,
    });
  }

  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido' });
  if (!codigoValido(req)) return responder(res, 401, { success: false, codigo: 'CODIGO', error: 'Código de acceso incorrecto' });

  if (ruta === '/api/explicar') {
    if (superaLimite(`e:${ipDe(req)}`, 15, 60_000)) return responder(res, 429, { success: false, error: 'Demasiadas peticiones, espera un momento' });
    const b = await leerJson(req);
    const texto = String(b.texto ?? '').trim();
    if (texto.length < 2) return responder(res, 400, { success: false, error: 'Escribe un tema o pega un párrafo' });
    if (texto.length > MAX_TEXTO) return responder(res, 400, { success: false, error: `Máximo ${MAX_TEXTO} caracteres` });

    const estilos = comoLista(b.estilos).filter(e => Object.hasOwn(ESTILOS, e));
    const nivel = Object.hasOwn(NIVELES, b.nivel) ? b.nivel : 'basico';
    const ajuste = Object.hasOwn(AJUSTES, b.ajuste) ? b.ajuste : null;
    const idioma = b.idioma === 'en' ? 'en' : 'es';
    const previa = ajuste && typeof b.previa === 'string' ? b.previa.slice(0, MAX_PREVIA) : '';
    try {
      const explicacion = await explicar({ texto, estilos, nivel, idioma, ajuste, previa });
      return responder(res, 200, { success: true, explicacion });
    } catch (e) {
      if (!(e instanceof ErrorIA)) console.error('❌ /api/explicar:', e);
      return responder(res, e instanceof ErrorIA ? e.status : 500, { success: false, error: e instanceof ErrorIA ? e.message : 'Error inesperado' });
    }
  }

  if (ruta === '/api/voz') {
    if (!hayElevenLabs()) return responder(res, 503, { success: false, error: 'La voz natural no está configurada' });
    if (superaLimite(`v:${ipDe(req)}`, 20, 60_000)) return responder(res, 429, { success: false, error: 'Demasiadas peticiones, espera un momento' });
    const b = await leerJson(req);
    const texto = String(b.texto ?? '').trim();
    if (!texto) return responder(res, 400, { success: false, error: 'Falta el texto' });
    if (texto.length > MAX_CHARS_VOZ) return responder(res, 400, { success: false, error: `Máximo ${MAX_CHARS_VOZ} caracteres para la voz natural` });
    try {
      const audio = await generarAudio(texto, b.voz);
      return responder(res, 200, Buffer.from(audio), 'audio/mpeg');
    } catch (e) {
      return responder(res, e.status ?? 502, { success: false, error: e.message });
    }
  }

  return responder(res, 404, { error: 'No encontrado' });
}

// ---------------------------------------------------------------------------
// Archivos estáticos
// ---------------------------------------------------------------------------
async function estatico(req, res, ruta) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, 'Método no permitido', 'text/plain; charset=utf-8');
  let rel;
  try { rel = decodeURIComponent(ruta === '/' ? '/index.html' : ruta); } catch { return responder(res, 400, 'Ruta no válida', 'text/plain'); }
  const archivo = path.normalize(path.join(PUBLIC, rel));
  if (archivo !== PUBLIC && !archivo.startsWith(PUBLIC + path.sep)) return responder(res, 403, 'Prohibido', 'text/plain'); // anti path traversal
  try {
    const datos = await readFile(archivo);
    // no-cache = revalidar siempre: evita ver una versión vieja tras desplegar
    return responder(res, 200, req.method === 'HEAD' ? '' : datos, TIPOS[path.extname(archivo)] ?? 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch {
    return responder(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
  }
}

export function crearServidor() {
  return http.createServer(async (req, res) => {
    try {
      const ruta = new URL(req.url, 'http://localhost').pathname;
      if (ruta === '/healthz') return responder(res, 200, 'ok', 'text/plain');
      if (ruta.startsWith('/api/')) return await api(req, res, ruta);
      return await estatico(req, res, ruta);
    } catch (e) {
      if (!res.headersSent) responder(res, e.status ?? 500, { success: false, error: e.status ? e.message : 'Error interno' });
      if (!e.status) console.error('❌', e);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3100;
  crearServidor().listen(PORT, '0.0.0.0', () => {
    console.log(`🎓 AWS Tutor en http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY) console.warn('⚠️  Falta GEMINI_API_KEY: las explicaciones no funcionarán');
    console.log(hayElevenLabs() ? '🔊 Voz natural (ElevenLabs) activada' : '🔈 Sin ElevenLabs: se usan las voces del navegador');
  });
}
