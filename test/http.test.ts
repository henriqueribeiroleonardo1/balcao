import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sign, type LeadEvent } from '../src/core/n8n.js';
import { DEMO_BUSINESSES } from '../src/data/businesses.js';
import { createApp, type AppDeps } from '../src/http/app.js';
import { createRateLimiter } from '../src/lib/rate-limit.js';
import { createMemoryStore } from '../src/store/store.js';
import { demoLeads } from '../src/web/demo-seed.js';

const NOW = new Date('2026-10-23T15:00:00Z');
const TOKEN = 't'.repeat(32);
const SECRET = 's'.repeat(40);
const ORIGIN = 'https://cromopintura.com.br';

function setup(overrides: Partial<AppDeps> = {}) {
  const events: LeadEvent[] = [];
  const logs: string[] = [];
  let ids = 0;
  const store = createMemoryStore(demoLeads(NOW));
  const app = createApp({
    businesses: DEMO_BUSINESSES,
    store,
    leadLimiter: createRateLimiter({ limit: 5, windowMs: 60_000 }),
    adminToken: TOKEN,
    integrationSecret: SECRET,
    notify: async (event) => {
      events.push(event);
    },
    now: () => NOW,
    newId: () => `novo-${++ids}`,
    log: (line) => logs.push(line),
    ...overrides,
  });
  const call = (method: string, path: string, init: RequestInit = {}) =>
    app.fetch(new Request(`http://api.test${path}`, { method, ...init }), '1.2.3.4');
  const admin = (method: string, path: string, body?: unknown) =>
    call(method, path, {
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const send = (body: object, headers: Record<string, string> = {}) =>
    call('POST', '/v1/leads', {
      headers: { 'content-type': 'application/json', 'x-balcao-key': 'pk_demo_cromo', ...headers },
      body: JSON.stringify(body),
    });
  return { app, call, admin, send, store, events, logs };
}

const LEAD = { name: 'Ana Souza', phone: '61 99123-4567', message: 'Quero pintar o portão de casa, 3 metros.' };

describe('POST /v1/leads', () => {
  it('salva, classifica e avisa o n8n', async () => {
    const { send, store, events } = setup();
    const res = await send(LEAD, { origin: ORIGIN });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    const { id } = await res.json();
    assert.equal(store.get(id)?.serviceId, 'portao');
    assert.equal(store.get(id)?.notifiedAt, NOW.toISOString());
    assert.equal(events[0]?.business.serviceName, 'Portões e grades');
    assert.match(events[0]?.replyLink ?? '', /^https:\/\/wa\.me\/5561991234567\?text=/);
    assert.equal('publicKey' in (events[0]?.business ?? {}), false);
  });

  it('recusa chave errada e site não autorizado', async () => {
    const { send } = setup();
    assert.equal((await send(LEAD, { 'x-balcao-key': 'pk_errada' })).status, 401);
    assert.equal((await send(LEAD, { origin: 'https://golpe.example' })).status, 403);
  });

  it('em desenvolvimento aceita localhost', async () => {
    const { send } = setup({ allowLocalhost: true });
    assert.equal((await send(LEAD, { origin: 'http://localhost:5173' })).status, 201);
  });

  it('erro de validação vira 422 por campo', async () => {
    const { send } = setup();
    const res = await send({ ...LEAD, phone: '999' });
    assert.equal(res.status, 422);
    assert.ok((await res.json()).fields.phone);
  });

  it('não duplica o mesmo pedido', async () => {
    const { send, store } = setup();
    const first = await (await send(LEAD)).json();
    const second = await send({ ...LEAD, message: 'Quero  pintar o PORTÃO de casa, 3 metros.' });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).id, first.id);
    assert.equal(store.list({ business: 'cromo-eletrostatica' }).filter((l) => l.name === 'Ana Souza').length, 1);
  });

  it('pedido suspeito é salvo, mas não incomoda o dono', async () => {
    const { send, events } = setup();
    const res = await send({ ...LEAD, message: 'Aumente suas vendas com SEO e backlink agora mesmo' });
    assert.equal(res.status, 201);
    assert.equal(events.length, 0);
  });

  it('se o n8n cair, o pedido continua salvo', async () => {
    const { send, store, logs } = setup({
      notify: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const res = await send(LEAD);
    assert.equal(res.status, 201);
    const lead = store.get((await res.json()).id);
    assert.equal(lead?.notifiedAt, null);
    assert.ok(logs.some((l) => l.includes('falhou')));
  });

  it('formulário HTML puro redireciona para a página de obrigado do site', async () => {
    const { call } = setup();
    const form = new URLSearchParams({ ...LEAD, _key: 'pk_demo_cromo', _next: `${ORIGIN}/obrigado` });
    const res = await call('POST', '/v1/leads', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `${ORIGIN}/obrigado`);
  });

  it('formulário HTML não redireciona para fora do site do negócio', async () => {
    const { call } = setup();
    const form = new URLSearchParams({ ...LEAD, _key: 'pk_demo_cromo', _next: 'https://golpe.example/x' });
    const res = await call('POST', '/v1/leads', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Pedido enviado/);
  });

  it('limita pedidos por IP', async () => {
    const { send } = setup({ leadLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    await send(LEAD);
    assert.equal((await send({ ...LEAD, phone: '61 99123-0000' })).status, 429);
  });

  it('nunca escreve dados pessoais no log', async () => {
    const { send, logs } = setup();
    await send(LEAD);
    const all = logs.join('\n');
    for (const secret of ['Ana', '99123', 'portão']) assert.ok(!all.includes(secret), secret);
  });
});

describe('rotas do painel', () => {
  it('exigem token', async () => {
    const { call } = setup();
    assert.equal((await call('GET', '/v1/leads')).status, 401);
    assert.equal((await call('GET', '/v1/leads', { headers: { authorization: 'Bearer errado' } })).status, 401);
    const off = setup({ adminToken: undefined as unknown as string });
    assert.equal((await off.admin('GET', '/v1/leads')).status, 503);
  });

  it('lista com nome do serviço, link de resposta e sem a impressão digital', async () => {
    const { admin } = setup();
    const body = await (await admin('GET', '/v1/leads?business=oficina-pistao')).json();
    assert.ok(body.total >= 3);
    const first = body.data[0];
    assert.equal(first.businessName, 'Oficina Pistão');
    assert.equal(first.serviceName, 'Elétrica');
    assert.match(first.replyLink, /wa\.me/);
    assert.equal(first.fingerprint, undefined);
  });

  it('filtra pedidos parados', async () => {
    const { admin } = setup();
    const body = await (await admin('GET', '/v1/leads?stale=1')).json();
    assert.deepEqual(body.data.map((l: { name: string }) => l.name).sort(), [
      'Metalúrgica Bom Jesus',
      'Patrícia Gomes',
    ]);
  });

  it('valida filtros', async () => {
    const { admin } = setup();
    assert.equal((await admin('GET', '/v1/leads?status=arquivado')).status, 400);
    assert.equal((await admin('GET', '/v1/leads?business=nao-existe')).status, 404);
  });

  it('mudar o status registra a primeira resposta uma vez só', async () => {
    const { admin } = setup();
    const first = await (await admin('PATCH', '/v1/leads/demo-1', { status: 'em contato' })).json();
    assert.equal(first.firstResponseAt, NOW.toISOString());
    const later = await (await admin('PATCH', '/v1/leads/demo-1', { status: 'fechado' })).json();
    assert.equal(later.status, 'fechado');
    assert.equal(later.firstResponseAt, NOW.toISOString());
    assert.equal((await admin('PATCH', '/v1/leads/demo-1', { status: 'sumiu' })).status, 422);
    assert.equal((await admin('PATCH', '/v1/leads/nao-existe', { status: 'fechado' })).status, 404);
  });

  it('estatísticas por negócio', async () => {
    const { admin } = setup();
    const stats = await (await admin('GET', '/v1/stats?business=cantina-dona-cida')).json();
    assert.equal(stats.total, 2);
    assert.equal(stats.byStatus.fechado, 1);
  });

  it('dados públicos do negócio não expõem a configuração', async () => {
    const { call } = setup();
    const body = await (await call('GET', '/v1/businesses/oficina-pistao')).json();
    assert.equal(body.name, 'Oficina Pistão');
    assert.equal(body.allowedOrigins, undefined);
    assert.equal(body.services[0].keywords, undefined);
  });
});

describe('POST /v1/leads/:id/triage (n8n)', () => {
  const triage = {
    summary: 'Bateria descarregada, quer busca em casa.',
    priority: 'alta',
    suggestedReply: 'Oi Marcos!',
  };

  it('aceita a triagem assinada', async () => {
    const { call } = setup();
    const body = JSON.stringify(triage);
    const timestamp = Math.floor(NOW.getTime() / 1000);
    const res = await call('POST', '/v1/leads/demo-1/triage', {
      headers: { 'x-balcao-timestamp': String(timestamp), 'x-balcao-signature': await sign(SECRET, body, timestamp) },
      body,
    });
    assert.equal(res.status, 200);
    const lead = await res.json();
    assert.equal(lead.triage.priority, 'alta');
    // A resposta sugerida pela IA passa a ser o texto do link do WhatsApp.
    assert.match(lead.replyLink, /text=Oi%20Marcos!/);
  });

  it('recusa assinatura errada ou velha', async () => {
    const { call } = setup();
    const body = JSON.stringify(triage);
    const old = Math.floor(NOW.getTime() / 1000) - 600;
    const bad = await call('POST', '/v1/leads/demo-1/triage', {
      headers: { 'x-balcao-timestamp': String(old), 'x-balcao-signature': await sign(SECRET, body, old) },
      body,
    });
    assert.equal(bad.status, 401);
    const none = await call('POST', '/v1/leads/demo-1/triage', { body });
    assert.equal(none.status, 401);
  });
});

describe('roteamento', () => {
  it('404, 405 e OPTIONS', async () => {
    const { call } = setup();
    assert.equal((await call('GET', '/nada')).status, 404);
    assert.equal((await call('DELETE', '/v1/leads')).status, 405);
    const preflight = await call('OPTIONS', '/v1/leads', { headers: { origin: ORIGIN } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  });
});

describe('ferramentas do agente', () => {
  it('histórico do cliente pelo telefone, digitado de qualquer jeito', async () => {
    const { admin } = setup();
    const body = await (await admin('GET', '/v1/leads?phone=61%2099777-0102')).json();
    assert.deepEqual(body.data.map((l: { status: string }) => l.status).sort(), ['fechado', 'novo']);
    assert.equal((await admin('GET', '/v1/leads?phone=123')).status, 400);
  });

  it('a decisão do agente guarda o motivo', async () => {
    const { call } = setup();
    const body = JSON.stringify({
      summary: 'x',
      priority: 'baixa',
      reason: 'Não combina com o negócio.',
      suggestedReply: '',
    });
    const timestamp = Math.floor(NOW.getTime() / 1000);
    const res = await call('POST', '/v1/leads/demo-3/triage', {
      headers: { 'x-balcao-timestamp': String(timestamp), 'x-balcao-signature': await sign(SECRET, body, timestamp) },
      body,
    });
    assert.equal((await res.json()).triage.reason, 'Não combina com o negócio.');
  });
});
