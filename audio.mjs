const origins = new Set(['https://lookaside.fbsbx.com', 'https://lookaside.facebook.com', 'https://graph.facebook.com']);
const maxAudioBytes = 1024 * 1024;

export async function transcribeAudio(mediaId, env, readBytes) {
  if (typeof mediaId !== 'string' || !/^\d{1,40}$/.test(mediaId)) throw new Error('Identificador de áudio inválido.');
  const options = { headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` }, redirect: 'error' };
  const metadata = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${mediaId}?phone_number_id=${env.META_PHONE_NUMBER_ID}`,
    { ...options, signal: AbortSignal.timeout(5000) });
  if (!metadata.ok) throw new Error('Áudio indisponível.');
  const media = await metadata.json();
  const url = new URL(media.url);
  if (!origins.has(url.origin) || url.username || url.password || Number(media.file_size) > maxAudioBytes) throw new Error('Áudio inválido.');
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Falha ao baixar áudio.');
  const bytes = await readBytes(response.body, maxAudioBytes);
  if (!bytes.length) throw new Error('Áudio vazio.');
  const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
    audio: bytes.toString('base64'), language: 'pt', task: 'transcribe', vad_filter: true,
    initial_prompt: 'Atendimento em português do Brasil. Opções numeradas, pratos, quantidades e endereços.',
  });
  return typeof result.text === 'string' ? result.text.trim() : '';
}

const numberWords = new Map([
  ['um', 1], ['uma', 1], ['dois', 2], ['duas', 2], ['tres', 3], ['quatro', 4],
  ['cinco', 5], ['seis', 6], ['sete', 7], ['oito', 8], ['nove', 9], ['dez', 10],
  ['onze', 11], ['doze', 12], ['treze', 13], ['catorze', 14], ['quatorze', 14],
  ['quinze', 15], ['dezesseis', 16], ['dezessete', 17], ['dezoito', 18], ['dezenove', 19],
  ['vinte', 20], ['vinte e um', 21], ['vinte e dois', 22],
]);

export function voiceInput(transcript, step) {
  const clean = transcript.replace(/[.!?]+$/u, '').trim();
  const normalized = clean.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ');
  if (['menu', 'cancelar'].includes(normalized)) return normalized;
  if (['name', 'address', 'note'].includes(step)) return transcript;
  if (step === 'change') {
    if (normalized === 'sem troco') return normalized;
    const amount = /^(?:troco para )?(?:r\$\s*)?(\d{1,6}(?:[,.]\d{1,2})?)(?: reais?)?$/.exec(normalized);
    return amount?.[1] ?? clean;
  }
  const choice = normalized.replace(/^(?:(?:a )?opcao(?: numero)?|numero)\s+/, '').replace(/\s+unidades?$/, '');
  const number = numberWords.get(choice);
  return number ? String(number) : /^\d{1,3}$/.test(choice) ? choice : clean;
}
