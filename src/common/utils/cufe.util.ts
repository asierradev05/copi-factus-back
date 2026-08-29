import { createHash } from 'crypto';

export function generateCufe(invoiceNumber: string, data: string): string {
  return createHash('sha384')
    .update(`${invoiceNumber}|${data}`)
    .digest('hex')
    .toUpperCase();
}
