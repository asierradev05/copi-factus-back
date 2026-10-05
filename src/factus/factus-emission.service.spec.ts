import { DianStatus } from '@prisma/client';
import { FactusEmissionService } from './factus-emission.service';
import type { FactusBillData } from './factus-types';

describe('FactusEmissionService.determineDianStatus', () => {
  it('VALIDADA cuando is_validated sin errors', () => {
    const data = {
      is_validated: true,
      errors: [],
      number: 'FAC-1',
      cufe: 'X',
    } as unknown as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.VALIDADA);
  });

  it('VALIDADA cuando solo llegan notificaciones informativas de la DIAN', () => {
    const data = {
      is_validated: true,
      errors: [
        'Regla: RUT01, Notificación: La validación del estado del RUT próximamente estará disponible.',
      ],
      number: 'FAC-1',
      cufe: 'X',
    } as unknown as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.VALIDADA);
  });

  it('ENVIADA cuando hay un error real de la DIAN', () => {
    const data = {
      is_validated: true,
      errors: ['Regla: 0301, Error: documento duplicado'],
      number: 'FAC-1',
      cufe: 'X',
    } as unknown as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.ENVIADA);
  });

  it('ENVIADA cuando un error real convive con notificaciones', () => {
    const data = {
      is_validated: true,
      errors: [
        { message: 'Notificación DIAN' },
        'Regla: 0301, Error: documento duplicado',
      ],
      number: 'FAC-1',
      cufe: 'X',
    } as unknown as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.ENVIADA);
  });

  it('RECHAZADA cuando no se validó', () => {
    const data = {
      is_validated: false,
      errors: [],
      number: 'FAC-1',
      cufe: 'X',
    } as unknown as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.RECHAZADA);
  });
});
