import { DatabaseSync } from 'node:sqlite';
import type { Lead } from '../core/types.js';
import type { LeadQuery, LeadStore } from './store.js';

/**
 * Pedidos guardados em SQLite, com o módulo que já vem no Node 22 (sem dependência).
 * Colunas para o que filtramos; o pedido inteiro fica em JSON.
 */
export function createSqliteStore(path: string): LeadStore {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      business TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS leads_business_created ON leads (business, created_at);
    CREATE INDEX IF NOT EXISTS leads_fingerprint ON leads (business, fingerprint);
  `);

  const insert = db.prepare(
    'INSERT INTO leads (id, business, status, created_at, fingerprint, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const byId = db.prepare('SELECT data FROM leads WHERE id = ?');
  const byFingerprint = db.prepare(
    'SELECT data FROM leads WHERE business = ? AND fingerprint = ? AND created_at >= ? LIMIT 1',
  );
  const save = db.prepare('UPDATE leads SET status = ?, data = ? WHERE id = ?');

  const parse = (row: unknown) => (row ? (JSON.parse((row as { data: string }).data) as Lead) : undefined);

  return {
    insert(lead) {
      insert.run(lead.id, lead.business, lead.status, lead.createdAt, lead.fingerprint, JSON.stringify(lead));
    },
    get(id) {
      return parse(byId.get(id));
    },
    findByFingerprint(business, fingerprint, since) {
      return parse(byFingerprint.get(business, fingerprint, since));
    },
    list(query: LeadQuery = {}) {
      const where: string[] = [];
      const params: string[] = [];
      if (query.business) where.push('business = ?') && params.push(query.business);
      if (query.status) where.push('status = ?') && params.push(query.status);
      if (query.phone) where.push("json_extract(data, '$.phone') = ?") && params.push(query.phone);
      if (query.createdBefore) where.push('created_at < ?') && params.push(query.createdBefore);
      const sql = `SELECT data FROM leads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${Math.min(query.limit ?? 500, 1000)}`;
      return db
        .prepare(sql)
        .all(...params)
        .map((row) => parse(row) as Lead);
    },
    update(id, patch) {
      const lead = parse(byId.get(id));
      if (!lead) return undefined;
      const updated = { ...lead, ...patch };
      save.run(updated.status, JSON.stringify(updated), id);
      return updated;
    },
  };
}
