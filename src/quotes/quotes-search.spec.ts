import { Prisma } from '@prisma/client';
import { QuotesService } from './quotes.service';

type QuoteFindManyArgs = {
  where: Prisma.QuoteWhereInput;
} & Record<string, unknown>;

describe('QuotesService.findAll - búsqueda global', () => {
  const itemQuote = {
    id: 'q-item',
    quoteNumber: 'COT-000001',
    customer: { name: 'Cliente Uno', documentNumber: '900123' },
    items: [{ description: 'Libros Carta' }],
  };

  let queryRaw: jest.Mock<Promise<Array<{ id: string }>>, [unknown]>;
  let quoteFindMany: jest.Mock<Promise<unknown[]>, [QuoteFindManyArgs]>;
  let quoteCount: jest.Mock<Promise<number>, [QuoteFindManyArgs]>;
  let service: QuotesService;

  beforeEach(() => {
    queryRaw = jest.fn<Promise<Array<{ id: string }>>, [unknown]>();
    quoteFindMany = jest.fn<Promise<unknown[]>, [QuoteFindManyArgs]>();
    quoteCount = jest.fn<Promise<number>, [QuoteFindManyArgs]>();

    const prisma = {
      $queryRaw: queryRaw,
      quote: { findMany: quoteFindMany, count: quoteCount },
    };
    service = new QuotesService(prisma as never, {} as never, {} as never);
  });

  it('busca cotizaciones por la descripción de sus ítems en la base de datos', async () => {
    queryRaw.mockResolvedValue([{ id: itemQuote.id }]);
    quoteFindMany.mockResolvedValue([itemQuote]);
    quoteCount.mockResolvedValue(1);

    const result = await service.findAll({ search: '  libros  ', limit: 5 });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const args = quoteFindMany.mock.calls[0][0];
    expect(args.where.OR).toEqual(
      expect.arrayContaining([{ id: { in: [itemQuote.id] } }]),
    );
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { quoteNumber: { contains: 'libros', mode: 'insensitive' } },
      ]),
    );
    expect(result.data).toEqual([itemQuote]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 5,
      totalPages: 1,
    });
  });

  it('no descarta resultados ya paginados (no filtra en memoria después del take)', async () => {
    queryRaw.mockResolvedValue([{ id: itemQuote.id }]);
    quoteFindMany.mockResolvedValue([itemQuote]);
    quoteCount.mockResolvedValue(1);

    const result = await service.findAll({
      search: 'libros',
      page: 1,
      limit: 20,
    });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);
  });

  it('ignora búsquedas vacías y no ejecuta la consulta de ítems', async () => {
    quoteFindMany.mockResolvedValue([]);
    quoteCount.mockResolvedValue(0);

    await service.findAll({ search: '   ', limit: 5 });

    expect(queryRaw).not.toHaveBeenCalled();
    const args = quoteFindMany.mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
  });

  it('mantiene los filtros de cliente y estado junto a la búsqueda', async () => {
    queryRaw.mockResolvedValue([]);
    quoteFindMany.mockResolvedValue([]);
    quoteCount.mockResolvedValue(0);

    await service.findAll({
      search: 'cliente',
      customerId: '11111111-1111-4111-8111-111111111111',
      status: 'PENDIENTE',
      limit: 5,
    });

    const args = quoteFindMany.mock.calls[0][0];
    expect(args.where.customerId).toBe('11111111-1111-4111-8111-111111111111');
    expect(args.where.status).toBe('PENDIENTE');
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { customer: { name: { contains: 'cliente', mode: 'insensitive' } } },
      ]),
    );
  });
});
