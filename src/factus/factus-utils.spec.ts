import {
  generateReferenceCode,
  calculateDianDv,
  mapDocumentTypeToDian,
  mapResolutionTypeToDian,
  mapPaymentMethodToDian,
  round2,
  parseFactusDate,
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

  it('parsea fecha Factus (DD-MM-YYYY hh:mm:ss AM/PM) en hora Colombia', () => {
    const d = parseFactusDate('12-09-2026 12:36:54 PM');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-09-12T17:36:54.000Z');
    const am = parseFactusDate('12-09-2026 01:05:09 AM');
    expect(am!.toISOString()).toBe('2026-09-12T06:05:09.000Z');
    expect(parseFactusDate(null)).toBeNull();
    expect(parseFactusDate('no-valido')).toBeNull();
  });
});
