export interface Service {
  id: string;
  name: string;
  /** Palavras que indicam este serviço numa mensagem, sem acento e em minúsculas. */
  keywords: string[];
}

export interface Business {
  slug: string;
  name: string;
  segment: string;
  /** Chave pública que vai no formulário do site. Identifica o negócio, não dá acesso a nada. */
  publicKey: string;
  /** Sites que podem enviar pedidos. */
  allowedOrigins: string[];
  services: Service[];
  /** Depois de quantas horas sem resposta o pedido é considerado parado. */
  responseHours: number;
  /** Para onde o n8n manda os avisos deste negócio. */
  notify?: { telegramChatId?: string; email?: string };
}

export const LEAD_STATUSES = ['novo', 'em contato', 'fechado', 'perdido'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** alta = pressa explícita; prazo = o cliente disse até quando; normal = sem data. */
export type Urgency = 'alta' | 'prazo' | 'normal';

export interface Triage {
  summary: string;
  priority: 'alta' | 'média' | 'baixa';
  suggestedReply: string;
  /** Por que o agente escolheu essa prioridade (ex.: cliente que já fechou antes). */
  reason?: string;
}

export interface Lead {
  id: string;
  business: string;
  createdAt: string;
  name: string;
  phone: string;
  phoneDisplay: string;
  email: string;
  message: string;
  /** Serviço escolhido no formulário ou deduzido da mensagem. */
  serviceId: string | null;
  urgency: Urgency;
  /** Volume grande (10+ unidades, contrato, lote). */
  bigOrder: boolean;
  /** A mensagem não combina com os serviços do negócio: vale conferir. */
  mismatch: boolean;
  suspicious: boolean;
  /** Motivos legíveis da classificação, para o dono entender. */
  signals: string[];
  source: string;
  status: LeadStatus;
  firstResponseAt: string | null;
  updatedAt: string;
  notifiedAt: string | null;
  triage: Triage | null;
  /** Impressão digital de telefone + mensagem, para não duplicar pedidos. */
  fingerprint: string;
}
