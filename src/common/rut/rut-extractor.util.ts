import { PDFParse } from 'pdf-parse';

export interface ExtractedRutData {
  name?: string;
  documentType?: 'NIT' | 'CC';
  documentNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

const NAME_NOISE_RE =
  /^(?:COLOMBIA|BOGOT|MEDELL|CALI|IMPORTANTE|ESPACIO|PÁGINA|FECHA|SOCIOS|MIEMBROS|DOCUMENTO|ITEM|HOJA|CONSTITUCI|ENTIDAD|VIGENCIA|ESTADO|CARACTER|SIN PERJUICIO|FIRMA|PARA USO|EXPORT|ADMINISTR|SECRETARIA|REPRESENTANTE|LEGAL|CERTIFICADO|ESPACIO|NOMBRE|APELLIDO|--)/i;

const FIELD_LABEL_RE = /^\d{1,3}\.\s+/;
const STREET_WORD_RE =
  /\b(?:CR|CRA|CARRERA|CALLE|CL|CLL|AV|AVENIDA|DG|DIAGONAL|TRV|TRANSVERSAL|KM|VEREDA|FINC[AÁ]\s+EL)\b/i;
const NIT_PLAIN_RE = /\b\d{11,12}\b/g;
const SOCIETAL_TYPE_RE =
  /\b(?:S\.A\.S\.?|SAS|LTDA|LIMITADA|S\.A\.|SOCIEDAD|COMPAÑÍA|COMPANIA|COOPERATIVA|FUNDACIÓN|FUNDACION|CONSORCIO|UNI[OÓ]N\s+TEMPORAL|U\.T\.|TEMPORAL)\b/i;

const SOLICITANTE_NOISE_RE =
  /FIRMA|IMPORTANTE|SIN\s+PERJUICIO|PARA\s+USO|RESPONSABILIDAD|IDENTIFICACIÓN|UBICACIÓN|CLASIFICACIÓN|SOLICITUD|EXPORTADORES|USUARIOS\s+ADUANEROS|FECHA\s+GENERACIÓN|IMPUESTOS\s+DE|PERSONA\s+(?:JURÍDICA|NATURAL|JURIDICA)|SOLICITANTE|AUTORIZADA|REPRESENTANTE|TIPO\s+DE\s+CONTRIBUYENTE|ESTABLECIMIENTOS/i;

function isFieldLabel(line: string): boolean {
  return FIELD_LABEL_RE.test(line.trim());
}

function lookAfterLabel(
  upper: string,
  labelRe: RegExp,
  valueRe: { test(line: string): boolean },
  maxDistance = 12,
): string | null {
  const labelMatch = upper.match(labelRe);
  if (!labelMatch) {
    return null;
  }
  const after = upper.slice(labelMatch.index);
  const lines = after.split('\n').slice(1, maxDistance + 1);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || isFieldLabel(line) || /^[\d\s.,-]+$/.test(line)) {
      continue;
    }
    if (valueRe.test(line)) {
      return cleanLine(line);
    }
  }
  return null;
}

