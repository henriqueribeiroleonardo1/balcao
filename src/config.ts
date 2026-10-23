import { readFileSync } from 'node:fs';
import type { Business } from './core/types.js';
import { DEMO_BUSINESSES } from './data/businesses.js';

export interface Config {
  port: number;
  databasePath: string;
  businesses: Business[];
  adminToken?: string;
  n8n?: { webhookUrl: string; secret: string };
  allowLocalhost: boolean;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

const SLUG = /^[a-z0-9-]{2,40}$/;

/** Valida a lista de negócios vinda de JSON, com mensagem clara do que está errado. */
export function parseBusinesses(raw: unknown): Business[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigError('A lista de negócios precisa ser um array não vazio.');
  }
  const seen = new Set<string>();

  return raw.map((item, i) => {
    const b = item as Partial<Business>;
    const where = `negócio #${i + 1}`;
    if (!b.slug || !SLUG.test(b.slug)) throw new ConfigError(`${where}: slug inválido (use a-z, 0-9 e hífen).`);
    if (seen.has(b.slug)) throw new ConfigError(`${where}: slug "${b.slug}" repetido.`);
    seen.add(b.slug);
    if (!b.name) throw new ConfigError(`${b.slug}: falta o nome.`);
    if (!b.publicKey || !/^pk_[\w-]{6,}$/.test(b.publicKey)) {
      throw new ConfigError(`${b.slug}: publicKey deve começar com pk_ e ter pelo menos 6 caracteres depois.`);
    }
    if (!Array.isArray(b.allowedOrigins) || b.allowedOrigins.some((o) => !/^https?:\/\/[^/]+$/.test(o))) {
      throw new ConfigError(
        `${b.slug}: allowedOrigins deve listar origens como https://meusite.com.br (sem barra no fim).`,
      );
    }
    if (!Array.isArray(b.services)) throw new ConfigError(`${b.slug}: falta a lista de serviços.`);
    return {
      slug: b.slug,
      name: b.name,
      segment: b.segment ?? '',
      publicKey: b.publicKey,
      allowedOrigins: b.allowedOrigins,
      responseHours: Number(b.responseHours) > 0 ? Number(b.responseHours) : 48,
      services: b.services.map((s) => ({ id: s.id, name: s.name, keywords: s.keywords ?? [] })),
      ...(b.notify && { notify: b.notify }),
    };
  });
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new ConfigError(`PORT inválida: "${value}"`);
  return port;
}

function readN8n(env: Env): Config['n8n'] {
  const webhookUrl = env.BALCAO_N8N_WEBHOOK_URL;
  const secret = env.BALCAO_N8N_SECRET;
  if (!webhookUrl && !secret) return undefined;
  if (!secret || secret.length < 32) throw new ConfigError('BALCAO_N8N_SECRET precisa de pelo menos 32 caracteres.');
  if (!webhookUrl) return { webhookUrl: '', secret };
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    throw new ConfigError(`BALCAO_N8N_WEBHOOK_URL inválida: "${webhookUrl}"`);
  }
  const internal = ['localhost', '127.0.0.1', 'n8n'].includes(url.hostname);
  if (url.protocol !== 'https:' && !internal) throw new ConfigError('BALCAO_N8N_WEBHOOK_URL precisa usar https.');
  return { webhookUrl, secret };
}

export function loadConfig(env: Env = process.env, readFile = (path: string) => readFileSync(path, 'utf8')): Config {
  const adminToken = env.BALCAO_ADMIN_TOKEN;
  if (adminToken !== undefined && adminToken.length < 24) {
    throw new ConfigError('BALCAO_ADMIN_TOKEN precisa de pelo menos 24 caracteres.');
  }

  let businesses = DEMO_BUSINESSES;
  if (env.BALCAO_BUSINESSES) {
    try {
      businesses = parseBusinesses(JSON.parse(readFile(env.BALCAO_BUSINESSES)));
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(`Não consegui ler ${env.BALCAO_BUSINESSES}: ${(error as Error).message}`);
    }
  }

  const n8n = readN8n(env);
  return {
    port: readPort(env.PORT),
    databasePath: env.BALCAO_DATABASE ?? 'data/balcao.db',
    businesses,
    allowLocalhost: env.NODE_ENV !== 'production',
    ...(adminToken && { adminToken }),
    ...(n8n && { n8n }),
  };
}
