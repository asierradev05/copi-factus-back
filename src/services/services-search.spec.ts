import { Prisma } from '@prisma/client';
import { ServicesService } from './services.service';

type ServiceFindManyArgs = {
  where: Prisma.ServiceWhereInput;
} & Record<string, unknown>;

describe('ServicesService.findAll - búsqueda global', () => {
  let serviceFindMany: jest.Mock<Promise<unknown[]>, [ServiceFindManyArgs]>;
  let serviceCount: jest.Mock<Promise<number>, [ServiceFindManyArgs]>;
  let service: ServicesService;

  beforeEach(() => {
    serviceFindMany = jest.fn<Promise<unknown[]>, [ServiceFindManyArgs]>();
    serviceCount = jest.fn<Promise<number>, [ServiceFindManyArgs]>();
    serviceFindMany.mockResolvedValue([]);
    serviceCount.mockResolvedValue(0);

    const prisma = {
      service: { findMany: serviceFindMany, count: serviceCount },
    };
    service = new ServicesService(prisma as never, {} as never);
  });

  it('busca servicios por descripción, cliente o documento', async () => {
    await service.findAll({ search: '  libros  ', limit: 5 });

    const args = serviceFindMany.mock.calls[0][0];
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        {
          description: { contains: 'libros', mode: 'insensitive' },
        },
        {
          customer: {
            name: { contains: 'libros', mode: 'insensitive' },
          },
        },
      ]),
    );
  });

  it('ignora búsquedas vacías', async () => {
    await service.findAll({ search: '   ', limit: 5 });

    const args = serviceFindMany.mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
  });
});
