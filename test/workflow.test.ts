import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { sign, verifySignature, type LeadEvent } from '../src/core/n8n.js';
import { DEMO_BUSINESSES } from '../src/data/businesses.js';
import { createApp } from '../src/http/app.js';
import { createRateLimiter } from '../src/lib/rate-limit.js';
import { createMemoryStore } from '../src/store/store.js';

/** Roda os nós de código do fluxo do n8n aqui, com as mesmas variáveis que o n8n oferece. */
interface N8nNode {
  name: string;
  parameters: { jsCode?: string };
}
const workflow = JSON.parse(readFileSync(new URL('../n8n/balcao-workflow.json', import.meta.url), 'utf8')) as {
  nodes: N8nNode[];
  connections: Record<string, Record<string, { node: string }[][]>>;
};
const require = createRequire(import.meta.url);
const SECRET = 'k'.repeat(40);
const ENV = { BALCAO_N8N_SECRET: SECRET, TELEGRAM_CHAT_ID: '999' };

function runCode(nodeName: string, input: unknown, refs: Record<string, unknown> = {}) {
  const code = workflow.nodes.find((n) => n.name === nodeName)?.parameters.jsCode;
  assert.ok(code, `nó ${nodeName} não encontrado`);
  const $input = { first: () => ({ json: input }) };
  const $ = (name: string) => ({ first: () => ({ json: refs[name] }) });
  const fn = new Function('require', '$input', '$', '$env', 'Buffer', code) as (...args: unknown[]) => { json: any }[];
  return fn(require, $input, $, ENV, Buffer)[0]?.json;
}

/** Captura o evento que a API de verdade manda para o n8n. */
async function realEvent(): Promise<{ event: LeadEvent; body: string; headers: Record<string, string> }> {
  let captured: { body: string; headers: Record<string, string> } | undefined;
  const { createN8nNotifier } = await import('../src/core/n8n.js');
  const notify = createN8nNotifier({
    webhookUrl: 'https://n8n.test/webhook/balcao',
    secret: SECRET,
    fetch: (async (_url: string, init: RequestInit) => {
      captured = { body: init.body as string, headers: init.headers as Record<string, string> };
      return new Response('{}', { status: 202 });
    }) as typeof fetch,
  });
  const app = createApp({
    businesses: DEMO_BUSINESSES,
    store: createMemoryStore(),
    leadLimiter: createRateLimiter({ limit: 10, windowMs: 1000 }),
    notify,
  });
  await app.fetch(
    new Request('http://api.test/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-balcao-key': 'pk_demo_pistao' },
      body: JSON.stringify({
        name: 'Carla <Dev>',
        phone: '61 99123-4567',
        email: 'carla@exemplo.com',
        message: 'Meu carro não liga, preciso hoje.',
      }),
    }),
  );
  assert.ok(captured);
  return { event: JSON.parse(captured.body) as LeadEvent, ...captured };
}

describe('fluxo do n8n', () => {
  it('todas as conexões apontam para nós que existem', () => {
    const names = new Set(workflow.nodes.map((n) => n.name));
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source), source);
      for (const target of Object.values(outputs).flat(2)) assert.ok(names.has(target.node), target.node);
    }
  });

  it('o agente tem modelo, as duas ferramentas e o formato de saída ligados', () => {
    const into = (type: string) =>
      Object.entries(workflow.connections)
        .filter(([, outputs]) => (outputs[type] ?? []).flat().some((t) => t.node === 'Agente de triagem'))
        .map(([name]) => name)
        .sort();
    assert.deepEqual(into('ai_languageModel'), ['Groq · Llama 3.3']);
    assert.deepEqual(into('ai_tool'), ['historico_do_cliente', 'servicos_do_negocio']);
    assert.deepEqual(into('ai_outputParser'), ['Formato da decisão']);
  });

  it('aceita a assinatura gerada pela API e recusa evento alterado', async () => {
    const { event, headers } = await realEvent();
    assert.equal(runCode('Verificar assinatura', { headers, body: event }).valid, true);
    const tampered = { ...event, replyLink: 'https://golpe.example' };
    assert.equal(runCode('Verificar assinatura', { headers, body: tampered }).valid, false);
    assert.equal(runCode('Verificar assinatura', { headers: {}, body: event }).valid, false);
  });

  it('o contexto do agente separa a mensagem do cliente', async () => {
    const { event } = await realEvent();
    const out = runCode('Preparar contexto', { event });
    assert.match(out.prompt, /Urgência pelas regras: pressa explícita/);
    assert.match(out.prompt, /<mensagem_do_cliente>\nMeu carro não liga, preciso hoje\.\n<\/mensagem_do_cliente>/);
  });

  it('a decisão do agente volta para a API com assinatura que a API aceita', async () => {
    const { event } = await realEvent();
    const decided = {
      summary: 'Carro sem bateria, quer hoje.',
      priority: 'alta',
      reason: 'Pressa explícita.',
      suggestedReply: 'Oi Carla! Vamos te ajudar.',
    };
    const notice = runCode('Montar aviso', { output: decided }, { 'Preparar contexto': { event } });
    assert.equal(notice.chatId, '999');
    assert.equal(notice.clientEmail, 'carla@exemplo.com');
    assert.match(notice.telegram, /^🔴/);
    assert.match(notice.telegram, /Carla &lt;Dev&gt;/);
    assert.match(notice.telegram, /⏱ pede pressa/);
    assert.match(notice.telegram, /wa\.me\/5561991234567\?text=Oi%20Carla!/);

    const signed = runCode('Assinar decisão', notice);
    assert.equal(
      await verifySignature(SECRET, signed.body, signed.timestamp, signed.signature, Math.floor(Date.now() / 1000)),
      true,
    );
    assert.equal(signed.signature, await sign(SECRET, signed.body, Number(signed.timestamp)));
    assert.equal(JSON.parse(signed.body).reason, 'Pressa explícita.');
  });

  it('segue em frente quando o agente falha', async () => {
    const { event } = await realEvent();
    const notice = runCode('Montar aviso', { error: 'timeout' }, { 'Preparar contexto': { event } });
    assert.equal(notice.triage.priority, 'alta');
    assert.match(notice.telegram, /Responder no WhatsApp/);
  });

  it('cobrança: nada quando não há pedido parado, lista quando há', () => {
    assert.equal(runCode('Montar cobrança', { data: [] }), undefined);
    const lead = {
      name: 'Renato',
      businessName: 'Cromo',
      createdAt: new Date(Date.now() - 50 * 3_600_000).toISOString(),
      replyLink: 'https://wa.me/55?text=oi',
    };
    const out = runCode('Montar cobrança', { data: [lead, { ...lead, name: 'Bia' }] });
    assert.match(out.text, /2 pedidos parados/);
    assert.match(out.text, /Renato<\/b> \(Cromo\), há 50h/);
  });
});
