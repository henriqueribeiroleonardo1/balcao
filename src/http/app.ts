import { buildLead, isStale } from '../core/lead.js';
import { verifySignature, type LeadEvent, type Notifier } from '../core/n8n.js';
import { computeStats } from '../core/stats.js';
import { LEAD_STATUSES, type Business, type Lead, type LeadStatus, type Triage } from '../core/types.js';
import { parseBrazilianPhone, whatsappLink } from '../lib/phone.js';
import type { RateLimiter } from '../lib/rate-limit.js';
import { safeEqual } from '../lib/security.js';
import type { LeadStore } from '../store/store.js';

export interface AppDeps {
  businesses: Business[];
  store: LeadStore;
  /** Limite de pedidos por IP. */
  leadLimiter: RateLimiter;
  /** Token do painel. Sem ele, as rotas do painel respondem 503. */
  adminToken?: string;
  /** Segredo compartilhado com o n8n (assinatura nas duas direções). */
  integrationSecret?: string;
  /** Avisa o n8n de cada pedido novo. */
  notify?: Notifier;
  /** Aceita pedidos vindos de http://localhost (desenvolvimento). */
  allowLocalhost?: boolean;
  serveStatic?: (pathname: string) => Promise<Response | null>;
  now?: () => Date;
  newId?: () => string;
  log?: (line: string) => void;
}

export interface App {
  fetch(request: Request, clientIp?: string): Promise<Response>;
}

type Params = Record<string, string>;
type Ctx = { clientIp: string; params: Params; url: URL; origin: string | null };
type Handler = (request: Request, ctx: Ctx) => Promise<Response> | Response;

const DEDUP_WINDOW_MS = 10 * 60_000;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

/** Rotas do painel usam token no cabeçalho (sem cookie), então podem ser chamadas de qualquer origem. */
const OPEN_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-balcao-key',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...OPEN_CORS, ...headers },
  });

const problem = (status: number, error: string, extra: object = {}, headers?: Record<string, string>) =>
  json({ error, ...extra }, status, headers);

