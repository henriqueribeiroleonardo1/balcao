import type { Business } from '../core/types.js';

/**
 * Negócios fictícios usados na demonstração e nos testes.
 * Em produção, a lista vem de um arquivo JSON (variável BALCAO_BUSINESSES).
 */
export const DEMO_BUSINESSES: Business[] = [
  {
    slug: 'oficina-pistao',
    name: 'Oficina Pistão',
    segment: 'Oficina mecânica',
    publicKey: 'pk_demo_pistao',
    allowedOrigins: ['https://oficinapistao.com.br'],
    responseHours: 24,
    services: [
      { id: 'revisao', name: 'Revisão', keywords: ['revisao', 'oleo', 'filtro', 'troca de oleo', 'km'] },
      { id: 'freio', name: 'Freios', keywords: ['freio', 'freios', 'pastilha', 'disco', 'barulho ao frear'] },
      { id: 'suspensao', name: 'Suspensão', keywords: ['suspensao', 'amortecedor', 'barulho', 'buraco', 'mola'] },
      { id: 'eletrica', name: 'Elétrica', keywords: ['bateria', 'nao liga', 'eletrica', 'farol', 'alternador'] },
    ],
  },
  {
    slug: 'cromo-eletrostatica',
    name: 'Cromo Pintura Eletrostática',
    segment: 'Pintura industrial',
    publicKey: 'pk_demo_cromo',
    allowedOrigins: ['https://cromopintura.com.br'],
    responseHours: 48,
    services: [
      { id: 'portao', name: 'Portões e grades', keywords: ['portao', 'portoes', 'grade', 'grades', 'gradil', 'corrimao'] },
      { id: 'moveis', name: 'Móveis de aço', keywords: ['movel', 'moveis', 'mesa', 'cadeira', 'estante', 'armario'] },
      { id: 'industrial', name: 'Peças industriais', keywords: ['peca', 'pecas', 'lote', 'industrial', 'chapa', 'perfil'] },
      { id: 'rodas', name: 'Rodas', keywords: ['roda', 'rodas', 'aro'] },
    ],
  },
  {
    slug: 'cantina-dona-cida',
    name: 'Cantina Dona Cida',
    segment: 'Restaurante e eventos',
    publicKey: 'pk_demo_cida',
    allowedOrigins: ['https://cantinadonacida.com.br'],
    responseHours: 12,
    services: [
      { id: 'evento', name: 'Eventos', keywords: ['aniversario', 'festa', 'evento', 'casamento', 'confraternizacao'] },
      { id: 'marmita', name: 'Marmitas para empresas', keywords: ['marmita', 'marmitas', 'empresa', 'funcionarios', 'semanal'] },
      { id: 'reserva', name: 'Reserva de mesa', keywords: ['reserva', 'mesa', 'pessoas', 'sabado', 'domingo'] },
    ],
  },
];
