import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, normalize } from '../src/core/classify.js';
import { buildLead, fingerprint, isStale } from '../src/core/lead.js';
import { computeStats } from '../src/core/stats.js';
import { DEMO_BUSINESSES } from '../src/data/businesses.js';
import { parseBrazilianPhone, whatsappLink } from '../src/lib/phone.js';
import { demoLeads } from '../src/web/demo-seed.js';

const [OFICINA, CROMO] = DEMO_BUSINESSES as [(typeof DEMO_BUSINESSES)[0], (typeof DEMO_BUSINESSES)[0]];
const NOW = new Date('2026-10-23T15:00:00Z');

describe('telefone brasileiro', () => {
  it('aceita os jeitos comuns de digitar', () => {
    for (const input of ['61 99123-4567', '(061) 9 9123 4567', '+55 61 991234567', '5561991234567']) {
      assert.equal(parseBrazilianPhone(input)?.e164, '+5561991234567', input);
    }
    assert.equal(parseBrazilianPhone('61991234567')?.display, '(61) 99123-4567');
  });

  it('aceita fixo e diferencia de celular', () => {
    const fixo = parseBrazilianPhone('(62) 3289-4410');
    assert.equal(fixo?.mobile, false);
    assert.equal(fixo?.display, '(62) 3289-4410');
  });

  it('recusa DDD inexistente, celular sem 9 e números repetidos', () => {
    assert.equal(parseBrazilianPhone('20 99123-4567'), null);
    assert.equal(parseBrazilianPhone('61 89123-4567'), null);
    assert.equal(parseBrazilianPhone('61 99999-9999'), null);
    assert.equal(parseBrazilianPhone('1234'), null);
  });

  it('monta o link do WhatsApp com a mensagem', () => {
    assert.equal(whatsappLink('+5561991234567', 'Olá, Ana!'), 'https://wa.me/5561991234567?text=Ol%C3%A1%2C%20Ana!');
  });
});

describe('classificação por regras', () => {
  it('normaliza acentos e caixa', () => {
    assert.equal(normalize('  Pintura   ELETROSTÁTICA '), 'pintura eletrostatica');
  });

  it('acha o serviço pelo maior número de palavras', () => {
    assert.equal(classify('Troca de óleo e filtro, revisão dos 40 mil', OFICINA.services).serviceId, 'revisao');
    assert.equal(classify('Barulho ao frear, acho que é a pastilha', OFICINA.services).serviceId, 'freio');
    assert.equal(classify('Quero pintar meu portão e a grade', CROMO.services).serviceId, 'portao');
  });

  it('não confunde pedaço de palavra', () => {
    // "aro" está dentro de "caro", mas não é o serviço de rodas.
    assert.equal(classify('Está muito caro? Quero saber o preço', CROMO.services).serviceId, null);
  });

  it('pressa explícita é urgência alta, com o motivo', () => {
    const result = classify('Meu carro não liga, preciso pra hoje', OFICINA.services);
    assert.equal(result.urgency, 'alta');
    assert.equal(result.serviceId, 'eletrica');
    assert.ok(result.signals.some((s) => s.includes('pressa')));
    assert.equal(classify('Consegue ver amanhã cedo?', OFICINA.services).urgency, 'alta');
  });

  it('reconhece prazo escrito de vários jeitos', () => {
    for (const message of [
      'Revisão completa, entrega em 2 dias úteis',
      'Preciso disso até sexta',
      'Pode ser na próxima semana?',
      'Evento para o dia 15/11',
      'Fica pronto em três dias?',
    ]) {
      assert.equal(classify(message, OFICINA.services).urgency, 'prazo', message);
    }
    assert.equal(classify('Qual o prazo para pintar um portão?', CROMO.services).urgency, 'normal');
  });

  it('cita o trecho como o cliente escreveu, mesmo com emoji antes', () => {
    const result = classify('🙏 Preciso até sexta, por favor', OFICINA.services);
    assert.ok(result.signals.includes('tem prazo ("até sexta")'), result.signals.join(' | '));
  });

  it('marca pedido grande', () => {
    const result = classify('Lote de 300 peças em chapa', CROMO.services);
    assert.equal(result.bigOrder, true);
    assert.ok(result.signals.some((s) => s.includes('"300 peças"')));
    assert.equal(classify('Contrato semanal de marmitas', DEMO_BUSINESSES[2]?.services ?? []).bigOrder, true);
    assert.equal(classify('Pintar 2 cadeiras', CROMO.services).bigOrder, false);
  });

  it('percebe pedido que não combina com o negócio', () => {
    // Caso real da demonstração: revisão de carro mandada para um restaurante, com "Eventos" escolhido.
    const cantina = DEMO_BUSINESSES[2]?.services ?? [];
    const result = classify('10 revisões completas para carros nacionais, entrega em 2 dias úteis', cantina, 'evento');
    assert.equal(result.mismatch, true);
    assert.equal(result.urgency, 'prazo');
    assert.equal(result.bigOrder, true);
    assert.ok(result.signals.some((s) => s.includes('não fala de eventos')));
  });

  it('serviço escolhido que contradiz a mensagem é apontado', () => {
    const result = classify('Barulho ao frear', OFICINA.services, 'revisao');
    assert.equal(result.serviceId, 'revisao');
    assert.equal(result.mismatch, false);
    assert.ok(result.signals.some((s) => s.includes('fala de freios')));
  });

  it('desconfia de propaganda', () => {
    assert.equal(classify('Melhore seu SEO com backlinks baratos', OFICINA.services).suspicious, true);
    assert.equal(classify('Veja https://a.com e https://b.com', OFICINA.services).suspicious, true);
    assert.equal(classify('Meu portão está enferrujado', CROMO.services).suspicious, false);
  });
});

