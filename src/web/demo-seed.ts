import { buildLead } from '../core/lead.js';
import type { Lead, LeadStatus, Triage } from '../core/types.js';
import { DEMO_BUSINESSES } from '../data/businesses.js';

const HOUR = 3_600_000;

/** Pedidos de exemplo, com datas relativas a agora, para o painel da demonstração não abrir vazio. */
const SAMPLES: {
  business: string;
  hoursAgo: number;
  name: string;
  phone: string;
  message: string;
  status?: LeadStatus;
  respondedAfter?: number;
  /** Decisão do agente do n8n, como se ele já tivesse processado o pedido. */
  triage?: Triage;
}[] = [
  {
    business: 'oficina-pistao',
    hoursAgo: 0.4,
    name: 'Marcos Vinícius',
    phone: '61 99812-3344',
    message:
      'Meu carro não liga desde ontem, acho que é a bateria. Vocês buscam em casa? Preciso urgente pra trabalhar.',
    triage: {
      summary: 'Carro não liga, provável bateria; quer que busquem em casa.',
      priority: 'alta',
      reason: 'Pressa explícita: o cliente depende do carro para trabalhar.',
      suggestedReply:
        'Oi, Marcos! Aqui é da Oficina Pistão. Conseguimos buscar seu carro hoje. Me passa o endereço e o modelo?',
    },
  },
  {
    business: 'oficina-pistao',
    hoursAgo: 2,
    name: 'Eduardo Lima',
    phone: '(61) 99777-0102',
    message: 'Oi, sou eu de novo. Agora o freio está chiando, dá pra trocar as pastilhas?',
    triage: {
      summary: 'Troca de pastilhas de freio; freio chiando.',
      priority: 'alta',
      reason: 'Cliente que volta: fechou uma revisão com a oficina há 5 dias.',
      suggestedReply: 'Oi, Eduardo! Bom te ver de novo. Pode trazer quando quiser, a troca leva cerca de uma hora.',
    },
  },
  {
    business: 'cantina-dona-cida',
    hoursAgo: 14,
    name: 'Patrícia Gomes',
    phone: '(61) 98455-1020',
    message:
      'Quero fazer o aniversário da minha mãe aí no sábado, umas 25 pessoas. Tem espaço reservado e cardápio fechado?',
  },
  {
    business: 'cromo-eletrostatica',
    hoursAgo: 30,
    name: 'Renato Alves',
    phone: '62 99301-7788',
    message: 'Tenho um portão de 4 metros e duas grades de janela pra pintar de preto fosco. Qual o prazo?',
  },
  {
    business: 'cromo-eletrostatica',
    hoursAgo: 52,
    name: 'Metalúrgica Bom Jesus',
    phone: '62 3289-4410',
    message: 'Orçamento para lote mensal de 300 peças em chapa, pintura epóxi cinza. Mando o desenho por e-mail.',
    triage: {
      summary: 'Lote mensal de 300 peças em chapa, pintura epóxi cinza.',
      priority: 'alta',
      reason: 'Pedido grande e recorrente de empresa.',
      suggestedReply:
        'Olá! Aqui é da Cromo. Recebemos seu pedido do lote mensal. Pode mandar o desenho que montamos o orçamento.',
    },
  },
  {
    business: 'oficina-pistao',
    hoursAgo: 26,
    name: 'Juliana Prado',
    phone: '61 99120-4545',
    message: 'Está fazendo barulho ao frear, acho que é a pastilha. Quanto fica a troca no Onix 2019?',
    status: 'em contato',
    respondedAfter: 1.5,
  },
  {
    business: 'cantina-dona-cida',
    hoursAgo: 75,
    name: 'Construtora Horizonte',
    phone: '61 3355-8899',
    message:
      'Precisamos de 40 marmitas por dia para os funcionários da obra, de segunda a sexta. Fazem contrato semanal?',
    status: 'fechado',
    respondedAfter: 2,
  },
  {
    business: 'oficina-pistao',
    hoursAgo: 120,
    name: 'Eduardo Lima',
    phone: '61 99777-0102',
    message: 'Revisão dos 40 mil km com troca de óleo e filtro. Vocês têm horário quinta?',
    status: 'fechado',
    respondedAfter: 0.8,
  },
  {
    business: 'cromo-eletrostatica',
    hoursAgo: 160,
    name: 'Sandra Moura',
    phone: '62 99654-2211',
    message: 'Queria pintar quatro cadeiras e uma mesa de ferro da varanda.',
    status: 'perdido',
    respondedAfter: 20,
  },
  {
    business: 'oficina-pistao',
    hoursAgo: 8,
    name: 'Marketing Digital Pro',
    phone: '11 99999-1234',
    message: 'Aumente suas vendas com SEO e backlink! Acesse https://exemplo.com e www.exemplo.net agora',
  },
];

export function demoLeads(now: Date): Lead[] {
  return SAMPLES.flatMap((sample, i) => {
    const business = DEMO_BUSINESSES.find((b) => b.slug === sample.business);
    if (!business) return [];
    const created = new Date(now.getTime() - sample.hoursAgo * HOUR);
    const result = buildLead(sample, business, created, `demo-${i + 1}`);
    if (!result.ok) return [];
    const lead = result.lead;
    if (sample.status) {
      lead.status = sample.status;
      lead.firstResponseAt = new Date(created.getTime() + (sample.respondedAfter ?? 1) * HOUR).toISOString();
      lead.updatedAt = lead.firstResponseAt;
    }
    lead.notifiedAt = lead.suspicious ? null : created.toISOString();
    if (sample.triage) lead.triage = sample.triage;
    return [lead];
  });
}
