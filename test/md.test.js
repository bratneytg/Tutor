import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, textoParaVoz, trocear } from '../public/md.js';

test('renderMarkdown escapa HTML peligroso', () => {
  const html = renderMarkdown('<script>alert(1)</script> **hola**\n\n- <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>hola</strong>'));
});

test('renderMarkdown: títulos, listas, código', () => {
  const html = renderMarkdown('# Título\n\nTexto con `EC2`.\n\n1. uno\n2. dos\n\n- a\n- b\n\n```bash\naws s3 ls <bucket>\n```');
  assert.match(html, /<h2>Título<\/h2>/);
  assert.match(html, /<code>EC2<\/code>/);
  assert.match(html, /<ol>\s*<li>uno<\/li>\s*<li>dos<\/li>\s*<\/ol>/);
  assert.match(html, /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
  assert.match(html, /<pre><code>aws s3 ls &lt;bucket&gt;<\/code><\/pre>/);
});

test('renderMarkdown: bloque de código sin cerrar no rompe', () => {
  assert.match(renderMarkdown('```\nsolo código'), /<pre><code>solo código<\/code><\/pre>/);
});

test('textoParaVoz quita markdown, omite código y deletrea siglas', () => {
  const t = textoParaVoz('## Qué es S3\n\n**Amazon S3** guarda *archivos*.\n\n- Barato\n- Duradero\n\n```bash\naws s3 ls\n```\n\nUsa `IAM`.');
  assert.ok(!/[#*`]/.test(t));
  assert.ok(t.includes('Qué es S 3.'));
  assert.ok(t.includes('Bloque de código omitido.'));
  assert.ok(!t.includes('aws s3 ls'));
  assert.ok(t.includes('I A M'));
  assert.ok(t.includes('Barato.'));
});

test('trocear respeta el máximo y no pierde texto', () => {
  const texto = 'Primera frase. ' + 'palabra '.repeat(80) + 'Última frase.';
  const trozos = trocear(texto, 100);
  assert.ok(trozos.every(t => t.length <= 100));
  assert.equal(trozos.join(' ').replace(/\s+/g, ' '), texto.replace(/\s+/g, ' ').trim());
});
