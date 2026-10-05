import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { PrismaModule } from '../database/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  FilterProductDto,
  UpdateProductDto,
} from './dto/product.dto';

/**
 * Cubre el contrato del catalogo de productos: validacion de los codigos UN/CE
 * que viajan al payload DIAN, normalizacion a mayusculas y la posibilidad de
 * localizar y reactivar un producto desactivado.
 */
describe('Products UN/CE contract (integracion)', () => {
  let prisma: PrismaService;
  let productsService: ProductsService;

  let actorId: string;
  const suffix = Date.now().toString();
  const codes: string[] = [];

  const createProduct = async (
    overrides: Partial<CreateProductDto> = {},
  ): Promise<{ id: string }> => {
    const code =
      overrides.code ?? `PRD-${Math.random().toString(36).slice(2, 8)}`;
    codes.push(code);
    return (await productsService.create(
      {
        code,
        name: `[TEST] producto ${code}`,
        unitPrice: 50000,
        taxRate: 19,
        ...overrides,
      },
      actorId,
    )) as { id: string };
  };

  const dtoErrors = (cls: unknown, plain: Record<string, unknown>) =>
    validateSync(plainToInstance(cls as never, plain)).map((e) => e.property);

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
      ],
      providers: [ProductsService],
    }).compile();

    prisma = module.get(PrismaService);
    productsService = module.get(ProductsService);

    const actor = await prisma.profile.create({
      data: {
        email: `test-products-${suffix}@copigrafica.dev`,
        fullName: 'Test Products User',
        role: UserRole.ADMIN,
      },
    });
    actorId = actor.id;
  }, 120000);

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { code: { in: codes } } });
    await prisma.profile.deleteMany({
      where: { email: `test-products-${suffix}@copigrafica.dev` },
    });
    await prisma.$disconnect();
  });

  it('guarda y normaliza a mayusculas la unidad UN/CE del producto', async () => {
    const product = await createProduct({
      code: `UNCE-KGM-${suffix}`,
      // minúscula: la DIAN solo admite el código en mayúsculas.
      unitMeasureCode: 'kgm',
      standardCode: '999',
    });

    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(stored.unitMeasureCode).toBe('KGM');
    expect(stored.standardCode).toBe('999');
  });

  it('acepta las unidades con letras que la tabla UN/CE define', async () => {
    // Una validación solo numérica rechazaría unidades reales como MTK u OTR.
    for (const code of ['MTK', 'OTR', 'KGM', 'MTR', '75', '94']) {
      expect(
        dtoErrors(CreateProductDto, {
          code: 'X',
          name: 'X',
          unitPrice: 1,
          unitMeasureCode: code,
        }),
      ).not.toContain('unitMeasureCode');
    }
  });

  it('rechaza una unidad que no existe en la tabla UN/CE', async () => {
    // `91` tiene forma numerica valida, pero Factus lo rechazo en emision con
    // "el campo codigo unidad de medida es invalido". La validacion por
    // catalogo lo corta antes de llegar a la DIAN.
    expect(
      dtoErrors(CreateProductDto, {
        code: 'X',
        name: 'X',
        unitPrice: 1,
        unitMeasureCode: '91',
      }),
    ).toContain('unitMeasureCode');
    // 620 no es un estándar válido, y los estándar son exactamente 3 dígitos.
    for (const code of ['620x', '12', '9999']) {
      expect(
        dtoErrors(CreateProductDto, {
          code: 'X',
          name: 'X',
          unitPrice: 1,
          standardCode: code,
        }),
      ).toContain('standardCode');
    }
  });

  it('actualiza los codigos UN/CE y el estado activo del producto', async () => {
    const product = await createProduct({ code: `UNCE-UPD-${suffix}` });

    const updated = (await productsService.update(
      product.id,
      {
        unitMeasureCode: 'mtr',
        standardCode: '010',
        isActive: false,
      } as UpdateProductDto,
      actorId,
    )) as {
      unitMeasureCode: string | null;
      standardCode: string | null;
      isActive: boolean;
    };

    expect(updated.unitMeasureCode).toBe('MTR');
    expect(updated.standardCode).toBe('010');
    expect(updated.isActive).toBe(false);
  });

  it('el listado por defecto solo trae activos, pero permite pedir los inactivos', async () => {
    const code = `UNCE-DES-${suffix}`;
    const product = await createProduct({ code });
    await productsService.update(
      product.id,
      { isActive: false } as UpdateProductDto,
      actorId,
    );

    // Sin filtro no debe aparecer: los selectores de factura no ofrecen dados de baja.
    const porDefecto = await productsService.findAll(
      plainToInstance(FilterProductDto, { search: code, limit: 100 }),
    );
    expect(porDefecto.data.map((p) => p.code)).not.toContain(code);

    // Y debe ser alcanzable para poder reactivarlo: `remove` marca `deletedAt`,
    // que sí lo vuelve inalcanzable por la API.
    const inactivos = await productsService.findAll(
      plainToInstance(FilterProductDto, {
        search: code,
        isActive: false,
        limit: 100,
      }),
    );
    expect(inactivos.data.map((p) => p.code)).toContain(code);

    const reactivado = (await productsService.update(
      product.id,
      { isActive: true } as UpdateProductDto,
      actorId,
    )) as { isActive: boolean };
    expect(reactivado.isActive).toBe(true);

    const trasReactivar = await productsService.findAll(
      plainToInstance(FilterProductDto, { search: code, limit: 100 }),
    );
    expect(trasReactivar.data.map((p) => p.code)).toContain(code);
  });

  /**
   * El caso anterior pasa `isActive` como boolean, que es lo que hace la suite
   * contra el servicio. Por HTTP el valor llega como texto: `buildUrl` del
   * frontend hace `searchParams.set(key, String(value))`. Con
   * `enableImplicitConversion: false` en el ValidationPipe global, un string
   * no se convierte solo, asi que `@IsBoolean()` lo rechazaba con 400 y el
   * filtro de la UI nunca llego a funcionar.
   */
  describe('isActive como query string (lo que llega por HTTP)', () => {
    /** Reproduce el ValidationPipe de main.ts. */
    const parseQuery = (query: Record<string, string>) => {
      const instance = plainToInstance(FilterProductDto, query);
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      return { instance, errors };
    };

    it('convierte "true" y "false" a booleanos sin fallar validacion', () => {
      for (const [texto, esperado] of [
        ['true', true],
        ['false', false],
      ] as const) {
        const { instance, errors } = parseQuery({ isActive: texto });
        expect(errors.map((e) => e.property)).toEqual([]);
        // El bug clasico de `@Type(() => Boolean)`: `Boolean('false')` es true.
        expect(instance.isActive).toBe(esperado);
      }
    });

    it('sin isActive el filtro queda indefinido y el servicio decide', () => {
      const { instance, errors } = parseQuery({});
      expect(errors).toEqual([]);
      // Si aqui quedara `false`, el listado por defecto seria el de inactivos.
      expect(instance.isActive).toBeUndefined();
    });

    it('rechaza un valor que no sea booleano en vez de asumirlo', () => {
      const { errors } = parseQuery({ isActive: 'quizá' });
      expect(errors.map((e) => e.property)).toContain('isActive');
    });

    it('el filtro llega efectivamente al servicio desde la query', async () => {
      const code = `UNCE-QRY-${suffix}`;
      const product = await createProduct({ code });
      await productsService.update(
        product.id,
        { isActive: false } as UpdateProductDto,
        actorId,
      );

      const { instance } = parseQuery({ search: code, isActive: 'false' });
      const inactivos = await productsService.findAll(instance);
      expect(inactivos.data.map((p) => p.code)).toContain(code);
    });
  });
});
