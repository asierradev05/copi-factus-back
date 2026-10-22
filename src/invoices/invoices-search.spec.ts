import { Prisma } from '@prisma/client';
import { InvoicesService } from './invoices.service';

type InvoiceFindManyArgs = {
  where: Prisma.InvoiceWhereInput;
} & Record<string, unknown>;

describe('InvoicesService.findAll - búsqueda global', () => {
  let invoiceFindMany: jest.Mock<Promise<unknown[]>, [InvoiceFindManyArgs]>;
  let invoiceCount: jest.Mock<Promise<number>, [InvoiceFindManyArgs]>;
  let service: InvoicesService;

  beforeEach(() => {
    invoiceFindMany = jest.fn<Promise<unknown[]>, [InvoiceFindManyArgs]>();
    invoiceCount = jest.fn<Promise<number>, [InvoiceFindManyArgs]>();
    invoiceFindMany.mockResolvedValue([]);
    invoiceCount.mockResolvedValue(0);

    const prisma = {
      invoice: { findMany: invoiceFindMany, count: invoiceCount },
    };
    service = new InvoicesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('busca facturas por la descripción o el producto de sus ítems', async () => {
    await service.findAll({ search: '  libros  ', limit: 5 });

    const args = invoiceFindMany.mock.calls[0][0];
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        {
          items: {
            some: {
              OR: [
                {
                  description: {
                    contains: 'libros',
                    mode: 'insensitive',
                  },
                },
                {
                  product: {
                    name: { contains: 'libros', mode: 'insensitive' },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
  });

  it('ignora búsquedas vacías', async () => {
    await service.findAll({ search: '   ', limit: 5 });

    const args = invoiceFindMany.mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
  });
});