/** Aceita JSON (fetch) e formulário HTML comum (funciona até sem JavaScript). */
async function readInput(request: Request): Promise<{ data: Record<string, unknown>; isForm: boolean } | null> {
  const type = request.headers.get('content-type') ?? '';
  const raw = await request.text();
  if (type.includes('application/x-www-form-urlencoded')) {
    return { data: Object.fromEntries(new URLSearchParams(raw)), isForm: true };
  }
  if (type.includes('application/json')) {
    try {
      const data = JSON.parse(raw) as unknown;
      return typeof data === 'object' && data !== null
        ? { data: data as Record<string, unknown>, isForm: false }
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function createApp(deps: AppDeps): App {
  const { businesses, store, leadLimiter, adminToken, integrationSecret, notify, serveStatic, log = () => {} } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const bySlug = new Map(businesses.map((b) => [b.slug, b]));
  const byKey = new Map(businesses.map((b) => [b.publicKey, b]));

  const serviceName = (lead: Lead) =>
    bySlug.get(lead.business)?.services.find((s) => s.id === lead.serviceId)?.name ?? null;

  const replyText = (lead: Lead) => {
    if (lead.triage?.suggestedReply) return lead.triage.suggestedReply;
    const business = bySlug.get(lead.business);
    const service = serviceName(lead);
    return `Olá, ${lead.name.split(' ')[0]}! Aqui é da ${business?.name ?? 'equipe'}. Recebemos seu pedido${
      service ? ` de ${service.toLowerCase()}` : ''
    } pelo site. Podemos conversar agora?`;
  };

  /** O pedido como o painel precisa ver: com nome do serviço, se está parado e o link de resposta. */
  const view = (lead: Lead) => {
    const { fingerprint: _, ...rest } = lead;
    return {
      ...rest,
      businessName: bySlug.get(lead.business)?.name ?? lead.business,
      serviceName: serviceName(lead),
      stale: isStale(lead, bySlug.get(lead.business), now()),
      replyLink: whatsappLink(lead.phone, replyText(lead)),
    };
  };

  const isAllowedOrigin = (business: Business, origin: string) =>
    business.allowedOrigins.includes(origin) ||
    (deps.allowLocalhost === true && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

  /* ---------- Rotas públicas ---------- */

  const createLead: Handler = async (request, { clientIp, origin }) => {
    const retryAfter = leadLimiter.hit(clientIp);
    if (retryAfter > 0) {
      return problem(
        429,
        'Muitos pedidos seguidos. Tente de novo em instantes.',
        {},
        { 'retry-after': String(retryAfter) },
      );
    }

    const input = await readInput(request);
    if (!input) return problem(415, 'Envie JSON ou um formulário HTML (application/x-www-form-urlencoded).');

    const key = request.headers.get('x-balcao-key') ?? String(input.data._key ?? '');
    const business = byKey.get(key);
    if (!business) return problem(401, 'Chave do negócio inválida. Confira o campo _key do formulário.');
    if (origin && !isAllowedOrigin(business, origin)) {
      return problem(403, 'Este site não está autorizado a enviar pedidos para este negócio.');
    }
    const cors = origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};

    const source = String(input.data.source ?? request.headers.get('referer') ?? '');
    const result = buildLead({ ...input.data, source }, business, now(), newId());
    if (!result.ok) {
      if (input.isForm) return formResult(input.data, business, false, result.errors);
      return problem(422, 'Confira os campos destacados.', { fields: result.errors }, cors);
    }

    // O mesmo pedido enviado de novo (clique duplo, reenvio do navegador) não vira um segundo registro.
    const since = new Date(now().getTime() - DEDUP_WINDOW_MS).toISOString();
    const duplicate = store.findByFingerprint(business.slug, result.lead.fingerprint, since);
    if (duplicate) {
      if (input.isForm) return formResult(input.data, business, true);
      return json({ id: duplicate.id, duplicate: true, message: 'Já recebemos este pedido.' }, 200, cors);
    }

    const lead = result.lead;
    store.insert(lead);
    await notifyOwner(lead, business);

    if (input.isForm) return formResult(input.data, business, true);
    return json(
      { id: lead.id, message: `Pedido enviado! A ${business.name} responde em até ${business.responseHours} horas.` },
      201,
      cors,
    );
  };

  /** Formulário HTML puro: devolve o visitante para a página de obrigado do próprio site. */
  function formResult(data: Record<string, unknown>, business: Business, ok: boolean, errors?: Record<string, string>) {
    const next = String(data._next ?? '');
    const safeNext = business.allowedOrigins.some((o) => next.startsWith(`${o}/`)) ? next : '';
    if (ok && safeNext) return new Response(null, { status: 303, headers: { location: safeNext } });

    const message = ok
      ? `Pedido enviado! A ${business.name} responde em até ${business.responseHours} horas.`
      : `Não deu para enviar: ${Object.values(errors ?? {}).join(' ')} Volte e corrija, por favor.`;
    const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${
      ok ? 'Pedido enviado' : 'Confira o formulário'
    }</title><body style="font:18px/1.5 system-ui;max-width:32rem;margin:15vh auto;padding:0 16px"><p>${escapeHtml(message)}</p><p><a href="javascript:history.back()">Voltar</a></p></body>`;
    return new Response(body, {
      status: ok ? 200 : 422,
      headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
    });
  }

  async function notifyOwner(lead: Lead, business: Business) {
    if (!notify || lead.suspicious) return;
    const { publicKey: _, allowedOrigins: __, services: ___, ...publicBusiness } = business;
    const event: LeadEvent = {
      event: 'lead.created',
      lead,
      business: { ...publicBusiness, serviceName: serviceName(lead) },
      replyLink: whatsappLink(lead.phone, replyText(lead)),
    };
    try {
      await notify(event);
      store.update(lead.id, { notifiedAt: now().toISOString() });
    } catch (error) {
      // O pedido já está salvo; o painel mostra que o aviso ficou pendente.
      log(`aviso do pedido ${lead.id} falhou: ${(error as Error).message}`);
    }
  }

  const publicBusiness: Handler = (_request, { params }) => {
    const business = bySlug.get(params.slug ?? '');
    if (!business) return problem(404, 'Negócio não encontrado.');
    return json({
      slug: business.slug,
      name: business.name,
      segment: business.segment,
      responseHours: business.responseHours,
      services: business.services.map(({ id, name }) => ({ id, name })),
    });
  };

  /* ---------- Painel (token) ---------- */

  const requireAdmin =
    (handler: Handler): Handler =>
    (request, ctx) => {
      if (!adminToken) return problem(503, 'Painel desligado: defina BALCAO_ADMIN_TOKEN.');
      const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token || !safeEqual(token, adminToken)) {
        return problem(401, 'Token do painel inválido.', {}, { 'www-authenticate': 'Bearer' });
      }
      return handler(request, ctx);
    };

  const listLeads: Handler = (_request, { url }) => {
    const business = url.searchParams.get('business') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    if (business && !bySlug.has(business)) return problem(404, 'Negócio não encontrado.');
    if (status && !LEAD_STATUSES.includes(status as LeadStatus)) {
      return problem(400, `Status inválido. Use: ${LEAD_STATUSES.join(', ')}.`);
    }
    const rawPhone = url.searchParams.get('phone');
    const phone = rawPhone ? parseBrazilianPhone(rawPhone)?.e164 : undefined;
    if (rawPhone && !phone) return problem(400, 'Telefone inválido.');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);
    let leads = store
      .list({
        ...(business && { business }),
        ...(status && { status: status as LeadStatus }),
        ...(phone && { phone }),
        limit,
      })
      .map(view);
    if (url.searchParams.get('stale') === '1') leads = leads.filter((l) => l.stale);
    return json({ data: leads, total: leads.length });
  };

  const getLead: Handler = (_request, { params }) => {
    const lead = store.get(params.id ?? '');
    return lead ? json(view(lead)) : problem(404, 'Pedido não encontrado.');
  };

  const updateLead: Handler = async (request, { params }) => {
    const lead = store.get(params.id ?? '');
    if (!lead) return problem(404, 'Pedido não encontrado.');
    const input = await readInput(request);
    const status = input?.data.status;
    if (!LEAD_STATUSES.includes(status as LeadStatus)) {
      return problem(422, `Status inválido. Use: ${LEAD_STATUSES.join(', ')}.`);
    }
    const time = now().toISOString();
    const updated = store.update(lead.id, {
      status: status as LeadStatus,
      updatedAt: time,
      // A primeira vez que o pedido sai de "novo" conta como a primeira resposta.
      ...(lead.firstResponseAt === null && status !== 'novo' && { firstResponseAt: time }),
    });
    return json(view(updated as Lead));
  };

  const stats: Handler = (_request, { url }) => {
    const business = url.searchParams.get('business') ?? undefined;
    if (business && !bySlug.has(business)) return problem(404, 'Negócio não encontrado.');
    const leads = store.list({ ...(business && { business }), limit: 100_000 });
    return json(computeStats(leads, business ? [bySlug.get(business) as Business] : businesses, now()));
  };

  const listBusinesses: Handler = () =>
    json({
      data: businesses.map((b) => ({
        slug: b.slug,
        name: b.name,
        segment: b.segment,
        responseHours: b.responseHours,
        services: b.services.map(({ id, name }) => ({ id, name })),
      })),
    });

  /* ---------- n8n → API ---------- */

  const saveTriage: Handler = async (request, { params }) => {
    if (!integrationSecret) return problem(503, 'Integração desligada: defina BALCAO_N8N_SECRET.');
    const body = await request.text();
    const authentic = await verifySignature(
      integrationSecret,
      body,
      request.headers.get('x-balcao-timestamp'),
      request.headers.get('x-balcao-signature'),
      Math.floor(now().getTime() / 1000),
    );
    if (!authentic) return problem(401, 'Assinatura inválida.');

    const lead = store.get(params.id ?? '');
    if (!lead) return problem(404, 'Pedido não encontrado.');

    let input: Partial<Triage>;
    try {
      input = JSON.parse(body) as Partial<Triage>;
    } catch {
      return problem(400, 'JSON inválido.');
    }
    const priority = ['alta', 'média', 'baixa'].includes(input.priority ?? '') ? input.priority : 'média';
    const triage: Triage = {
      summary: String(input.summary ?? '').slice(0, 280),
      priority: priority as Triage['priority'],
      suggestedReply: String(input.suggestedReply ?? '').slice(0, 600),
      ...(input.reason && { reason: String(input.reason).slice(0, 280) }),
    };
    return json(view(store.update(lead.id, { triage }) as Lead));
  };

  const routes: [string, string, Handler][] = [
    ['GET', '/health', () => json({ ok: true })],
    ['POST', '/v1/leads', createLead],
    ['GET', '/v1/businesses/:slug', publicBusiness],
    ['GET', '/v1/businesses', requireAdmin(listBusinesses)],
    ['GET', '/v1/leads', requireAdmin(listLeads)],
    ['GET', '/v1/leads/:id', requireAdmin(getLead)],
    ['PATCH', '/v1/leads/:id', requireAdmin(updateLead)],
    ['GET', '/v1/stats', requireAdmin(stats)],
    ['POST', '/v1/leads/:id/triage', saveTriage],
  ];

  function match(method: string, pathname: string): { handler: Handler; params: Params } | 'wrong-method' | null {
    const parts = pathname.replace(/\/+$/, '').split('/');
    let pathExists = false;
    for (const [routeMethod, path, handler] of routes) {
      const pattern = path.split('/');
      if (pattern.length !== parts.length) continue;
      const params: Params = {};
      const ok = pattern.every((segment, i) => {
        const part = parts[i] ?? '';
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(part);
          return part !== '';
        }
        return segment === part;
      });
      if (!ok) continue;
      if (routeMethod === method) return { handler, params };
      pathExists = true;
    }
    return pathExists ? 'wrong-method' : null;
  }

  async function route(request: Request, url: URL, clientIp: string): Promise<Response> {
    const origin = request.headers.get('origin');

    if (request.method === 'OPTIONS') {
      // Pré-requisição do navegador: libera o site do negócio para o POST /v1/leads.
      const headers: Record<string, string> = { ...OPEN_CORS };
      if (url.pathname.startsWith('/v1/leads') && origin) headers['access-control-allow-origin'] = origin;
      return new Response(null, { status: 204, headers });
    }

    const found = match(request.method, url.pathname);
    if (found === 'wrong-method') return problem(405, 'Método não permitido nesta rota.');
    if (found) return found.handler(request, { clientIp, params: found.params, url, origin });

    if (request.method === 'GET' && serveStatic) {
      const file = await serveStatic(url.pathname);
      if (file) return file;
    }
    return problem(404, 'Rota não encontrada.');
  }

  return {
    async fetch(request, clientIp = 'unknown') {
      const started = performance.now();
      const url = new URL(request.url);
      let response: Response;
      try {
        response = await route(request, url, clientIp);
      } catch (error) {
        log(`erro em ${url.pathname}: ${(error as Error).message}`);
        response = problem(500, 'Erro interno.');
      }
      // Só rota, status e tempo: nada de nome, telefone ou mensagem no log.
      log(`${request.method} ${url.pathname} ${response.status} ${Math.round(performance.now() - started)}ms`);
      return response;
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
