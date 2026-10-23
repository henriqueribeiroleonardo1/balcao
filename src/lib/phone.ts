/** DDDs válidos no Brasil (Anatel). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export interface Phone {
  /** Formato E.164, ex.: +5561991234567 */
  e164: string;
  /** Formato de leitura, ex.: (61) 99123-4567 */
  display: string;
  mobile: boolean;
}

/**
 * Normaliza um telefone brasileiro digitado de qualquer jeito:
 * "61 99123-4567", "(061) 9 9123 4567", "+55 61 991234567"...
 */
export function parseBrazilianPhone(input: string): Phone | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length >= 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;

  const ddd = Number(digits.slice(0, 2));
  const number = digits.slice(2);
  if (!DDDS.has(ddd)) return null;

  const mobile = number.length === 9;
  if (mobile && !number.startsWith('9')) return null;
  if (!mobile && !/^[2-5]/.test(number)) return null;
  if (/^(\d)\1+$/.test(number)) return null;

  const split = mobile ? 5 : 4;
  return {
    e164: `+55${digits}`,
    display: `(${ddd}) ${number.slice(0, split)}-${number.slice(split)}`,
    mobile,
  };
}

/** Link "clique para conversar" do WhatsApp, já com a primeira mensagem escrita. */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
