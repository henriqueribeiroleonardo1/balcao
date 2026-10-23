/**
 * A API inteira empacotada para o navegador. A demonstração do site usa isto:
 * o formulário e o painel conversam com o mesmo código que roda no servidor, só que guardando em memória.
 */
import { sign, type LeadEvent } from '../core/n8n.js';
import { DEMO_BUSINESSES } from '../data/businesses.js';
import { createApp } from '../http/app.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { createMemoryStore } from '../store/store.js';
import { demoLeads } from './demo-seed.js';

export { DEMO_BUSINESSES } from '../data/businesses.js';

/** O fluxo do n8n (n8n/balcao-workflow.json), injetado pelo esbuild na hora do build. */
declare const __BALCAO_WORKFLOW__: unknown;
export const WORKFLOW = __BALCAO_WORKFLOW__;

export const DEMO_TOKEN = 'demo';
const DEMO_SECRET = 'segredo-de-demonstracao-com-32-caracteres';

const listeners = new Set<(event: LeadEvent) => void>();

/** Na demonstração, o "n8n" é a própria página: ela recebe o mesmo evento que o servidor mandaria. */
export function onLeadEvent(listener: (event: LeadEvent) => void): void {
  listeners.add(listener);
}

const app = createApp({
  businesses: DEMO_BUSINESSES,
  store: createMemoryStore(demoLeads(new Date())),
  leadLimiter: createRateLimiter({ limit: 20, windowMs: 60_000 }),
  adminToken: DEMO_TOKEN,
  integrationSecret: DEMO_SECRET,
  notify: async (event) => {
    for (const listener of listeners) queueMicrotask(() => listener(event));
  },
});

/** Assina como o nó "Assinar decisão" do n8n, para devolver a decisão pela rota de verdade. */
export async function signLikeN8n(body: string): Promise<{ timestamp: string; signature: string }> {
  const timestamp = Math.floor(Date.now() / 1000);
  return { timestamp: String(timestamp), signature: await sign(DEMO_SECRET, body, timestamp) };
}

export function request(
  method: string,
  path: string,
  init: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
  const body = init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  if (body !== undefined) headers['content-type'] ??= 'application/json';
  return app.fetch(
    new Request(`https://balcao.demo${path}`, { method, headers, ...(body !== undefined && { body }) }),
    'navegador',
  );
}