function mostFrequent<T extends string>(values: T[]): T | null {
  if (values.length === 0) {
    return null;
  }
  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function parseRutText(text: string): ExtractedRutData {
  const normalized = text.replace(/\r/g, '\n');
  const upper = normalized.toUpperCase();
  const result: ExtractedRutData = {};

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  if (emailMatch?.[0] && emailMatch[0].toLowerCase().includes('@')) {
    result.email = emailMatch[0].toLowerCase();
  }

  // --- Modo RUT DIAN oficial (formulario tabular de varias hojas) ---
  const isDianForm =
    /\d{1,3}\.\s*NÚMERO\s+DE\s+IDENTIFICACIÓN\s+TRIBUTARIA/i.test(upper) ||
    /--\s*\d+\s+OF\s+\d+\s*--/i.test(upper);

  if (isDianForm) {
    // NIT principal: el número plano (11-12 dígitos) que más se repite en todo el documento.
    const nitValues = [...upper.matchAll(NIT_PLAIN_RE)].map((m) => m[0]);
    const nit = mostFrequent(nitValues);
    if (nit) {
      result.documentType = 'NIT';
      result.documentNumber = nit;
    }

    // Razón social (persona jurídica): en el formulario DIAN los valores NO quedan
    // contiguos a su etiqueta (columnas), así que se escanean todas las líneas de
    // datos y se elige la que mejor representa la razón social.
    if (!result.name) {
      const lines = upper.split('\n').map((l) => cleanLine(l));
      const candidate = lines
        .filter((line) => line.length >= 2 && !isFieldLabel(line))
        .find(
          (line) =>
            SOCIETAL_TYPE_RE.test(line) &&
            !SOLICITANTE_NOISE_RE.test(line) &&
            !/^\d/.test(line),
        );
      if (candidate) {
        result.name = cleanLine(candidate);
      }
    }
    if (!result.name) {
      const fallback = upper
        .split('\n')
        .map(cleanLine)
        .filter((line) => line.length >= 2 && !isFieldLabel(line))
        .find(
          (line) =>
            /\s[A-Z]/.test(line) &&
            /[A-Z]{2,}/.test(line) &&
            !SOLICITANTE_NOISE_RE.test(line) &&
            !/^[\d\s.,-]+$/.test(line),
        );
      if (fallback) {
        result.name = cleanLine(fallback);
      }
    }

    // Persona natural: apellidos y nombres concatenados.
    if (!result.name) {
      const fullName = lookAfterLabel(
        upper,
        /(?:^|\n)\s*31\.\s*PRIMER\s+APELLIDO/i,
        { test: (line) => /[A-Z]{2,}/.test(line) && !isFieldLabel(line) },
        4,
      );
      if (fullName) {
        result.name = fullName;
      }
    }

    // Dirección: línea que matchea patrón de calle colombiana.
    const streetLine = upper
      .split('\n')
      .find((line) => STREET_WORD_RE.test(line) && !isFieldLabel(line));
    if (streetLine) {
      result.address = cleanLine(streetLine);
    }

    // Ciudad: buscar un nombre de ciudad conocido (la DIAN lo mezcla con dígitos de tabla).
    if (!result.city) {
      if (/BOGOTÁ/.test(upper)) {
        result.city = 'BOGOTÁ D.C.';
      } else if (/MEDELLÍN/.test(upper)) {
        result.city = 'MEDELLÍN';
      } else if (/(?:^|\s)CALI(?:\s|$)/.test(upper)) {
        result.city = 'CALI';
      } else {
        const cityValue = lookAfterLabel(
          upper,
          /CIUDAD\s*\/\s*MUNICIPIO|CIUDAD\/MUNICIPIO/i,
          {
            test: (line) =>
              /^[A-Z][A-ZÀ-Ü\s.,]{2,}$/.test(line) &&
              !isFieldLabel(line) &&
              !/VILLAMIL|APELLIDO|NOMBRE|ADMINISTRADOR|REPRESENTANTE/.test(
                line,
              ),
          },
        );
        if (cityValue) {
          result.city = cleanLine(cityValue).split(/\s{2,}/)[0];
        }
      }
    }

    // Representante legal -> notes. En el RUT DIAN el nombre del representante
    // aparece justo antes de "Representante Legal Certificado". Si no se ubica,
    // se busca un nombre propio que difiera de la razón social.
    if (!result.notes && result.name) {
      const isName = (line: string) =>
        /^(?=(?:\w+\s){2,})[A-Z][A-Z\s]{3,}$/.test(cleanLine(line)) &&
        !NAME_NOISE_RE.test(cleanLine(line)) &&
        !isFieldLabel(line) &&
        cleanLine(line) !== result.name;
      let legal: string | null = null;
      const lines = upper.split('\n');
      let certIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/REPRESENTANTE\s+LEGAL\s+CERTIFICADO/i.test(lines[i])) {
          certIdx = i;
          break;
        }
      }
      if (certIdx >= 0) {
        for (let i = certIdx - 1; i >= 0; i--) {
          if (isName(lines[i])) {
            legal = cleanLine(lines[i]);
            break;
          }
        }
      }
      if (!legal) {
        legal = lines.find(isName) ?? null;
      }
      if (legal) {
        result.notes = `Representante legal: ${cleanLine(legal)}`;
      }
    }
    if (!result.notes) {
      const namesChunk = upper.match(/((?:[A-Z]{4,}\s*){3,6})/);
      if (namesChunk) {
        const chunk = cleanLine(namesChunk[1]);
        if (chunk.split(' ').length >= 3) {
          result.notes = `Representante legal: ${chunk}`;
        }
      }
    }
  }

  // --- Patrones genéricos "etiqueta: valor" (RUT simplificado / escaneado) ---
  if (!result.address) {
    const addressMatch = normalized.match(
      /(?:DIRECCIÓN|DIRECCION|DIRECCIÓN\s+COMERCIAL|DIRECCION\s+COMERCIAL|DOMICILIO|DIRECCION\s+PRINCIPAL)\s*[:-]?\s*([^\n]{4,120})/i,
    );
    if (addressMatch?.[1]) {
      result.address = cleanLine(addressMatch[1]);
    }
  }

  const phoneMatch = normalized.match(
    /(?:TELÉFONO|TELEFONO|TELÉFONO\s+CELULAR|TELEFONO\s+CELULAR|TELÉFONO\s+1|TELEFONO\s+1)\s*[:-]?\s*([+\d][\d\s.-]{6,})/i,
  );
  if (phoneMatch?.[1]) {
    result.phone = cleanLine(phoneMatch[1]);
  }

  const nitMatch =
    upper.match(
      /(?:NIT|N\.I\.T\.?|NÚMERO\s+DE\s+IDENTIFICACIÓN\s+TRIBUTARIA\s*\(NIT\))\s*[:-]?\s*(\d{8,10}-\d)\b/i,
    ) ?? upper.match(/\b(\d{8,10}-\d)\b/);
  if (!result.documentNumber && nitMatch?.[1]) {
    result.documentType = 'NIT';
    result.documentNumber = nitMatch[1];
  }

  const ccMatch = upper.match(
    /(?:C\.?C\.?|CÉDULA\s+DE\s+CIUDADANÍA|NÚMERO\s+DE\s+IDENTIFICACIÓN)\s*[:-]?\s*(\d{6,10})\b/i,
  );
  if (!result.documentNumber && ccMatch?.[1]) {
    result.documentType = 'CC';
    result.documentNumber = ccMatch[1];
  }

  if (!result.name) {
    const nameMatch = normalized.match(
      /(?:RAZÓN\s+SOCIAL|RAZON\s+SOCIAL|NOMBRE\s+COMERCIAL|APELLIDOS\s+Y\s+NOMBRES|NOMBRE\s+COMPLETO)\s*[:-]?\s*([^\n]{3,120})/i,
    );
    if (nameMatch?.[1]) {
      result.name = cleanLine(nameMatch[1]);
    }
  }

  if (!result.city) {
    const cityMatch = upper.match(
      /(?:MUNICIPIO|CIUDAD|CENTRO\s+POBLADO|DEPARTAMENTO)\s*[:-]?\s*([^\n]{2,80})/i,
    );
    if (cityMatch?.[1]) {
      result.city = cleanLine(cityMatch[1]).split(/\s{2,}/)[0];
    }
  }

  // --- Notas adicionales (se agregan a las ya recopiladas) ---
  const notesParts: string[] = [];
  if (result.notes) {
    notesParts.push(result.notes);
  }
  // En el RUT DIAN tabular los campos de actividad/estado no quedan contiguos a su
  // valor, así que se omiten para no ensuciar las notas; solo se extraen en el
  // formato simplificado "etiqueta: valor".
  if (!isDianForm) {
    const activityMatch = upper.match(
      /ACTIVIDAD\s+ECON[ÓO]MICA[^:]*\s*[:-]?\s*([^\n]{4,120})/i,
    );
    if (activityMatch?.[1]) {
      notesParts.push(`Actividad económica: ${cleanLine(activityMatch[1])}`);
    }
    const stateMatch = upper.match(/ESTADO\s*[:-]?\s*([^\n]{2,40})/i);
    if (stateMatch?.[1]) {
      notesParts.push(`Estado: ${cleanLine(stateMatch[1])}`);
    }
    const dateMatch = upper.match(
      /FECHA\s+DE\s+ACTUALIZACI[ÓO]N\s*[:-]?\s*([\d]{1,2}[-/][\d]{1,2}[-/][\d]{2,4})/i,
    );
    if (dateMatch?.[1]) {
      notesParts.push(`Fecha de actualización: ${cleanLine(dateMatch[1])}`);
    }
  }
  if (notesParts.length > 0) {
    result.notes = notesParts.join('\n');
  }

  return result;
}

export async function extractRutFromPdf(
  buffer: Buffer,
): Promise<ExtractedRutData> {
  let text = '';
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const parsed = await parser.getText();
      text = parsed.text ?? '';
    } finally {
      await parser.destroy();
    }
  } catch {
    return {};
  }
  return parseRutText(text);
}
