import { Prisma } from '@prisma/client';

export interface InvoiceNumberResult {
  invoiceNumber: string;
  nextNumber: number;
}

export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  settingsId = 'default',
): Promise<InvoiceNumberResult> {
  const rows = await tx.$queryRaw<
    Array<{ invoice_prefix: string; invoice_next_number: number }>
  >`
    SELECT invoice_prefix, invoice_next_number
    FROM company_settings
    WHERE id = ${settingsId}
    FOR UPDATE
  `;

  const settings = rows[0];
  if (!settings) {
    throw new Error('Configuración de empresa no encontrada');
  }

  const currentNumber = settings.invoice_next_number;
  const invoiceNumber = `${settings.invoice_prefix}-${String(currentNumber).padStart(6, '0')}`;

  await tx.companySettings.update({
    where: { id: settingsId },
    data: { invoiceNextNumber: currentNumber + 1 },
  });

  return { invoiceNumber, nextNumber: currentNumber + 1 };
}
