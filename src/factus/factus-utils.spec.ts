import {
  generateReferenceCode,
  calculateDianDv,
  mapDocumentTypeToDian,
  mapResolutionTypeToDian,
  mapPaymentMethodToDian,
  round2,
} from './factus-utils';

describe('factus-utils', () => {
  it('genera reference code estable y <= 20 chars', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const a = generateReferenceCode(id);
    const b = generateReferenceCode(id);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(20);
    expect(a).toMatch(/^REF[0-9A-F]+$/);
  });

  it('calcula DV NIT como un solo dígito determinístico', () => {
    const dv = calculateDianDv('900123456');
    expect(String(dv)).toMatch(/^\d$/);
    expect(calculateDianDv('900123456')).toBe(dv);
  });

  it('mapea enums a códigos DIAN', () => {
    expect(mapDocumentTypeToDian('CC' as any)).toBe('13');
    expect(mapDocumentTypeToDian('NIT' as any)).toBe('31');
    expect(mapResolutionTypeToDian('FACTURA' as any)).toBe('21');
    expect(mapResolutionTypeToDian('NOTA_CREDITO' as any)).toBe('22');
    expect(mapPaymentMethodToDian('EFECTIVO' as any)).toBe('10');
    expect(mapPaymentMethodToDian('TRANSFERENCIA' as any)).toBe('47');
  });

  it('redondea a 2 decimales', () => {
    expect(round2(1.999)).toBe(2);
    expect(round2(10.005)).toBe(10.01);
  });
});
