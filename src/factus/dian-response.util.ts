/**
 * Factus devuelve los mensajes de la DIAN mezclando dos cosas distintas:
 * avisos informativos (etiquetados por la propia DIAN como "Notificación") y
 * observaciones que hay que corregir. Contar los avisos como error dejaba
 * cualquier nota permanentemente en estado ENVIADA, porque RUT01 ("la
 * validacion del estado del RUT proximamente estara disponible") aparece en
 * todas las notas y nunca se va a resolver. El rechazo real ya lo cubre
 * is_validated=false.
 */
export function isInformationalDianMessage(entry: unknown): boolean {
  const text =
    typeof entry === 'string'
      ? entry
      : typeof (entry as { message?: unknown })?.message === 'string'
        ? ((entry as { message: string }).message)
        : '';
  if (!text) return false;
  return /notificaci[oó]n/i.test(text);
}

export function hasBlockingDianErrors(data: {
  errors?: unknown;
}): boolean {
  const errors = Array.isArray(data.errors) ? data.errors : [];
  return errors.some((entry) => !isInformationalDianMessage(entry));
}

/**
 * Solo las facturas-electronicas tienen CUFE. En notas credito/debito Factus
 * responde con `cude` (el codigo propio de la nota, el mismo que usa el QR) y
 * `bill.cufe`, que es el CUFE de la FACTURA REFERENCIADA, no el de la nota.
 * Verificado contra la respuesta real del sandbox: en la nota
 * data.bill.cufe coincidia byte a byte con el CUFE de la factura origen.
 * Por eso no se cae a bill.cufe: guardarlo en la nota atribuiria a la nota un
 * CUFE ajeno. El CUDE de la nota no se persiste porque el esquema no tiene
 * columna para el.
 */
export function extractCufe(data: unknown): string | null {
  const cufe = (data as { cufe?: unknown } | null)?.cufe;
  return typeof cufe === 'string' && cufe.trim() ? cufe.trim() : null;
}

/**
 * Codigo propio de la nota (CUDE). Se expone para poder persistirlo cuando el
 * esquema tenga columna; hoy las notas quedan sin CUFE a proposito.
 */
export function extractCude(data: unknown): string | null {
  const cude = (data as { cude?: unknown } | null)?.cude;
  return typeof cude === 'string' && cude.trim() ? cude.trim() : null;
}