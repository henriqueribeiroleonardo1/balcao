import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, parseBusinesses } from '../src/config.js';

const VALID = [
  {
    slug: 'minha-oficina',
    name: 'Minha Oficina',
    publicKey: 'pk_minhaoficina',
    allowedOrigins: ['https://minhaoficina.com.br'],
    services: [{ id: 'revisao', name: 'Revisão', keywords: ['oleo'] }],
  },
];

describe('configuração', () => {
  it('sem variáveis, sobe com os negócios de demonstração e tudo desligado', () => {
    const config = loadConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.businesses.length, 3);
    assert.equal(config.adminToken, undefined);
    assert.equal(config.n8n, undefined);
  });

  it('lê os negócios de um arquivo JSON', () => {
    const config = loadConfig({ BALCAO_BUSINESSES: 'negocios.json' }, () => JSON.stringify(VALID));
    assert.equal(config.businesses[0]?.responseHours, 48);
    assert.equal(config.businesses[0]?.slug, 'minha-oficina');
  });

  it('explica o erro do arquivo de negócios', () => {
    assert.throws(() => parseBusinesses([]), ConfigError);
    assert.throws(() => parseBusinesses([{ ...VALID[0], slug: 'Com Espaço' }]), /slug inválido/);
    assert.throws(() => parseBusinesses([VALID[0], VALID[0]]), /repetido/);
    assert.throws(() => parseBusinesses([{ ...VALID[0], publicKey: 'abc' }]), /pk_/);
    assert.throws(() => parseBusinesses([{ ...VALID[0], allowedOrigins: ['https://site.com/'] }]), /sem barra/);
    assert.throws(() => loadConfig({ BALCAO_BUSINESSES: 'x.json' }, () => '{quebrado'), /Não consegui ler/);
  });

  it('exige token e segredo fortes e n8n em https', () => {
    assert.throws(() => loadConfig({ BALCAO_ADMIN_TOKEN: 'curto' }), /24/);
    assert.throws(() => loadConfig({ BALCAO_N8N_SECRET: 'curto' }), /32/);
    assert.throws(
      () => loadConfig({ BALCAO_N8N_SECRET: 'x'.repeat(32), BALCAO_N8N_WEBHOOK_URL: 'http://n8n.example/w' }),
      /https/,
    );
    const ok = loadConfig({
      BALCAO_N8N_SECRET: 'x'.repeat(32),
      BALCAO_N8N_WEBHOOK_URL: 'http://n8n:5678/webhook/balcao',
    });
    assert.equal(ok.n8n?.webhookUrl, 'http://n8n:5678/webhook/balcao');
  });
});
