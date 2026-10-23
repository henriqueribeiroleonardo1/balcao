import type { Service, Urgency } from './types.js';

/** Minúsculas, sem acento e com espaços simples: "Pintura  ELETROSTÁTICA" → "pintura eletrostatica". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pressa explícita ou problema que para o cliente agora. */
const URGENT = [
  'urgente',
  'urgencia',
  'hoje',
  'ainda hoje',
  'amanha',
  'o quanto antes',
  'o mais rapido',
  'pra ontem',
  'para ontem',
  'nao liga',
  'nao pega',
  'quebrou',
  'vazando',
  'socorro',
  'emergencia',
];

const NUMBER_WORDS = 'um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|\\d{1,3}';
const WEEKDAY = '(segunda|terca|quarta|quinta|sexta)(-feira| feira)?|sabado|domingo';

/** Prazo definido: o cliente disse até quando precisa. */
const DEADLINES: RegExp[] = [
  new RegExp(
    `(entrega em|dentro de|no maximo|daqui a|prazo de|em|ate) (${NUMBER_WORDS}) (dias?( uteis)?|horas?|semanas?)`,
  ),
  /(essa|esta|nesta|nessa|proxima) semana|semana que vem|fim de semana|final de semana|fim do mes/,
  new RegExp(`(ate|na|no|nesta|nessa|neste|nesse|proxima|proximo|dia) (${WEEKDAY})`),
  /(ate|dia|para|pro|pra) (o dia )?\d{1,2}(\/\d{1,2})?(?![0-9])/,
];

/** Volume que costuma valer mais para o negócio. */
const BIG_ORDER = new RegExp(
  `\\b(\\d{2,5}) (pecas?|unidades|itens|carros?|veiculos|motos?|pessoas|convidados|marmitas|refeicoes|revisoes|portoes|grades|cadeiras|mesas|rodas|kits?|funcionarios|apartamentos|imoveis|lotes?)\\b`,
);
const BIG_ORDER_WORDS = ['contrato', 'mensal', 'semanal', 'por mes', 'por dia', 'frota', 'lote'];

const SPAM = [
  'seo',
  'backlink',
  'trafego pago garantido',
  'cripto',
  'bitcoin',
  'emprestimo',
  'renda extra',
  'casino',
  'aposta',
];

export interface Classification {
  serviceId: string | null;
  urgency: Urgency;
  bigOrder: boolean;
  /** A mensagem não combina com o serviço escolhido nem com nenhum serviço do negócio. */
  mismatch: boolean;
  suspicious: boolean;
  signals: string[];
}

const termPattern = (term: string) => new RegExp(`(?<![a-z0-9])${term}(?![a-z0-9])`);
const containsTerm = (text: string, term: string) => termPattern(term).test(text);

/**
 * Versão para busca que mantém o mesmo tamanho do original (sem acento, minúscula, espaços viram espaço),
 * para dar para citar o trecho exato que o cliente escreveu.
 */
const searchable = (text: string) =>
  [...text.normalize('NFC')]
    .map((char) => {
      const plain = char
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
      return plain.length === char.length ? plain : char;
    })
    .join('')
    .replace(/\s/g, ' ');

/**
 * Primeira triagem, por regras: rápida, explicável e sem custo.
 * O agente do n8n vem depois e complementa (histórico do cliente, resumo e resposta sugerida).
 */
export function classify(message: string, services: Service[], chosenServiceId = ''): Classification {
  const original = message.normalize('NFC');
  const text = searchable(original);
  const signals: string[] = [];
  /** O trecho que casou, como o cliente escreveu (com acento). */
  const quote = (pattern: RegExp) => {
    const match = pattern.exec(text);
    return match ? original.slice(match.index, match.index + match[0].length) : '';
  };

  // Serviço: o que tiver mais palavras-chave na mensagem.
  let detected: Service | undefined;
  let best = 0;
  for (const service of services) {
    const hits = service.keywords.filter((keyword) => containsTerm(text, normalize(keyword))).length;
    if (hits > best) {
      best = hits;
      detected = service;
    }
  }
  const chosen = services.find((s) => s.id === chosenServiceId);
  const chosenMatches = chosen?.keywords.some((k) => containsTerm(text, normalize(k))) ?? false;

  let mismatch = false;
  if (chosen) {
    signals.push(`cliente escolheu ${chosen.name.toLowerCase()} no formulário`);
    if (!chosenMatches && detected) signals.push(`mas a mensagem fala de ${detected.name.toLowerCase()}`);
    if (!chosenMatches && !detected) {
      mismatch = true;
      signals.push(`a mensagem não fala de ${chosen.name.toLowerCase()} nem de outro serviço do negócio`);
    }
  } else if (detected) {
    signals.push(`fala de ${detected.name.toLowerCase()}`);
  } else if (services.length > 0) {
    mismatch = true;
    signals.push('não fala de nenhum serviço do negócio');
  }

  // Urgência: pressa explícita vence prazo definido.
  const urgentHit = URGENT.find((term) => containsTerm(text, term));
  const deadlinePattern = DEADLINES.find((pattern) => pattern.test(text));
  const urgency: Urgency = urgentHit ? 'alta' : deadlinePattern ? 'prazo' : 'normal';
  if (urgentHit) signals.push(`pede pressa ("${quote(termPattern(urgentHit))}")`);
  else if (deadlinePattern) signals.push(`tem prazo ("${quote(deadlinePattern)}")`);

  // Tamanho do pedido.
  const volume = text.match(BIG_ORDER);
  const bigVolume = volume !== null && Number(volume[1]) >= 10;
  const bigWord = BIG_ORDER_WORDS.find((term) => containsTerm(text, term));
  const bigOrder = bigVolume || bigWord !== undefined;
  if (bigOrder) signals.push(`pedido grande ("${quote(bigVolume ? BIG_ORDER : termPattern(bigWord ?? ''))}")`);

  // Cara de propaganda.
  const links = (message.match(/https?:\/\/|www\./gi) ?? []).length;
  const spamHit = SPAM.find((term) => containsTerm(text, term));
  const letters = message.replace(/[^\p{L}]/gu, '');
  const shouting = letters.length > 20 && letters === letters.toUpperCase();
  if (links >= 2) signals.push('vários links');
  if (spamHit) signals.push(`parece propaganda ("${spamHit}")`);
  if (shouting) signals.push('tudo em maiúsculas');
  const suspicious = links >= 2 || spamHit !== undefined || (shouting && links > 0);

  return {
    serviceId: chosen?.id ?? detected?.id ?? null,
    urgency,
    bigOrder,
    mismatch: mismatch && !suspicious,
    suspicious,
    signals,
  };
}
