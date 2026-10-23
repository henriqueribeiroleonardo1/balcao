import { parseBrazilianPhone } from '../lib/phone.js';
import { classify, normalize } from './classify.js';
import type { Business, Lead } from './types.js';

export type LeadInput = Record<string, unknown>;
export type LeadValidation = { ok: true; lead: Lead } | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Hash curto e estável (FNV-1a) para reconhecer o mesmo pedido enviado duas vezes. */
export function fingerprint(phone: string, message: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${phone}|${normalize(message)}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Valida o pedido que chegou do formulário e já devolve o registro classificado.
 * Os erros vêm por campo e em português, prontos para aparecer no formulário.
 */
export function buildLead(
  input: LeadInput,
  business: Business,
  now: Date,
  id: string = crypto.randomUUID(),
): LeadValidation {
  const errors: Record<string, string> = {};

  const name = text(input.name);
  const rawPhone = text(input.phone);
  const email = text(input.email).toLowerCase();
  const message = text(input.message);
  const chosenService = text(input.service);
  const source = text(input.source).slice(0, 200);

  if (name.length < 2 || name.length > 80) errors.name = 'Diga seu nome (2 a 80 caracteres).';
  const phone = parseBrazilianPhone(rawPhone);
  if (!phone) errors.phone = 'Informe um telefone com DDD, ex.: (61) 99123-4567.';
  if (email && (!EMAIL.test(email) || email.length > 120)) errors.email = 'Este e-mail não parece válido.';
  if (message.length < 10 || message.length > 1500) errors.message = 'Descreva o que precisa (10 a 1.500 caracteres).';
  if (chosenService && !business.services.some((s) => s.id === chosenService)) errors.service = 'Serviço inválido.';
  // Campo escondido: pessoas não veem, robôs preenchem.
  if (text(input.website)) errors.website = 'Não foi possível enviar.';

  if (!phone || Object.keys(errors).length > 0) return { ok: false, errors };

  const classification = classify(message, business.services, chosenService);
  const createdAt = now.toISOString();

  return {
    ok: true,
    lead: {
      id,
      business: business.slug,
      createdAt,
      name,
      phone: phone.e164,
      phoneDisplay: phone.display,
      email,
      message,
      serviceId: classification.serviceId,
      urgency: classification.urgency,
      bigOrder: classification.bigOrder,
      mismatch: classification.mismatch,
      suspicious: classification.suspicious,
      signals: classification.signals,
      source,
      status: 'novo',
      firstResponseAt: null,
      updatedAt: createdAt,
      notifiedAt: null,
      triage: null,
      fingerprint: fingerprint(phone.e164, message),
    },
  };
}

/** Pedido novo há mais tempo do que o negócio prometeu responder. */
export function isStale(lead: Lead, business: Business | undefined, now: Date): boolean {
  if (lead.status !== 'novo' || lead.suspicious) return false;
  const hours = business?.responseHours ?? 48;
  return now.getTime() - Date.parse(lead.createdAt) > hours * 3_600_000;
}
