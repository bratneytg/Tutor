# AWS Tutor

Pega un tema o un párrafo de tu curso de AWS que no te quedó claro y recibe una explicación más simple, con ejemplos, en **texto** y en **voz**.

- **Nivel** de explicación: "como si tuviera 12 años", principiante o intermedio.
- **Qué incluir**: palabras sencillas, ejemplos, analogía cotidiana, paso a paso, caso real en AWS, puntos clave y tip de examen.
- **¿Sigue sin quedar claro?** Botones para reexplicar: más simple, más ejemplos, más técnico, más corto.
- **Voz**: voces del navegador (gratis) o voz natural de ElevenLabs si configuras la clave. Pausa, stop y velocidad. Las siglas (EC2, S3, IAM…) se deletrean para que se oigan bien.
- **Historial** de consultas guardado en tu navegador, para repasar.
- Español o inglés.

## Proyecto independiente

No depende de ningún otro proyecto: tiene su propio `package.json`, su propio `.env` y no usa dependencias externas (solo Node.js). Puedes copiar esta carpeta a cualquier sitio y funciona.

## Ejecutarla

Requiere Node.js 20.12 o superior.

```bash
cd aws-tutor
cp .env.example .env     # y rellena GEMINI_API_KEY (opcional: ELEVENLABS_API_KEY)
npm start                # http://localhost:3100
```

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `GEMINI_API_KEY` | Sí | Generar las explicaciones |
| `ELEVENLABS_API_KEY` | No | Voz natural. Sin ella solo salen las voces del navegador |
| `ACCESS_CODE` | No, pero recomendable si la publicas | Código que la web pide antes de gastar tus créditos (solo caracteres ASCII) |
| `GEMINI_MODEL` | No | Por defecto `gemini-3.8-flash` |
| `PORT` | No | Por defecto `3100` |
| `TRUST_PROXY` | No | Ponla a `1` en Render u otro proxy para limitar por IP real |

## Publicarla en Render

Crea un Web Service nuevo apuntando a este repo con **Root Directory** `aws-tutor`, **Build Command** vacío y **Start Command** `npm start`. Define las variables de la tabla de arriba (incluye `ACCESS_CODE` y `TRUST_PROXY=1`).

## Tests

```bash
npm test
```

Prueban la API con un Gemini simulado (validaciones, errores, límite de peticiones, código de acceso, path traversal) y el renderizado de Markdown, incluida la protección contra HTML inyectado.

## Estructura

```
server.js            servidor HTTP + API (/api/config, /api/explicar, /api/voz)
src/gemini.js        prompts del tutor y llamada a Gemini
src/elevenlabs.js    voz natural opcional
public/              interfaz (index.html, style.css, app.js)
public/md.js         Markdown seguro y limpieza de texto para voz
test/                tests con node:test
```
