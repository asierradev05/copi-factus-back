import { resolveNoteRangeId, assertResolutionMatchesConfig } from './note-range.config';
import { InvoiceKind } from '@prisma/client';

describe('resolveNoteRangeId', () => {
  it('usa FACTUS_NC_RANGE_ID para notas credito', () => {
    expect(
      resolveNoteRangeId(InvoiceKind.NOTA_CREDITO, {
        FACTUS_NC_RANGE_ID: '510',
      }),
    ).toBe(510);
  });

  it('usa FACTUS_ND_RANGE_ID para notas debito', () => {
    expect(
      resolveNoteRangeId(InvoiceKind.NOTA_DEBITO, { FACTUS_ND_RANGE_ID: '511' }),
    ).toBe(511);
  });

  it('falla en vez de asumir un rango por defecto cuando falta la variable', () => {
    expect(() => resolveNoteRangeId(InvoiceKind.NOTA_CREDITO, {})).toThrow(
      /Falta la variable FACTUS_NC_RANGE_ID/,
    );
  });

  it('no acepta un rango no numerico', () => {
    expect(() =>
      resolveNoteRangeId(InvoiceKind.NOTA_DEBITO, { FACTUS_ND_RANGE_ID: 'abc' }),
    ).toThrow(/no es numerica/);
  });

  it('no acepta un rango vacio o cero', () => {
    expect(() =>
      resolveNoteRangeId(InvoiceKind.NOTA_DEBITO, { FACTUS_ND_RANGE_ID: '  ' }),
    ).toThrow(/Falta la variable/);
    expect(() =>
      resolveNoteRangeId(InvoiceKind.NOTA_DEBITO, { FACTUS_ND_RANGE_ID: '0' }),
    ).toThrow(/positivo/);
  });
});

describe('assertResolutionMatchesConfig', () => {
  const base = {
    ambient: 'sandbox',
    numberingRangeId: 390,
  };

  it('acepta una resolución que coincide con el ambiente y el rango', () => {
    expect(() =>
      assertResolutionMatchesConfig(base, {
        FACTUS_AMBIENT: 'sandbox',
        FACTUS_NC_RANGE_ID: '390',
      }),
    ).not.toThrow();
  });

  it('rechaza una resolución de otro ambiente', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, ambient: 'PRODUCCION' },
        { FACTUS_AMBIENT: 'sandbox', FACTUS_NC_RANGE_ID: '390' },
      ),
    ).toThrow(/ambiente/);
  });

  it('trata sandbox como HABILITACION: es el ambiente real de esas resoluciones', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, ambient: 'HABILITACION' },
        { FACTUS_AMBIENT: 'sandbox', FACTUS_NC_RANGE_ID: '390' },
      ),
    ).not.toThrow();
  });

  it('rechaza un ambiente habilitacion si el configurado es produccion', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, ambient: 'HABILITACION' },
        { FACTUS_AMBIENT: 'produccion', FACTUS_NC_RANGE_ID: '390' },
      ),
    ).toThrow(/ambiente/);
  });

  it('rechaza un rango guardado que no es el configurado', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, numberingRangeId: 999 },
        { FACTUS_AMBIENT: 'sandbox', FACTUS_NC_RANGE_ID: '390' },
      ),
    ).toThrow(/390/);
  });

  it('no valida el rango si la variable no esta configurada', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, numberingRangeId: 999 },
        { FACTUS_AMBIENT: 'sandbox' },
      ),
    ).not.toThrow();
  });

  it('no compara ambientes si FACTUS_AMBIENT no esta configurada', () => {
    expect(() =>
      assertResolutionMatchesConfig(
        { ...base, ambient: 'HABILITACION' },
        {},
      ),
    ).not.toThrow();
  });

  it('describe el valor guardado y el configurado para que se puedan corregir', () => {
    let message = '';
    try {
      assertResolutionMatchesConfig(
        { ...base, numberingRangeId: 999 },
        { FACTUS_AMBIENT: 'sandbox', FACTUS_NC_RANGE_ID: '390' },
      );
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('999');
    expect(message).toContain('FACTUS_NC_RANGE_ID');
  });
});