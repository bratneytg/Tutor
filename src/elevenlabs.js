// Voz natural opcional con ElevenLabs. Sin API key la app usa las voces del navegador.
export const VOCES = {
  'es-m': { id: 'wfTWLJ20rcMqvU8gIiAB', nombre: 'Español · hombre' },
  'es-f': { id: 'yFykvY9iSJewrANOC0cU', nombre: 'Español · mujer' },
  'en-m': { id: 'mKoqwDP2laxTdq1gEgU6', nombre: 'English · male' },
  'en-f': { id: 'JaagUurP1dmW3WscoJ79', nombre: 'English · female' },
};
export const hayElevenLabs = () => !!process.env.ELEVENLABS_API_KEY;
export const MAX_CHARS_VOZ = 5000;

/** Devuelve el MP3 (ArrayBuffer) del texto con la voz indicada. */
export async function generarAudio(texto, clave) {
  const voz = VOCES[Object.hasOwn(VOCES, clave) ? clave : 'es-f'];
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz.id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text: texto.slice(0, MAX_CHARS_VOZ), model_id: 'eleven_flash_v2_5' }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!r.ok) {
    console.error(`❌ ElevenLabs ${r.status}:`, (await r.text().catch(() => '')).slice(0, 300));
    throw Object.assign(new Error(`Error de ElevenLabs (${r.status})`), { status: r.status === 429 ? 429 : 502 });
  }
  return r.arrayBuffer();
}
