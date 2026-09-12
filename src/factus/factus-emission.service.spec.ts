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
    } as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.VALIDADA);
  });

  it('ENVIADA cuando hay errors de DIAN no bloqueantes', () => {
    const data = {
      is_validated: true,
      errors: [{ message: 'notificación DIAN' }],
      number: 'FAC-1',
      cufe: 'X',
    } as FactusBillData;
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
    } as FactusBillData;
    expect(
      new FactusEmissionService(null as any, null as any).determineDianStatus(
        data,
      ),
    ).toBe(DianStatus.RECHAZADA);
  });
});