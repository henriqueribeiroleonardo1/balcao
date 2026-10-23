import { hmacSha256Hex, safeEqual } from '../lib/security.js';
import type { Business, Lead } from './types.js';

/** Assinaturas valem por 5 minutos: uma requisição gravada não pode ser reenviada depois. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export async function sign(secret: string, body: string, timestamp: number): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Confere a assinatura de uma chamada que o n8n fez para a API. */
export async function verifySignature(
  secret: string,
  body: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowSeconds: number,
): Promise<boolean> {
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || !signatureHeader) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return safeEqual(signatureHeader, await sign(secret, body, timestamp));
}

export interface LeadEvent {
  event: 'lead.created';
  lead: Lead;
  business: Pick<Business, 'slug' | 'name' | 'segment' | 'responseHours' | 'notify'> & {
    serviceName: string | null;
  };
  /** Link de WhatsApp para o dono responder com um toque. */
  replyLink: string;
}

export type Notifier = (event: LeadEvent) => Promise<void>;

export interface N8nOptions {
  webhookUrl: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/** Entrega o evento ao webhook do n8n, assinado e com tempo limite. */
export function createN8nNotifier({
  webhookUrl,
  secret,
  fetch = globalThis.fetch,
  now = Date.now,
}: N8nOptions): Notifier {
  return async (event) => {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(now() / 1000);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-balcao-timestamp': String(timestamp),
        'x-balcao-signature': await sign(secret, body, timestamp),
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`n8n respondeu ${response.status}`);
  };
}
