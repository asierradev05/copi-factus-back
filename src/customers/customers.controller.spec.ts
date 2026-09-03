import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { extractRutFromPdf } from '../common/rut/rut-extractor.util';

jest.mock('../common/rut/rut-extractor.util', () => ({
  extractRutFromPdf: jest.fn(),
}));

describe('CustomersController (extract-rut)', () => {
  let controller: CustomersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();
    controller = module.get(CustomersController);
  });

  it('extrae datos del RUT y los retorna', async () => {
    const mockExtracted = {
      name: 'COPIGRAFICA SIERRA S.A.S.',
      documentType: 'NIT',
      documentNumber: '900123456-7',
    };
    (extractRutFromPdf as jest.Mock).mockResolvedValue(mockExtracted);

    const result = await controller.extractRut({
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimetype: 'application/pdf',
      size: 100,
    } as unknown as { buffer: Buffer; mimetype: string; size: number });

    expect(result.extracted).toEqual(mockExtracted);
    expect(extractRutFromPdf).toHaveBeenCalledTimes(1);
  });

  it('rechaza un archivo que no sea PDF', async () => {
    await expect(
      controller.extractRut({
        buffer: Buffer.from('not a pdf'),
        mimetype: 'text/plain',
        size: 9,
      } as unknown as { buffer: Buffer; mimetype: string; size: number }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza un archivo mayor a 5MB', async () => {
    await expect(
      controller.extractRut({
        buffer: Buffer.alloc(6 * 1024 * 1024),
        mimetype: 'application/pdf',
        size: 6 * 1024 * 1024,
      } as unknown as { buffer: Buffer; mimetype: string; size: number }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('rechaza si no hay archivo', async () => {
    await expect(
      controller.extractRut(undefined as unknown as { buffer: Buffer; mimetype: string; size: number }),
    ).rejects.toThrow(BadRequestException);
  });
});
