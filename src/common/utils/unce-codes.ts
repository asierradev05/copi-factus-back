/**
 * Catalogos UN/CE que la DIAN acepta en `unit_measure_code` y
 * `standard_code`. Validar contra el catalogo y no contra un patron es
 * deliberado: un regex alphanumerico acepta `91`, y el sandbox de Factus ya lo
 * rechazo con "el campo codigo unidad de medida es invalido". Un error de
 * validacion en la UI cuesta segundos; el mismo error en la emision llega
 * cuando la factura ya esta pagada.
 *
 * Fuente: copigraficas/proyectos/factus/tablas-de-referencia.md.
 * Si la DIAN amplia su catalogo, se agrega aqui: es el unico lugar que hay
 * que tocar.
 */

/** Unidades de medida. Nota: algunas llevan letras (`KGM`, `MTK`). */
export const UNCE_UNIT_MEASURE_CODES = [
  '94', // Unidad
  '75', // Hora
  'MTK', // Metro cuadrado
  'MTR', // Metro
  'KGM', // Kilogramo
  'OTR', // Otro
] as const;

/** Estandares de identificacion del item. */
export const UNCE_STANDARD_CODES = [
  '999', // No estandarizado
  '001', // GTIN (codigo de barras)
  '020', // EAN
  '010', // UNSPC
] as const;

/** `true` si el codigo pertenece al catalogo. La comparacion ignora mayusculas. */
export function isUnceUnitMeasureCode(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (UNCE_UNIT_MEASURE_CODES as readonly string[]).includes(
      code.trim().toUpperCase(),
    )
  );
}

export function isUnceStandardCode(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (UNCE_STANDARD_CODES as readonly string[]).includes(code.trim())
  );
}
