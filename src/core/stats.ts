import type { Business, Lead, LeadStatus } from './types.js';
import { isStale } from './lead.js';

export interface Stats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  byService: { serviceId: string | null; name: string; count: number }[];
  /** Fechados ÷ pedidos já decididos (fechados + perdidos). */
  closeRate: number | null;
  /** Mediana, em horas, entre o pedido chegar e alguém responder. */
  medianResponseHours: number | null;
  stale: number;
  suspicious: number;
  /** Pedidos por dia nos últimos 14 dias, do mais antigo para hoje (horário de Brasília). */
  perDay: { day: string; count: number }[];
}

const DAY = 86_400_000;
const BRASILIA = -3 * 3_600_000;
const dayOf = (iso: string) => new Date(Date.parse(iso) + BRASILIA).toISOString().slice(0, 10);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function computeStats(leads: Lead[], businesses: Business[], now: Date): Stats {
  const real = leads.filter((l) => !l.suspicious);
  const bySlug = new Map(businesses.map((b) => [b.slug, b]));
  const serviceName = (lead: Lead) =>
    bySlug.get(lead.business)?.services.find((s) => s.id === lead.serviceId)?.name ?? 'Sem serviço definido';

  const byStatus: Record<LeadStatus, number> = { novo: 0, 'em contato': 0, fechado: 0, perdido: 0 };
  const services = new Map<string, { serviceId: string | null; name: string; count: number }>();
  for (const lead of real) {
    byStatus[lead.status] += 1;
    const key = `${lead.business}:${lead.serviceId}`;
    const entry = services.get(key) ?? { serviceId: lead.serviceId, name: serviceName(lead), count: 0 };
    entry.count += 1;
    services.set(key, entry);
  }

  const decided = byStatus.fechado + byStatus.perdido;
  const responseHours = real
    .filter((l) => l.firstResponseAt)
    .map((l) => (Date.parse(l.firstResponseAt as string) - Date.parse(l.createdAt)) / 3_600_000);

  const today = Date.parse(`${dayOf(now.toISOString())}T00:00:00Z`);
  const perDay = Array.from({ length: 14 }, (_, i) => ({
    day: new Date(today - (13 - i) * DAY).toISOString().slice(0, 10),
    count: 0,
  }));
  const index = new Map(perDay.map((d, i) => [d.day, i]));
  for (const lead of real) {
    const i = index.get(dayOf(lead.createdAt));
    if (i !== undefined) (perDay[i] as { count: number }).count += 1;
  }

  const medianHours = median(responseHours);
  return {
    total: real.length,
    byStatus,
    byService: [...services.values()].sort((a, b) => b.count - a.count),
    closeRate: decided ? byStatus.fechado / decided : null,
    medianResponseHours: medianHours === null ? null : Math.round(medianHours * 10) / 10,
    stale: real.filter((l) => isStale(l, bySlug.get(l.business), now)).length,
    suspicious: leads.length - real.length,
    perDay,
  };
}
