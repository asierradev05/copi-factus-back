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

// Texto real extraído por pdf-parse de un RUT DIAN oficial (formulario de 4 hojas)
const RUT_DIAN_4_PAGES = `
Exportadores
Para uso exclusivo de la DIAN
5. Número de Identificación Tributaria (NIT) 6. DV
984. Nombre
36. Nombre comercial 37. Sigla
35. Razón social
31. Primer apellido 32. Segundo apellido 33. Primer nombre
52. Número
establecimientos
34. Otros nombres
25. Tipo de documento
29. Departamento
26. Número de Identificación
40. Ciudad/Municipio
41. Dirección principal
42. Correo electrónico
44. Teléfono 1 43. Código postal 45. Teléfono 2
Firma del solicitante:
2. Concepto
141165996407
9 0 1 9 2 4 3 2 7 7 Impuestos de Bogotá 3 2
Persona jurídica 1
UNION TEMPORAL TC SED 2025
COLOMBIA 1 6 9 Bogotá D.C. 1 1 Bogotá, D.C. 0 0 1
CR 25 # 73 95
dir.comercial@tacseguridad.com
VILLAMIL CAMELO QUIMBERLY ANDREA
Representante Legal Certificado
248. Razón social
-- 1 of 4 --
141165996407
-- 2 of 4 --
141165996407
-- 3 of 4 --
VILLAMIL
AGUILAR
CAMELO
PINEDA
QUIMBERLY
FREDY
ANDREA
ALEXANDER
-- 4 of 4 --
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

  it('extrae campos de un RUT DIAN oficial de 4 hojas (layout tabular)', () => {
    const result = parseRutText(RUT_DIAN_4_PAGES);
    expect(result.name).toBe('UNION TEMPORAL TC SED 2025');
    expect(result.documentType).toBe('NIT');
    expect(result.documentNumber).toBe('141165996407');
    expect(result.address).toBe('CR 25 # 73 95');
    expect(result.city).toBe('BOGOTÁ D.C.');
    expect(result.email).toBe('dir.comercial@tacseguridad.com');
    expect(result.notes).toContain('Representante legal');
    expect(result.notes).toContain('VILLAMIL CAMELO QUIMBERLY ANDREA');
  });

  it('devuelve objeto vacío si no encuentra nada', () => {
    const result = parseRutText('texto sin datos útiles');
    expect(result.name).toBeUndefined();
    expect(result.documentNumber).toBeUndefined();
  });
});
