import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Gemini falso: guarda lo que recibe y devuelve una respuesta fija
let ultimaPeticion = null;
let modoGemini = 'ok';
const gemini = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    ultimaPeticion = { url: req.url, clave: req.headers['x-goog-api-key'], cuerpo: JSON.parse(cuerpo) };
    if (modoGemini === 'limite') { res.writeHead(429); return res.end('quota'); }
    if (modoGemini === 'vacio') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"candidates":[]}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '## Qué es S3\n\nEs un **almacén** de archivos.' }] } }] }));
  });
});

let app, base;
before(async () => {
  await new Promise(r => gemini.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${gemini.address().port}`;
  process.env.GEMINI_API_KEY = 'clave-de-prueba';
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ACCESS_CODE;
  const { crearServidor } = await import('../server.js');
  app = crearServidor();
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(() => { app.close(); gemini.close(); });

const post = (ruta, cuerpo, headers = {}) =>
  fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) });

test('sirve la página y los archivos estáticos', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /AWS Tutor/);
  for (const f of ['/app.js', '/md.js', '/style.css']) assert.equal((await fetch(base + f)).status, 200, f);
});

test('bloquea path traversal', async () => {
  const r = await fetch(base + '/..%2fserver.js');
  assert.ok([403, 404].includes(r.status));
  assert.ok(!(await r.text()).includes('crearServidor'));
});

test('/api/config indica que no hay voz natural sin clave', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.vozNatural, false);
  assert.equal(c.requiereCodigo, false);
});

test('/api/explicar devuelve la explicación y manda estilos y texto a Gemini', async () => {
  const r = await post('/api/explicar', { texto: '¿Qué es S3?', nivel: 'nino', estilos: ['ejemplos', 'analogia', 'inventado'], idioma: 'es' });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.success, true);
  assert.match(d.explicacion, /almacén/);
  assert.equal(ultimaPeticion.clave, 'clave-de-prueba');
  assert.match(ultimaPeticion.url, /:generateContent$/);
  const usuario = ultimaPeticion.cuerpo.contents[0].parts[0].text;
  assert.match(usuario, /<texto>\n¿Qué es S3\?\n<\/texto>/);
  assert.match(usuario, /analogy/);
  assert.ok(!usuario.includes('inventado'));
  assert.match(ultimaPeticion.cuerpo.systemInstruction.parts[0].text, /Reply in Spanish/);
  assert.match(ultimaPeticion.cuerpo.systemInstruction.parts[0].text, /12-year-old/);
});

test('un ajuste envía la explicación previa', async () => {
  await post('/api/explicar', { texto: 'VPC', ajuste: 'mas_simple', previa: 'EXPLICACION_ANTERIOR' });
  const usuario = ultimaPeticion.cuerpo.contents[0].parts[0].text;
  assert.match(usuario, /EXPLICACION_ANTERIOR/);
  assert.match(usuario, /MUCH simpler/);
});

test('sin ajuste válido se ignora la explicación previa', async () => {
  await post('/api/explicar', { texto: 'VPC', previa: 'NO_DEBE_VIAJAR', ajuste: 'hackear' });
  assert.ok(!ultimaPeticion.cuerpo.contents[0].parts[0].text.includes('NO_DEBE_VIAJAR'));
});

test('validaciones de entrada', async () => {
  assert.equal((await post('/api/explicar', { texto: ' ' })).status, 400);
  assert.equal((await post('/api/explicar', { texto: 'x'.repeat(4001) })).status, 400);
  const mal = await fetch(base + '/api/explicar', { method: 'POST', body: '{no es json' });
  assert.equal(mal.status, 400);
});

test('errores de Gemini llegan como mensajes claros', async () => {
  modoGemini = 'limite';
  const a = await post('/api/explicar', { texto: 'EC2' });
  assert.equal(a.status, 429);
  modoGemini = 'vacio';
  const b = await post('/api/explicar', { texto: 'EC2' });
  assert.equal(b.status, 502);
  assert.match((await b.json()).error, /vacía/);
  modoGemini = 'ok';
});

test('/api/voz responde 503 si ElevenLabs no está configurado', async () => {
  const r = await post('/api/voz', { texto: 'hola', voz: 'es-f' });
  assert.equal(r.status, 503);
});

test('ACCESS_CODE protege las rutas POST', async () => {
  process.env.ACCESS_CODE = 'secreto';
  try {
    assert.equal((await fetch(base + '/api/config').then(r => r.json())).requiereCodigo, true);
    const sin = await post('/api/explicar', { texto: 'EC2' });
    assert.equal(sin.status, 401);
    const mal = await post('/api/explicar', { texto: 'EC2' }, { 'x-access-code': 'otro' });
    assert.equal(mal.status, 401);
    const bien = await post('/api/explicar', { texto: 'EC2' }, { 'x-access-code': 'secreto' });
    assert.equal(bien.status, 200);
  } finally { delete process.env.ACCESS_CODE; }
});

test('limita las peticiones por minuto', async () => {
  const codigos = [];
  for (let i = 0; i < 20; i++) codigos.push((await post('/api/explicar', { texto: 'EC2' })).status);
  assert.ok(codigos.includes(429));
});
