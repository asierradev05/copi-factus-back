import { parseRutText } from './rut-extractor.util';

const RUT_SAMPLE = `
RUT
REGISTRO ÚNICO TRIBUTARIO
Número de Identificación Tributaria (NIT): 900123456-7
Razón Social: COPIGRAFICA SIERRA S.A.S.
Dirección: Carrera 28 # 10-70 Local 215
Municipio: BOGOTÁ D.C.
Teléfono: 601 742 1122
Correo Electrónico: contacto@copigraficassierra.com
Actividad Económica: 1811 - Actividades de impresión
Estado: ACTIVO
Fecha de Actualización: 12/03/2026
`;

const RUT_CC_SAMPLE = `
RUT
REGISTRO ÚNICO TRIBUTARIO
Cédula de Ciudadanía: 1023456789
Apellidos y Nombres: JUAN PEREZ GOMEZ
Dirección: Calle 5 # 12-34
Centro Poblado: MEDELLÍN
Teléfono Celular: 320 123 4567
Correo Electrónico: juan.perez@example.com
`;

describe('parseRutText', () => {
  it('extrae campos de un RUT de persona jurídica (empresa)', () => {
    const result = parseRutText(RUT_SAMPLE);
    expect(result.name).toBe('COPIGRAFICA SIERRA S.A.S.');
    expect(result.documentType).toBe('NIT');
    expect(result.documentNumber).toBe('900123456-7');
    expect(result.address).toBe('Carrera 28 # 10-70 Local 215');
    expect(result.city).toBe('BOGOTÁ D.C.');
    expect(result.phone).toBe('601 742 1122');
    expect(result.email).toBe('contacto@copigraficassierra.com');
    expect(result.notes).toContain('Actividad económica');
    expect(result.notes).toContain('1811');
  });

  it('extrae campos de un RUT de persona natural (cédula)', () => {
    const result = parseRutText(RUT_CC_SAMPLE);
    expect(result.name).toBe('JUAN PEREZ GOMEZ');
    expect(result.documentType).toBe('CC');
    expect(result.documentNumber).toBe('1023456789');
    expect(result.email).toBe('juan.perez@example.com');
  });

  it('devuelve objeto vacío si no encuentra nada', () => {
    const result = parseRutText('texto sin datos útiles');
    expect(result.name).toBeUndefined();
    expect(result.documentNumber).toBeUndefined();
  });
});
