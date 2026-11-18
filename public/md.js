// Funciones puras (sin DOM) para que el navegador y los tests usen el mismo código.

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  // s ya viene escapado: solo añadimos nuestras propias etiquetas
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
}

/** Markdown básico → HTML seguro (todo el texto se escapa antes de añadir etiquetas). */
export function renderMarkdown(md) {
  const lineas = String(md).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let lista = null;        // 'ul' | 'ol'
  let parrafo = [];
  let codigo = null;       // acumula líneas de un bloque ```

  const cerrarParrafo = () => { if (parrafo.length) { html.push(`<p>${inline(parrafo.join(' '))}</p>`); parrafo = []; } };
  const cerrarLista = () => { if (lista) { html.push(`</${lista}>`); lista = null; } };

  for (const cruda of lineas) {
    if (/^\s*```/.test(cruda)) {
      if (codigo) { html.push(`<pre><code>${codigo.join('\n')}</code></pre>`); codigo = null; }
      else { cerrarParrafo(); cerrarLista(); codigo = []; }
      continue;
    }
    const l = escapar(cruda);
    if (codigo) { codigo.push(l); continue; }

    let m;
    if (!l.trim()) { cerrarParrafo(); cerrarLista(); }
    else if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      cerrarParrafo(); cerrarLista();
      const n = Math.min(Math.max(m[1].length, 2), 4); // # y ## → h2 (el h1 es el título de la página)
      html.push(`<h${n}>${inline(m[2])}</h${n}>`);
    } else if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) {
      cerrarParrafo();
      if (lista !== 'ul') { cerrarLista(); html.push('<ul>'); lista = 'ul'; }
      html.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) {
      cerrarParrafo();
      if (lista !== 'ol') { cerrarLista(); html.push('<ol>'); lista = 'ol'; }
      html.push(`<li>${inline(m[1])}</li>`);
    } else {
      cerrarLista();
      parrafo.push(l.trim());
    }
  }
  if (codigo) html.push(`<pre><code>${codigo.join('\n')}</code></pre>`);
  cerrarParrafo(); cerrarLista();
  return html.join('\n');
}

// Siglas que las voces suelen leer mal como palabra: se deletrean ("EC2" → "E C 2")
const SIGLAS = ['AWS', 'EC2', 'S3', 'IAM', 'VPC', 'RDS', 'EBS', 'EFS', 'SQS', 'SNS', 'ELB', 'ALB', 'NLB', 'AMI', 'ECS', 'EKS', 'KMS',
  'CLI', 'SDK', 'API', 'CDN', 'DNS', 'SSL', 'TLS', 'SLA', 'CPU', 'RAM', 'SSD', 'IP', 'VM', 'SSH', 'JSON', 'YAML', 'MFA', 'SSO'];
const RE_SIGLAS = new RegExp(`\\b(${SIGLAS.join('|')})\\b`, 'g');

/** Markdown → texto plano pensado para ser leído en voz alta. */
export function textoParaVoz(md, idioma = 'es') {
  const omitido = idioma === 'en' ? 'Code block omitted.' : 'Bloque de código omitido.';
  return String(md)
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?(```|$)/g, `\n${omitido}\n`)
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/<\/?[a-z][^>\n]*>/gi, ' ')   // etiquetas HTML sueltas: no se leen
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_, t) => (/[.:!?]$/.test(t.trim()) ? t : `${t}.`)) // los títulos terminan en pausa
    .replace(/^\s*[-*•]\s+(.*)$/gm, (_, t) => (/[.;:!?]$/.test(t.trim()) ? t : `${t}.`))
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(RE_SIGLAS, (s) => s.split('').join(' '))
    .replace(/[#*_~>|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Texto pegado por el usuario → texto para leer tal cual (sin interpretar Markdown). */
export function textoLiteralParaVoz(texto, idioma = 'es') {
  const enlace = idioma === 'en' ? 'link' : 'enlace';
  return String(texto)
    .replace(/\r\n?/g, '\n')
    .replace(/https?:\/\/\S+/g, ` ${enlace} `)
    .replace(RE_SIGLAS, (s) => s.split('').join(' '))
    .split(/\n\s*\n/)                                   // párrafos
    .map(p => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()) // saltos de línea sueltos (típicos al copiar de un PDF) → espacio
    .filter(Boolean)
    .map(p => (/[.!?…:;]$/.test(p) ? p : `${p}.`))        // cada párrafo o título termina en pausa
    .join('\n');
}

/** Trocea el texto por frases (≤ max caracteres): las voces del navegador se cortan con textos largos. */
export function trocear(texto, max = 220) {
  const frases = texto.replace(/\n/g, ' ').match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [texto];
  const trozos = [];
  let actual = '';
  for (let f of frases) {
    while (f.length > max) { // frase larguísima: se parte por espacios
      const corte = f.lastIndexOf(' ', max) > 0 ? f.lastIndexOf(' ', max) : max;
      if (actual) { trozos.push(actual.trim()); actual = ''; }
      trozos.push(f.slice(0, corte).trim());
      f = f.slice(corte);
    }
    if ((actual + f).length > max) { trozos.push(actual.trim()); actual = f; } else actual += f;
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos.filter(Boolean);
}
