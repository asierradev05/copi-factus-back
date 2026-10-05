import { BadRequestException } from '@nestjs/common';
import { InvoiceKind } from '@prisma/client';

const RANGE_ENV_BY_KIND: Record<string, string> = {
  [InvoiceKind.NOTA_CREDITO]: 'FACTUS_NC_RANGE_ID',
  [InvoiceKind.NOTA_DEBITO]: 'FACTUS_ND_RANGE_ID',
};

/**
 * FACTUS_AMBIENT usa el vocabulario de la API de Factus (sandbox/produccion) y
 * la base de datos usa el enum Ambient (HABILITACION/PRODUCCION). Sin esta
 * traduccion, toda resolucion sandbox legitima pareceria estar en el ambiente
 * equivocado y el envio fallaria aunque el dato sea correcto.
 */
const AMBIENT_ALIASES: Record<string, string> = {
  sandbox: 'HABILITACION',
  habilitacion: 'HABILITACION',
  test: 'HABILITACION',
  produccion: 'PRODUCCION',
  production: 'PRODUCCION',
};

export function normalizeAmbient(value?: string | null): string | undefined {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) return undefined;
  return AMBIENT_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * El rango de numeracion de notas debe venir del ambiente de Factus. Antes se
 * caia a un valor fijo (390/391) cuando la variable no existia, y como esos
 * ids no corresponden al tenant real el documento se rechazaba en la DIAN
 * horas despues de verse "emitido" en el sistema. Fallar al inicio es mejor
 * que emitir un documento sin resolucion valida.
 */
export function resolveNoteRangeId(
  kind: InvoiceKind,
  env: Record<string, string | undefined> = process.env,
): number {
  const variable = RANGE_ENV_BY_KIND[kind];
  if (!variable) {
    throw new BadRequestException(
      `No hay rango de numeracion configurado para ${kind}.`,
    );
  }

  const raw = env[variable];
  if (!raw || !/^\d+$/.test(raw.trim())) {
    throw new BadRequestException(
      `Falta la variable ${variable} o no es numerica. Configurala antes de emitir notas.`,
    );
  }

  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(
      `${variable} debe ser un id de rango positivo.`,
    );
  }
  return value;
}

/**
 * Una resolucion guardada se reutiliza tal cual, asi que puede apuntar a otro
 * ambiente o a un rango que ya no es el configurado: en ese caso las notas se
 * numerarian fuera del rango aprobado sin que nada lo indique. Se valida antes
 * de emitir y no se corrige la fila: el mensaje dice que valor hay que dejar.
 */
export function assertResolutionMatchesConfig(
  resolution: { ambient?: string | null; numberingRangeId?: number | null },
  env: Record<string, string | undefined> = process.env,
  kind: InvoiceKind = InvoiceKind.NOTA_CREDITO,
): void {
  const configuredAmbient = normalizeAmbient(env.FACTUS_AMBIENT);
  const storedAmbient = normalizeAmbient(resolution.ambient);
  if (configuredAmbient && storedAmbient !== configuredAmbient) {
    throw new BadRequestException(
      `La resolucion de notas esta en el ambiente "${resolution.ambient}" pero FACTUS_AMBIENT es "${configuredAmbient}". Corrije la resolucion antes de emitir.`,
    );
  }

  const variable = RANGE_ENV_BY_KIND[kind];
  const raw = variable ? env[variable]?.trim() : undefined;
  if (!raw || !/^\d+$/.test(raw)) return;

  const expected = Number(raw);
  if (resolution.numberingRangeId !== expected) {
    throw new BadRequestException(
      `La resolucion de notas usa el rango ${resolution.numberingRangeId} y ${variable} es ${expected}. Actualiza la resolucion para usar el rango configurado.`,
    );
  }
}