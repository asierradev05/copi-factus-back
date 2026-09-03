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

export function parseRutText(text: string): ExtractedRutData {
  const normalized = text.replace(/\r/g, '\n');
  const upper = normalized.toUpperCase();

  const result: ExtractedRutData = {};

  const nitMatch = upper.match(
    /(?:NIT|N\.I\.T\.?|NÚMERO\s+DE\s+IDENTIFICACIÓN\s+TRIBUTARIA\s*\(NIT\))\s*[:\-]?\s*(\d{8,10}-\d)\b/i,
  ) ?? upper.match(/\b(\d{8,10}-\d)\b/);
  if (nitMatch?.[1]) {
    result.documentType = 'NIT';
    result.documentNumber = nitMatch[1];
  }

  const ccMatch = upper.match(
    /(?:C\.?C\.?|CÉDULA\s+DE\s+CIUDADANÍA|NÚMERO\s+DE\s+IDENTIFICACIÓN)\s*[:\-]?\s*(\d{6,10})\b/i,
  );
  if (!result.documentNumber && ccMatch?.[1]) {
    result.documentType = 'CC';
    result.documentNumber = ccMatch[1];
  }

  const nameMatch = normalized.match(
    /(?:RAZÓN\s+SOCIAL|RAZON\s+SOCIAL|NOMBRE\s+COMERCIAL|APELLIDOS\s+Y\s+NOMBRES|NOMBRE\s+COMPLETO)\s*[:\-]?\s*([^\n]{3,120})/i,
  );
  if (nameMatch?.[1]) {
    result.name = cleanLine(nameMatch[1]);
  }

  const addressMatch = normalized.match(
    /(?:DIRECCIÓN|DIRECCION|DIRECCIÓN\s+COMERCIAL|DIRECCION\s+COMERCIAL|DOMICILIO)\s*[:\-]?\s*([^\n]{4,120})/i,
  );
  if (addressMatch?.[1]) {
    result.address = cleanLine(addressMatch[1]);
  }

  const cityMatch = upper.match(
    /(?:MUNICIPIO|CIUDAD|CENTRO\s+POBLADO|DEPARTAMENTO)\s*[:\-]?\s*([^\n]{2,80})/i,
  );
  if (cityMatch?.[1]) {
    result.city = cleanLine(cityMatch[1]).split(/\s{2,}/)[0];
  }

  const phoneMatch = normalized.match(
    /(?:TELÉFONO|TELEFONO|TELÉFONO\s+CELULAR|TELEFONO\s+CELULAR)\s*[:\-]?\s*([+\d][\d\s.\-]{6,})/i,
  );
  if (phoneMatch?.[1]) {
    result.phone = cleanLine(phoneMatch[1]);
  }

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  if (emailMatch?.[0] && emailMatch[0].toLowerCase().includes('@')) {
    result.email = emailMatch[0].toLowerCase();
  }

  const notesParts: string[] = [];
  const activityMatch = upper.match(
    /ACTIVIDAD\s+ECON[ÓO]MICA[^:]*\s*[:\-]?\s*([^\n]{4,120})/i,
  );
  if (activityMatch?.[1]) {
    notesParts.push(`Actividad económica: ${cleanLine(activityMatch[1])}`);
  }
  const stateMatch = upper.match(/ESTADO\s*[:\-]?\s*([^\n]{2,40})/i);
  if (stateMatch?.[1]) {
    notesParts.push(`Estado: ${cleanLine(stateMatch[1])}`);
  }
  const dateMatch = upper.match(
    /FECHA\s+DE\s+ACTUALIZACI[ÓO]N\s*[:\-]?\s*([\d]{1,2}[\/\-][\d]{1,2}[\/\-][\d]{2,4})/i,
  );
  if (dateMatch?.[1]) {
    notesParts.push(`Fecha de actualización: ${cleanLine(dateMatch[1])}`);
  }
  if (notesParts.length > 0) {
    result.notes = notesParts.join('\n');
  }

  return result;
}

export async function extractRutFromPdf(buffer: Buffer): Promise<ExtractedRutData> {
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
