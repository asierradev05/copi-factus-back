import { Prisma } from '@prisma/client';

const PAD = 6;

export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  key: string,
  prefix: string,
): Promise<string> {
  await tx.$queryRaw`
    INSERT INTO document_sequences (id, value)
    VALUES (${key}, 0)
    ON CONFLICT (id) DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    SELECT value FROM document_sequences WHERE id = ${key} FOR UPDATE
  `;

  const current = rows[0]?.value ?? 0;
  const next = current + 1;

  await tx.documentSequence.update({
    where: { id: key },
    data: { value: next },
  });

  return `${prefix}-${String(next).padStart(PAD, '0')}`;
}
