import type { Lead, LeadStatus } from '../core/types.js';

export interface LeadQuery {
  business?: string;
  status?: LeadStatus;
  /** Telefone em E.164: o histórico de um cliente. */
  phone?: string;
  /** Só pedidos criados antes deste instante (ISO). */
  createdBefore?: string;
  limit?: number;
}

/** Onde os pedidos ficam guardados. SQLite no servidor, memória no navegador e nos testes. */
export interface LeadStore {
  insert(lead: Lead): void;
  get(id: string): Lead | undefined;
  findByFingerprint(business: string, fingerprint: string, since: string): Lead | undefined;
  /** Mais recentes primeiro. */
  list(query?: LeadQuery): Lead[];
  update(id: string, patch: Partial<Omit<Lead, 'id' | 'business' | 'createdAt'>>): Lead | undefined;
}

const matches = (lead: Lead, query: LeadQuery) =>
  (!query.business || lead.business === query.business) &&
  (!query.status || lead.status === query.status) &&
  (!query.phone || lead.phone === query.phone) &&
  (!query.createdBefore || lead.createdAt < query.createdBefore);

export function createMemoryStore(seed: Lead[] = []): LeadStore {
  const leads = new Map(seed.map((lead) => [lead.id, structuredClone(lead)]));

  return {
    insert(lead) {
      leads.set(lead.id, structuredClone(lead));
    },
    get(id) {
      const lead = leads.get(id);
      return lead && structuredClone(lead);
    },
    findByFingerprint(business, fingerprint, since) {
      return [...leads.values()].find(
        (l) => l.business === business && l.fingerprint === fingerprint && l.createdAt >= since,
      );
    },
    list(query = {}) {
      return [...leads.values()]
        .filter((lead) => matches(lead, query))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 500)
        .map((lead) => structuredClone(lead));
    },
    update(id, patch) {
      const lead = leads.get(id);
      if (!lead) return undefined;
      Object.assign(lead, patch);
      return structuredClone(lead);
    },
  };
}
