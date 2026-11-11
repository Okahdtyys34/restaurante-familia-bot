import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { money, respond } from './bot.mjs';
import { transcribeAudio, voiceInput } from './audio.mjs';
import { panel } from './panel.mjs';

const statuses = ['Aguardando aceite', 'Aceito', 'Em preparo', 'Pronto', 'Concluído', 'Recusado'];
const windowMs = 32 * 86400000;
const digest = value => createHash('sha256').update(value).digest();
const equals = (a, b) => timingSafeEqual(digest(a), digest(b));

function answer(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: {
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer', ...headers,
  } });
}

export async function readBytes(stream, max) {
  const parts = [];
  let size = 0;
  if (stream) for await (const part of stream) {
    size += part.length;
    if (size > max) throw Object.assign(new Error('Conteúdo acima do limite'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts, size);
}

function parseMenu(raw) {
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 20) throw new Error('Informe de 1 a 20 itens.');
  const names = new Set();
  return lines.map((line, index) => {
    const match = /^([^|\r\n]{1,70})\|\s*(\d{1,4})(?:[,.](\d{1,2}))?$/.exec(line);
    if (!match) throw new Error(`Linha ${index + 1}: use Nome do prato | 28,00`);
    const name = match[1].trim();
    const price = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
    const key = name.toLocaleLowerCase('pt-BR');
    if (!name || price <= 0 || names.has(key)) throw new Error(`Linha ${index + 1}: use um nome único e preço maior que zero.`);
    names.add(key);
    return { name, price };
  });
}

export function createApp(storage, env) {
  const { sql } = storage;
  const run = (statement, ...params) => sql.exec(statement, ...params);
  const rows = (statement, ...params) => run(statement, ...params).toArray();
  const first = (statement, ...params) => rows(statement, ...params)[0];
  run(`CREATE TABLE IF NOT EXISTS menus (id INTEGER PRIMARY KEY, day TEXT NOT NULL UNIQUE, items TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE IF NOT EXISTS sessions (sender TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, sender TEXT NOT NULL, day TEXT NOT NULL, receipt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Aguardando aceite');
    CREATE TABLE IF NOT EXISTS send_attempts (phone TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS send_attempts_by_phone ON send_attempts (phone, at);`);
  const fee = Number(env.DELIVERY_FEE_CENTS ?? 0);
  const limit = Number(env.META_SEND_LIMIT ?? 900);
  const voice = Boolean(env.AI && env.VOICE_ENABLED !== '0');
  const phone = env.META_PHONE_NUMBER_ID ?? '';
  const support = /^\d{8,15}$/.test(env.SUPPORT_NUMBER ?? '') ? env.SUPPORT_NUMBER : '';
  const configured = /^\d+$/.test(phone) && /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION ?? '') &&
    Boolean(env.META_VERIFY_TOKEN && env.META_APP_SECRET && env.META_ACCESS_TOKEN) &&
    Number.isInteger(fee) && fee >= 0 && fee <= 100000 && Number.isInteger(limit) && limit >= 1 && limit <= 1000;
  const password = env.ADMIN_PASSWORD ?? '';
  const auth = 'Basic ' + Buffer.from(`dono:${password}`).toString('base64');
  const csrf = createHmac('sha256', password).update('familia-cloud-admin-v1').digest('hex');
  const clock = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: env.RESTAURANT_TIME_ZONE ?? 'America/Fortaleza' });
  const today = () => {
    const parts = Object.fromEntries(clock.formatToParts().map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const used = (now = Date.now()) => first('SELECT COUNT(*) AS n FROM send_attempts WHERE phone = ? AND at > ?', phone, now - windowMs).n;
  const menuFor = day => {
    const row = first('SELECT id, items FROM menus WHERE day = ?', day);
    return row && { id: row.id, items: JSON.parse(row.items) };
  };

  function view({ status = 200, notice = '', draft } = {}) {
    const day = today();
    const current = menuFor(day);
    const previous = first('SELECT day FROM menus WHERE day < ? ORDER BY day DESC LIMIT 1', day);
    const editable = current ?? (previous && menuFor(previous.day));
    const items = editable?.items.map(({ name, price }) => `${name} | ${(price / 100).toFixed(2).replace('.', ',')}`).join('\n') ?? '';
    const orders = rows('SELECT id, day, receipt, status, sender FROM orders ORDER BY id DESC LIMIT 100');
    return answer(panel({ day, current, draft: draft ?? items, fee: money(fee), orders, statuses, csrf, notice,
      configured, voice, used: used(), limit }), status, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  async function admin(request, path) {
    if (password.length < 16) return answer('Configure ADMIN_PASSWORD com pelo menos 16 caracteres.', 503);
    if (!equals(request.headers.get('authorization') ?? '', auth)) {
      return answer('Entre como dono com a senha do painel.', 401, { 'WWW-Authenticate': 'Basic realm="Restaurante da Familia", charset="UTF-8"' });
    }
    if (request.method === 'GET' && path === '/admin') return view();
    if (request.method !== 'POST' || path === '/admin') return answer('Página não encontrada.', 404);
    const form = new URLSearchParams((await readBytes(request.body, 16384)).toString('utf8'));
    if (!equals(form.get('csrf') ?? '', csrf)) return answer('Formulário inválido.', 403);
    if (path === '/admin/status') {
      const id = Number(form.get('id'));
      const status = form.get('status');
      if (!Number.isSafeInteger(id) || id <= 0 || !statuses.includes(status)) return answer('Pedido ou status inválido.', 400);
      if (!first('UPDATE orders SET status = ? WHERE id = ? RETURNING id', status, id)) return answer('Pedido não encontrado.', 404);
      return view({ notice: `Status do pedido #${id} atualizado.` });
    }
    const day = today();
    const draft = form.get('items') ?? '';
    if (form.get('day') !== day) return view({ status: 409, notice: 'O dia mudou. Confira a lista e publique de novo.', draft });
    let items;
    try { items = parseMenu(draft); }
    catch (error) { return view({ status: 400, notice: error.message, draft }); }
    if (JSON.stringify(menuFor(day)?.items) !== JSON.stringify(items)) {
      storage.transactionSync(() => {
        const { id } = first('INSERT INTO revisions DEFAULT VALUES RETURNING id');
        run('INSERT INTO menus VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET id = excluded.id, items = excluded.items', id, day, JSON.stringify(items));
      });
    }
    return view({ notice: 'Cardápio publicado!' });
  }

  function prepare(message, transcript, fallback) {
    return storage.transactionSync(() => {
      let body = fallback;
      if (!body) {
        const row = first('SELECT data FROM sessions WHERE sender = ?', message.from);
        const session = row && JSON.parse(row.data);
        const lastOrder = first('SELECT id, receipt, status FROM orders WHERE sender = ? ORDER BY id DESC LIMIT 1', message.from);
        const day = today();
        const fromVoice = transcript !== undefined;
        const input = fromVoice ? voiceInput(transcript, session?.step) : message.text?.body;
        const next = respond(session, input, menuFor(day), { lastOrder, fee, support, fromVoice });
        if (next.order) run('INSERT INTO orders (sender, day, receipt) VALUES (?, ?, ?)', message.from, day, next.order);
        run('INSERT INTO sessions VALUES (?, ?) ON CONFLICT(sender) DO UPDATE SET data = excluded.data', message.from, JSON.stringify(next.session));
        body = fromVoice ? `🎙️ Transcrição: ${transcript}\n\n${next.body}` : next.body;
        if (!session && voice) body += '\n\nVocê também pode responder por áudio. A Cloudflare processa a gravação para convertê-la em texto.';
      }
      run('INSERT INTO replies (id, body) VALUES (?, ?)', message.id, body);
      return body;
    });
  }

  async function deliver(message) {
    const stored = first('SELECT body, sent FROM replies WHERE id = ?', message.id);
    if (stored?.sent) return;
    const reserved = storage.transactionSync(() => {
      const now = Date.now();
      if (used(now) >= limit) return false;
      run('INSERT INTO send_attempts VALUES (?, ?)', phone, now);
      return true;
    });
    if (!reserved) return;
    let body = stored?.body;
    if (!stored && message.type === 'audio') {
      let transcript;
      if (voice) {
        try { transcript = await transcribeAudio(message.audio?.id, env, readBytes); }
        catch { console.error('Transcrição indisponível.'); }
      }
      body = transcript && transcript.length <= 200 ? prepare(message, transcript) :
        prepare(message, undefined, 'Não consegui usar esse áudio. Envie sua resposta por texto ou grave uma mensagem mais curta.');
    }
    body ??= prepare(message);
    const sent = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${phone}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: message.from, type: 'text', text: { body } }),
    });
    if (!sent.ok) throw new Error(`Resposta da Meta: ${sent.status}`);
    run('UPDATE replies SET sent = 1, body = ? WHERE id = ?', '', message.id);
  }

  const queues = new Map();
  function enqueue(message) {
    const previous = queues.get(message.from) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(() => deliver(message));
    queues.set(message.from, job);
    return job.finally(() => { if (queues.get(message.from) === job) queues.delete(message.from); });
  }

  async function webhook(request, url) {
    if (!configured) return answer('Configure a conta Meta e o limite de envio.', 503);
    if (request.method === 'GET') {
      const params = url.searchParams;
      const verified = params.get('hub.mode') === 'subscribe' && equals(params.get('hub.verify_token') ?? '', env.META_VERIFY_TOKEN);
      return verified ? answer(params.get('hub.challenge') ?? '') : answer('Verificação inválida.', 403);
    }
    if (request.method !== 'POST') return answer('Método inválido.', 405);
    const raw = await readBytes(request.body, 1024 * 1024);
    const signature = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex')}`;
    if (!equals(request.headers.get('x-hub-signature-256') ?? '', signature)) return answer('Assinatura inválida.', 403);
    const payload = JSON.parse(raw);
    if (payload.object !== 'whatsapp_business_account') return answer('Ignorado');
    const entries = (payload.entry ?? []).flatMap(entry => entry.changes ?? []);
    const messages = entries.filter(({ field, value }) => field === 'messages' && value?.metadata?.phone_number_id === phone)
      .flatMap(({ value }) => value.messages ?? [])
      .filter(message => typeof message.id === 'string' && typeof message.from === 'string' && !['system', 'unsupported'].includes(message.type));
    await Promise.all(messages.map(enqueue));
    return answer('OK');
  }

  return async request => {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return answer('OK');
      if (url.pathname === '/webhook') return await webhook(request, url);
      if (['/admin', '/admin/menu', '/admin/status'].includes(url.pathname)) return await admin(request, url.pathname);
      return answer('Página não encontrada.', 404);
    } catch (error) {
      console.error('Erro no atendimento:', error.status ?? error.name);
      return answer('Falha ao processar a solicitação.', error.status ?? 503);
    }
  };
}
