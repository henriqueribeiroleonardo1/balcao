import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSqliteStore } from '../src/store/sqlite.js';
import { createMemoryStore, type LeadStore } from '../src/store/store.js';
import { demoLeads } from '../src/web/demo-seed.js';

const NOW = new Date('2026-10-23T15:00:00Z');

/** As duas implementações precisam se comportar igual: o mesmo teste roda nas duas. */
const implementations: [string, () => LeadStore][] = [
  ['memória', () => createMemoryStore()],
  ['SQLite', () => createSqliteStore(':memory:')],
];

for (const [name, create] of implementations) {
  describe(`armazenamento em ${name}`, () => {
    const fill = () => {
      const store = create();
      for (const lead of demoLeads(NOW)) store.insert(lead);
      return store;
    };

    it('lista do mais recente para o mais antigo', () => {
      const list = fill().list();
      assert.equal(list.length, 10);
      assert.ok(list.every((lead, i) => i === 0 || (list[i - 1] as typeof lead).createdAt >= lead.createdAt));
    });

    it('filtra por negócio, status e limite', () => {
      const store = fill();
      assert.ok(store.list({ business: 'oficina-pistao' }).every((l) => l.business === 'oficina-pistao'));
      assert.equal(store.list({ status: 'fechado' }).length, 2);
      assert.equal(store.list({ limit: 3 }).length, 3);
      assert.equal(store.list({ phone: '+5561997770102' }).length, 2);
    });

    it('acha duplicado só dentro da janela', () => {
      const store = fill();
      const lead = store.get('demo-1');
      assert.ok(lead);
      assert.equal(store.findByFingerprint(lead.business, lead.fingerprint, '2026-10-23T00:00:00Z')?.id, 'demo-1');
      assert.equal(store.findByFingerprint(lead.business, lead.fingerprint, '2026-10-24T00:00:00Z'), undefined);
    });

    it('atualiza e devolve cópia, não referência', () => {
      const store = fill();
      const updated = store.update('demo-1', { status: 'em contato' });
      assert.equal(updated?.status, 'em contato');
      assert.equal(
        store.list({ status: 'em contato' }).some((l) => l.id === 'demo-1'),
        true,
      );
      const copy = store.get('demo-1');
      if (copy) copy.name = 'alterado';
      assert.notEqual(store.get('demo-1')?.name, 'alterado');
      assert.equal(store.update('nao-existe', { status: 'fechado' }), undefined);
    });
  });
}
