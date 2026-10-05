import {
  extractCude,
  extractCufe,
  hasBlockingDianErrors,
  isInformationalDianMessage,
} from './dian-response.util';

describe('isInformationalDianMessage', () => {
  it('trata como informativo un aviso que la DIAN etiqueta como Notificacion', () => {
    expect(
      isInformationalDianMessage(
        'Regla: RUT01, Notificación: La validación del estado del RUT próximamente estará disponible.',
      ),
    ).toBe(true);
  });

  it('acepta tambien el mensaje en forma de objeto', () => {
    expect(isInformationalDianMessage({ message: 'Notificación DIAN' })).toBe(
      true,
    );
  });

  it('no marca como informativo un error sin esa etiqueta', () => {
    expect(isInformationalDianMessage('Regla: 0301, Error: documento duplicado')).toBe(
      false,
    );
  });

  it('no explota con entradas vacias o de otro tipo', () => {
    expect(isInformationalDianMessage(undefined)).toBe(false);
    expect(isInformationalDianMessage({})).toBe(false);
  });
});

describe('hasBlockingDianErrors', () => {
  it('solo con el aviso RUT01 la nota queda sin errores bloqueantes', () => {
    expect(
      hasBlockingDianErrors({
        errors: [
          'Regla: RUT01, Notificación: La validación del estado del RUT próximamente estará disponible.',
        ],
      }),
    ).toBe(false);
  });

  it('detecta un error real aunque conviva con avisos', () => {
    expect(
      hasBlockingDianErrors({
        errors: [
          'Regla: RUT01, Notificación: ...',
          'Regla: 0301, Error: documento duplicado',
        ],
      }),
    ).toBe(true);
  });

  it('sin errors no hay errores bloqueantes', () => {
    expect(hasBlockingDianErrors({ errors: [] })).toBe(false);
    expect(hasBlockingDianErrors({})).toBe(false);
  });
});

describe('extractCufe', () => {
  it('lee el CUFE propio de una factura', () => {
    expect(extractCufe({ cufe: 'CUFE-FACTURA', number: 'FAC1' })).toBe(
      'CUFE-FACTURA',
    );
  });

  it('no atribuye a la nota el CUFE de la factura referenciada', () => {
    expect(
      extractCufe({
        cude: 'CUDE-DE-LA-NOTA',
        bill: { cufe: 'CUFE-DE-LA-FACTURA-ORIGEN', number: 'SETP1' },
      }),
    ).toBeNull();
  });

  it('devuelve null cuando no hay CUFE', () => {
    expect(extractCufe({})).toBeNull();
    expect(extractCufe(null)).toBeNull();
  });
});

describe('extractCude', () => {
  it('lee el CUDE propio de la nota', () => {
    expect(
      extractCude({
        cude: 'CUDE-DE-LA-NOTA',
        bill: { cufe: 'CUFE-ORIGEN' },
      }),
    ).toBe('CUDE-DE-LA-NOTA');
  });

  it('devuelve null cuando no hay CUDE', () => {
    expect(extractCude({ cufe: 'X' })).toBeNull();
  });
});