describe('pedido', () => {
  const input = { name: 'Ana Souza', phone: '61 99123-4567', message: 'Quero pintar o portão de casa, 3 metros.' };

  it('valida, normaliza e classifica', () => {
    const result = buildLead(input, CROMO, NOW, 'id-1');
    assert.ok(result.ok);
    assert.equal(result.lead.phone, '+5561991234567');
    assert.equal(result.lead.serviceId, 'portao');
    assert.equal(result.lead.status, 'novo');
    assert.equal(result.lead.createdAt, NOW.toISOString());
  });

  it('serviço escolhido no formulário vence a dedução', () => {
    const result = buildLead({ ...input, service: 'rodas' }, CROMO, NOW);
    assert.ok(result.ok);
    assert.equal(result.lead.serviceId, 'rodas');
  });

  it('devolve todos os erros por campo', () => {
    const result = buildLead({ name: 'A', phone: '123', email: 'x@', message: 'oi', service: 'nada' }, CROMO, NOW);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.deepEqual(Object.keys(result.errors).sort(), ['email', 'message', 'name', 'phone', 'service']);
  });

  it('recusa robô pelo campo escondido', () => {
    assert.equal(buildLead({ ...input, website: 'x' }, CROMO, NOW).ok, false);
  });

  it('a impressão digital ignora acento, caixa e espaços', () => {
    assert.equal(fingerprint('+55', 'Portão  AZUL'), fingerprint('+55', 'portao azul'));
    assert.notEqual(fingerprint('+55', 'portão azul'), fingerprint('+56', 'portão azul'));
  });

  it('fica parado depois do prazo do negócio', () => {
    const result = buildLead(input, OFICINA, new Date(NOW.getTime() - 25 * 3_600_000));
    assert.ok(result.ok);
    assert.equal(isStale(result.lead, OFICINA, NOW), true);
    assert.equal(isStale(result.lead, CROMO, NOW), false);
    assert.equal(isStale({ ...result.lead, status: 'em contato' }, OFICINA, NOW), false);
  });
});

describe('estatísticas', () => {
  const leads = demoLeads(NOW);
  const stats = computeStats(leads, DEMO_BUSINESSES, NOW);

  it('não conta pedidos suspeitos', () => {
    assert.equal(stats.suspicious, 1);
    assert.equal(stats.total, leads.length - 1);
  });

  it('calcula taxa de fechamento e tempo de resposta', () => {
    assert.equal(stats.byStatus.fechado, 2);
    assert.equal(stats.byStatus.perdido, 1);
    assert.equal(stats.closeRate, 2 / 3);
    // Respostas em 1,5h, 2h, 0,8h e 20h: mediana 1,75h.
    assert.equal(stats.medianResponseHours, 1.8);
  });

  it('conta pedidos parados e monta 14 dias', () => {
    assert.equal(stats.stale, 2);
    assert.equal(stats.perDay.length, 14);
    assert.equal(stats.perDay.at(-1)?.day, '2026-10-23');
    assert.equal(
      stats.perDay.reduce((sum, d) => sum + d.count, 0),
      stats.total,
    );
  });

  it('sem pedidos, devolve nulos em vez de dividir por zero', () => {
    const empty = computeStats([], DEMO_BUSINESSES, NOW);
    assert.equal(empty.closeRate, null);
    assert.equal(empty.medianResponseHours, null);
  });
});
