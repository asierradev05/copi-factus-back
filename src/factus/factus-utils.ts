import { DocumentType, PaymentMethod, ResolutionType } from '@prisma/client';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function parseFactusDate(value?: string | null): Date | null {
  if (!value) return null;
  const m =
    /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i.exec(
      value.trim(),
    );
  if (m) {
    let hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    const isPm = m[7].toUpperCase() === 'PM';
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second) + 5 * 3600000);
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function generateReferenceCode(invoiceId: string): string {
  const hex = invoiceId.replace(/-/g, '').toUpperCase();
  return `REF${hex.slice(0, 12)}`;
}

const PRIMES = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 61, 67, 71];

export function calculateDianDv(nit: string): string {
  const clean = String(nit).replace(/\D/g, '');
  if (!clean) return '0';
  const digits = clean.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += digits[digits.length - 1 - i] * PRIMES[i % PRIMES.length];
  }
  const mod = sum % 11;
  let dv = 11 - mod;
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 1;
  return String(dv);
}

export function mapDocumentTypeToDian(type: DocumentType): string {
  switch (type) {
    case 'CC':
      return '13';
    case 'NIT':
      return '31';
    case 'CE':
      return '22';
    case 'PASAPORTE':
      return '41';
    default:
      return '42';
  }
}

export function mapResolutionTypeToDian(type: ResolutionType): string {
  switch (type) {
    case 'FACTURA':
      return '21';
    case 'NOTA_CREDITO':
      return '22';
    default:
      return '24';
  }
}

export function mapPaymentMethodToDian(method: PaymentMethod): string {
  switch (method) {
    case 'EFECTIVO':
      return '10';
    case 'TRANSFERENCIA':
      return '47';
    case 'TARJETA':
      return '48';
    default:
      return 'ZZZ';
  }
}

export function extractRangeId(result: unknown): number | null {
  const r = result as { id?: number; data?: { id?: number } };
  const id = r?.id ?? r?.data?.id;
  return typeof id === 'number' ? id : null;
}
